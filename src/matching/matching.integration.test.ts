import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getMatchCandidates, recordMatches } from "../db/queries";
import { CANDIDATE_RULES } from "./rules";
import { runAutoMatching } from "./run";

// Eligibility, amounts and the due date window are SQL: they are tested
// against a real Postgres, in a database of their own, with small fixtures.

const TEST_DATABASE = "matching_test";
const connection = {
  host: process.env.PGHOST ?? "localhost",
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? "postgres",
  password: process.env.PGPASSWORD ?? "postgres",
};
const MIGRATIONS = fileURLToPath(new URL("../../migrations/", import.meta.url));

const SIREN = "123456789";
const COMPANY = "c0000000-0000-4000-8000-000000000001";
const OTHER_COMPANY = "c0000000-0000-4000-8000-000000000002";
const ACCOUNT = "ac000000-0000-4000-8000-000000000001";
const OTHER_ACCOUNT = "ac000000-0000-4000-8000-000000000002";

let db: Pool;

beforeAll(async () => {
  const admin = new Pool({ ...connection, database: "postgres" });
  await admin.query(`drop database if exists ${TEST_DATABASE} with (force)`);
  await admin.query(`create database ${TEST_DATABASE}`);
  await admin.end();

  db = new Pool({ ...connection, database: TEST_DATABASE });
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    await db.query(readFileSync(MIGRATIONS + file, "utf8"));
  }
});

afterAll(async () => {
  await db.end();
});

beforeEach(async () => {
  await db.query("truncate company, account, transaction, buying_invoice");
  await db.query(
    "insert into company (id, siren, name) values ($1, $2, 'Acme client'), ($3, '987654321', 'Other client')",
    [COMPANY, SIREN, OTHER_COMPANY],
  );
  await db.query(
    "insert into account (id, company_id) values ($1, $2), ($3, $4)",
    [ACCOUNT, COMPANY, OTHER_ACCOUNT, OTHER_COMPANY],
  );
});

async function insertTransaction(fields: Record<string, unknown> = {}) {
  const t = {
    id: randomUUID(),
    account_id: ACCOUNT,
    amount: "-120.00",
    label: "VIR ACME",
    reference: null,
    status: "Booked",
    date: "2026-06-10",
    matched_invoice_id: null,
    deleted_at: null,
    ...fields,
  };
  await db.query(
    `insert into transaction
       (id, account_id, remote_id, amount, label, reference, status, date, matched_invoice_id, deleted_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [t.id, t.account_id, `BNK-${t.id}`, t.amount, t.label, t.reference, t.status, t.date, t.matched_invoice_id, t.deleted_at],
  );
  return t.id;
}

async function insertInvoice(fields: Record<string, unknown> = {}) {
  const i = {
    id: randomUUID(),
    company_id: COMPANY,
    supplier_name: "Acme",
    invoice_number: null,
    tax_free_total: "100.00",
    vat_amount: "20.00",
    due_date: "2026-06-10",
    invoice_status: "ToPay",
    deleted_at: null,
    ...fields,
  };
  await db.query(
    `insert into buying_invoice
       (id, company_id, supplier_name, invoice_number, tax_free_total, vat_amount, due_date, invoice_status, deleted_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [i.id, i.company_id, i.supplier_name, i.invoice_number, i.tax_free_total, i.vat_amount, i.due_date, i.invoice_status, i.deleted_at],
  );
  return i.id;
}

// The candidate invoices of each eligible transaction, by transaction id.
async function candidates(): Promise<Map<string, string[]>> {
  const rows = await getMatchCandidates(db, COMPANY, CANDIDATE_RULES);
  return new Map(
    rows.map(({ transaction, candidates }) => [
      transaction.id,
      candidates.map((invoice) => invoice.id).sort(),
    ]),
  );
}

async function matchedInvoiceOf(transactionId: string) {
  const { rows } = await db.query(
    "select matched_invoice_id from transaction where id = $1",
    [transactionId],
  );
  return rows[0].matched_invoice_id;
}

describe("candidate selection (SQL)", () => {
  it("keeps due dates from 3 days before to 30 days after the payment", async () => {
    const payment = await insertTransaction({ date: "2026-06-10" });
    const threeDaysBefore = await insertInvoice({ due_date: "2026-06-07" });
    await insertInvoice({ due_date: "2026-06-06" });
    const thirtyDaysAfter = await insertInvoice({ due_date: "2026-07-10" });
    await insertInvoice({ due_date: "2026-07-11" });

    expect((await candidates()).get(payment)).toEqual(
      [threeDaysBefore, thirtyDaysAfter].sort(),
    );
  });

  it("counts calendar days across February of a leap year", async () => {
    const payment = await insertTransaction({ date: "2028-02-01" });
    const dueAfter30Days = await insertInvoice({ due_date: "2028-03-02" });
    await insertInvoice({ due_date: "2028-03-03" });

    expect((await candidates()).get(payment)).toEqual([dueAfter30Days]);
  });

  it("compares amounts exactly", async () => {
    const payment = await insertTransaction({ amount: "-615.40" });
    const invoice = await insertInvoice({
      tax_free_total: "512.83",
      vat_amount: "102.57",
    });
    await insertInvoice({ tax_free_total: "512.83", vat_amount: "102.58" });

    expect((await candidates()).get(payment)).toEqual([invoice]);
  });

  it("ignores invoices without a due date", async () => {
    const payment = await insertTransaction();
    await insertInvoice({ due_date: null });

    expect((await candidates()).get(payment)).toEqual([]);
  });

  it("only considers booked, live, unmatched outgoing transactions of the company", async () => {
    const eligible = await insertTransaction();
    const alreadyMatchedTo = await insertInvoice({ due_date: "2026-01-01" });
    await insertTransaction({ amount: "120.00" });
    await insertTransaction({ status: "Pending" });
    await insertTransaction({ deleted_at: "2026-06-11 10:00:00" });
    await insertTransaction({ matched_invoice_id: alreadyMatchedTo });
    await insertTransaction({ account_id: OTHER_ACCOUNT });

    expect([...(await candidates()).keys()]).toEqual([eligible]);
  });

  it("only considers live, unmatched invoices of an eligible status from the same company", async () => {
    const payment = await insertTransaction();
    const toPay = await insertInvoice({ invoice_status: "ToPay" });
    const pending = await insertInvoice({ invoice_status: "Pending" });
    const paid = await insertInvoice({ invoice_status: "Paid" });
    await insertInvoice({ invoice_status: "Cancelled" });
    await insertInvoice({ deleted_at: "2026-06-01 10:00:00" });
    await insertInvoice({ company_id: OTHER_COMPANY });
    const taken = await insertInvoice();
    await insertTransaction({ date: "2026-01-01", matched_invoice_id: taken });
    // Only a live transaction takes an invoice: once deleted, it frees it.
    const freedByDeletion = await insertInvoice();
    await insertTransaction({
      date: "2026-01-01",
      matched_invoice_id: freedByDeletion,
      deleted_at: "2026-06-01 10:00:00",
    });

    expect((await candidates()).get(payment)).toEqual(
      [toPay, pending, paid, freedByDeletion].sort(),
    );
  });
});

describe("runAutoMatching", () => {
  it("writes the match, and a second run changes nothing", async () => {
    const payment = await insertTransaction();
    const invoice = await insertInvoice();

    await runAutoMatching(db, SIREN);
    expect(await matchedInvoiceOf(payment)).toBe(invoice);

    const before = await db.query("select * from transaction order by id");
    await runAutoMatching(db, SIREN);
    const after = await db.query("select * from transaction order by id");
    expect(after.rows).toEqual(before.rows);
  });

  it("never overwrites an existing match", async () => {
    const chosenByHand = await insertInvoice({ due_date: "2026-01-01" });
    const payment = await insertTransaction({ matched_invoice_id: chosenByHand });
    await insertInvoice();

    await runAutoMatching(db, SIREN);
    expect(await matchedInvoiceOf(payment)).toBe(chosenByHand);
  });

  it("leaves a duplicated bank import unmatched", async () => {
    const imported = await insertTransaction();
    const importedTwice = await insertTransaction();
    await insertInvoice();

    await runAutoMatching(db, SIREN);
    expect(await matchedInvoiceOf(imported)).toBeNull();
    expect(await matchedInvoiceOf(importedTwice)).toBeNull();
  });

  it("records who matched, when and in which run, so a run can be reverted", async () => {
    const payment = await insertTransaction();
    const invoice = await insertInvoice();
    const chosenByHand = await insertInvoice({ due_date: "2026-01-01" });
    const matchedByHand = await insertTransaction({ date: "2026-01-01" });
    await db.query(
      "update transaction set matched_invoice_id = $1, match_source = 'manual' where id = $2",
      [chosenByHand, matchedByHand],
    );

    await runAutoMatching(db, SIREN);
    expect(await matchedInvoiceOf(payment)).toBe(invoice);
    const {
      rows: [match],
    } = await db.query(
      "select match_source, matched_at, match_run_id from transaction where id = $1",
      [payment],
    );
    expect(match.match_source).toBe("auto");
    expect(match.matched_at).toBeInstanceOf(Date);
    expect(match.match_run_id).toMatch(/^[0-9a-f-]{36}$/);

    // The revert query documented in the migration.
    await db.query(
      `update transaction
       set matched_invoice_id = null, match_source = null,
           matched_at = null, match_run_id = null
       where match_run_id = $1 and match_source = 'auto'`,
      [match.match_run_id],
    );
    expect(await matchedInvoiceOf(payment)).toBeNull();
    expect(await matchedInvoiceOf(matchedByHand)).toBe(chosenByHand);
  });

  it("gives the same result when two runs overlap", async () => {
    const payment = await insertTransaction();
    const invoice = await insertInvoice();

    await Promise.all([runAutoMatching(db, SIREN), runAutoMatching(db, SIREN)]);
    expect(await matchedInvoiceOf(payment)).toBe(invoice);
  });

  it("never matches again a transaction whose match a user undid", async () => {
    const undoneByUser = await insertTransaction();
    await db.query(
      "update transaction set match_source = 'manual' where id = $1",
      [undoneByUser],
    );
    const invoice = await insertInvoice();

    expect((await candidates()).has(undoneByUser)).toBe(false);
    await runAutoMatching(db, SIREN);
    expect(await matchedInvoiceOf(undoneByUser)).toBeNull();

    const written = await recordMatches(db, randomUUID(), [
      { transactionId: undoneByUser, outcome: "matched", invoiceId: invoice },
    ]);
    expect(written).toBe(0);
  });

  it("does not overwrite a transaction matched between the read and the write", async () => {
    const chosenByHand = await insertInvoice();
    const payment = await insertTransaction({ matched_invoice_id: chosenByHand });
    const chosenByTheRun = await insertInvoice();

    const written = await recordMatches(db, randomUUID(), [
      { transactionId: payment, outcome: "matched", invoiceId: chosenByTheRun },
    ]);
    expect(written).toBe(0);
    expect(await matchedInvoiceOf(payment)).toBe(chosenByHand);
  });

  it("does not write to a transaction deleted between the read and the write", async () => {
    const payment = await insertTransaction({ deleted_at: "2026-06-11 10:00:00" });
    const invoice = await insertInvoice();

    const written = await recordMatches(db, randomUUID(), [
      { transactionId: payment, outcome: "matched", invoiceId: invoice },
    ]);
    expect(written).toBe(0);
    expect(await matchedInvoiceOf(payment)).toBeNull();
  });

  it("leaves a transaction without label unmatched, without failing the run", async () => {
    const withoutLabel = await insertTransaction({ label: null });
    await insertInvoice();
    const payment = await insertTransaction({ amount: "-50.00", label: "VIR BETA" });
    const invoice = await insertInvoice({
      supplier_name: "Beta",
      tax_free_total: "40.00",
      vat_amount: "10.00",
    });

    const summary = await runAutoMatching(db, SIREN);
    expect(summary.decisions).toMatchObject({ matched: 1, no_candidate: 1 });
    expect(await matchedInvoiceOf(payment)).toBe(invoice);
    expect(await matchedInvoiceOf(withoutLabel)).toBeNull();
  });

  it("refuses, in the database, one invoice for two live transactions", async () => {
    const invoice = await insertInvoice();
    await insertTransaction({ matched_invoice_id: invoice });

    await expect(
      insertTransaction({ matched_invoice_id: invoice }),
    ).rejects.toThrow("transaction_matched_invoice_id_key");
  });

  it("fails clearly for an unknown SIREN", async () => {
    await expect(runAutoMatching(db, "000000000")).rejects.toThrow(
      "nothing was written: No company with SIREN 000000000",
    );
  });

  it("reports transactions that belong to no known account", async () => {
    await insertTransaction({ account_id: randomUUID() });

    const summary = await runAutoMatching(db, SIREN);
    expect(summary.withoutAccount).toBe(1);
  });

  it("counts the decisions by reason", async () => {
    await insertTransaction({ amount: "-120.00", label: "VIR ACME" });
    await insertInvoice({ supplier_name: "Acme", tax_free_total: "100.00", vat_amount: "20.00" });
    await insertTransaction({ amount: "-50.00", label: "VIR BETA" });
    await insertInvoice({ supplier_name: "Beta", tax_free_total: "40.00", vat_amount: "10.00" });
    await insertInvoice({ supplier_name: "Beta", tax_free_total: "40.00", vat_amount: "10.00" });
    await insertTransaction({ amount: "-70.00", label: "VIR GAMMA" });
    await insertTransaction({ amount: "-70.00", label: "VIR GAMMA" });
    await insertInvoice({ supplier_name: "Gamma", tax_free_total: "60.00", vat_amount: "10.00" });
    await insertTransaction({ amount: "-999.00", label: "VIR DELTA" });

    const summary = await runAutoMatching(db, SIREN);
    expect(summary).toMatchObject({
      eligible: 5,
      decisions: { matched: 1, ambiguous: 1, contested: 2, no_candidate: 1 },
      written: 1,
      changedMeanwhile: 0,
    });
  });

  it("writes nothing in a dry run, but reports what it would write", async () => {
    const payment = await insertTransaction();
    await insertInvoice();

    const summary = await runAutoMatching(db, SIREN, { dryRun: true });
    expect(summary).toMatchObject({ dryRun: true, written: 1 });
    expect(await matchedInvoiceOf(payment)).toBeNull();
  });

  it("rolls back and fails when the database blocks the run", async () => {
    const payment = await insertTransaction();
    await insertInvoice();
    const impatient = new Pool({
      ...connection,
      database: TEST_DATABASE,
      statement_timeout: 500,
    });
    const locker = await db.connect();
    try {
      await locker.query("begin");
      await locker.query("lock table buying_invoice in access exclusive mode");

      await expect(runAutoMatching(impatient, SIREN)).rejects.toThrow(
        /nothing was written: canceling statement due to statement timeout/,
      );
    } finally {
      await locker.query("rollback");
      locker.release();
      await impatient.end();
    }
    expect(await matchedInvoiceOf(payment)).toBeNull();
  });
});
