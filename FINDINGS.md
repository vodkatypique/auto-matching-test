# FINDINGS: the auto-matching job

## Summary

The job does not follow the principle stated in the README: when no candidate is convincing, the transaction must stay unmatched. The code matches as soon as an invoice has the right amount within the date window. It does not check that the rows are allowed to be matched, and above all it guesses when several invoices fit.

Two more defects come on top. The result depends on the time zone of the machine running the job. And each run rewrites the previous one, without leaving any trace.

Ranking: first what writes wrong accounting records that nobody notices, then what prevents fixing them, then what makes results irreproducible or failures invisible, then missed matches, and last the cost.

---

## 1. The job guesses when several invoices fit

**Problem.** When several invoices have the right amount within the window, the code ranks them and takes the first one. On a tie, the order in which the database returns the rows decides.

**Consequence.** The README asks to leave the transaction unmatched when no candidate is convincing, but the job picks one anyway. For a subscription, the payment goes to the closest due date, which is not necessarily the one actually paid, and the real invoice stays open. The record looks plausible, so nobody will check it.

---

## 2. Nothing filters which rows may be matched

**Problem.** Both queries take every transaction and every invoice of the company, with no condition. The README talks about unmatched outgoing transactions. The code also takes:
- incoming payments: because of Math.abs, a transfer received can "pay" a supplier invoice of the same amount
- deleted transactions
- transactions still "Pending"
- transactions already matched
- cancelled invoices
- deleted invoices

**Consequence.** A wrong record:
- a customer payment matched to a supplier invoice makes both ledgers wrong
- a match on a cancelled invoice leaves the invoice that was actually paid open.

---

## 3. The same invoice matched several times

**Problem.** Invoices already matched are not excluded from the candidates. Each transaction is handled on its own, and nothing in the database prevents two transactions from pointing to the same invoice.

**Consequence.**
- An invoice looks paid two or three times.
- When a supplier really is paid twice in a row, the second payment actually settles another invoice.
- A duplicate debit, which the customer should probably dispute with their bank, looks settled.

---

## 4. Amount and date are not enough to prove a payment

**Problem.** The README asks for a "convincing" candidate. The code settles for the amount and the date window. The bank label (supplier name, invoice number) is only used to break ties between candidates, through a score adjustment in the code. It is never used to require evidence or to rule a candidate out.

**Consequence.** Payments are booked against the wrong supplier, even when the label clearly says who was paid. The chosen invoice looks settled and the real one stays open. And amounts repeat a lot: 35,017 invoices for only 25,702 distinct totals, and 153 Orange invoices of €59.99. Having the same amount proves nothing.

---

## 5. The label is read the wrong way

**Problem.** The label bonus tests label.includes(name) after a mere trim().toLowerCase():
- an empty string is contained in any text: an invoice without a number gets the bonus for every transaction
- it searches for a substring, not a word: "sfr" is found in "sfri"
- a NULL supplier makes the transaction fail (see 8)
- citing the invoice number gives the same bonus as citing the supplier, although the number is far more precise, which makes little sense
- the "reference" column, which seems meant for this, is never read
- legal names rarely appear as is in a label ("Slack Technologies", or "Total Energies" against "TOTALENERGIES"): the right invoice does not get the bonus.

**Consequence.** The bonus sometimes favours the wrong invoice: on the seed, the "VIR TRANSFERT SFRI SARL" payment goes to SFR, and "PRLV SEPA SAGE" goes to Qonto, whose invoice number is empty. And when the label writes the supplier differently, the right invoice never gets the bonus.

---

## 6. Every run rewrites everything, without leaving a trace

**Problem.** The job does not filter out transactions already matched, and writes unconditionally. Nothing in the database records who made a match (the job or a user), when, or in which run. And when the job no longer finds a candidate, it leaves the row alone: a match that became wrong or ambiguous is never removed.

**Consequence.**
- A match made by hand by a user can be overwritten.
- A match the user undid is recreated by the next run.
- After a bad run (a bug, a bad deployment), what it wrote cannot be listed, so it cannot be reverted without touching manual matches. According to the README, this code is already in production: automatic and manual matches are therefore already mixed up.

---

## 7. The result depends on the time zone of the machine

**Problem.** node-pg turns a `date` column into a `Date` object at local midnight. `due_date`, on the other hand, is text (`'YYYY-MM-DD'`), which `new Date()` reads as UTC midnight. `dayDiff` subtracts the two.

**Consequence.** On a machine set to Paris time, every difference is shifted by one day. The same job, on the same data, therefore produces different matches depending on the server.

---

## 8. Failures go unnoticed

**Problem.** Each transaction is handled inside a try/catch that prints "skip" and the error, without any id, then moves on to the next one, and the process exits with code 0 as long as the company was found.

A concrete example, visible from the very first run: every run prints `skip TypeError: Cannot read properties of null (reading 'trim')`.
- Transaction `e0000013-...-001` (-€333.33, "PRLV SEPA ASSURANCE") has a single candidate invoice: 277.78 + 55.55, due 2026-01-18.
- That invoice has no supplier (`supplier_name` is NULL), so `normalizeLabel(null)` crashes.
- The `catch` prints "skip" followed by the error, and the job carries on.

**Consequence.**
- Incomplete data loses a match that was the only possible one. The same invoice would block any other transaction it is a candidate for.
- The error does not say which transaction is involved (I had to add code to find out where it came from), and the job ends normally. Nobody will know it was skipped.
- If the database restarts or becomes unreachable during the run, all remaining transactions are skipped within milliseconds. The job prints "Matched N of 1200", ends normally, and the scheduler records a success.
- A blocked query can also make a run last forever, until it overlaps the next one.

---

## 9. Floating-point amounts make matches fail

**Problem.** Amounts are stored as floats and compared in JS with ===, so the classic representation issues mean the result is very often not exact.

**Consequence.** Obvious matches are never made, without any error.

---

## 10. Performance

**Problem.** getCandidates is called on every loop iteration. All the company's invoices are reloaded for each transaction, with no filter and no index.

**Consequence.** 1,200 × 35,017 = 42 million rows are transferred in 1,708 queries, about 50 seconds for a modest-sized company. Most of that time is spent in Node decoding rows that are thrown away. The cost grows with each customer's invoice history, and every query reads the whole invoice table again.

---

## Other points

- **The program input is hard-coded and injected into the SQL.** The SIREN is hard-coded in main, then injected as is into the query, like every other value. This is not exploitable today, but it becomes so as soon as the SIREN comes from user input (API, command line, message queue). On top of that, the job runs as the Postgres superuser.
- **The SIREN is not unique in the database.** `rows: [company]` takes whichever row comes first if there is a duplicate.
- **A transaction on a non-existent account disappears silently.** `e0000011` belongs to account `ac...099`, which does not exist. The join drops it without reporting anything (there is no foreign key).
- **A duplicated bank import is matched twice.** `e0000012-...-001` and `-002` have the same `remote_id` on the same account, and both are matched to the same rent invoice. Nothing makes `(account_id, remote_id)` unique.
- **Invoices without a due date are excluded by accident.** There are 1,051 of them: `new Date(null)` is January 1st, 1970, always outside the window. The result is right, but somewhat by luck.
- **`db:reset` is a bit dangerous.** It drops the schema of whatever database the `PG*` variables point to (if another project or environment variables are set on the machine, be careful).

## Code quality

- **Row types.** `TransactionRow` and `InvoiceRow` are mere declarations laid over a `select *`. They declare `string` for columns that can be NULL (`supplier_name`, `due_date`), and leave out the columns the rule needs (`status`, `deleted_at`, `matched_invoice_id`, `invoice_status`). So TypeScript cannot catch some type crashes.
- **No dry run.** There is no way to see what a change to the rule would write before it writes into customers' accounting.
- **The decision logic is mixed with database access.** `findMatch` and `scoreCandidate` are not exported, and the connection pool is global. The decision cannot be tested without a database.
- **The tests check nothing that matters, and nothing checks the types.** The tests cover two small helper functions.

## Found during the rework

### Large amounts may already have lost their cents

**Problem.** Moving the amounts to `numeric` means converting the existing `real` values. Two traps:
- a direct `real::numeric` cast keeps only 6 significant digits: 12,345.67 becomes 12,345.70;
- worse, `real` only keeps about 7 significant digits from the moment a value is stored. Above €131,072, two amounts one cent apart can be stored as the same value.

**Consequence.** If the production database holds amounts above that threshold, some may have been stored wrong from the start, without any error. The gap grows with the amount: at most 1 cent up to €262,144, up to 3 cents around €1M, up to 50 cents around €10M. No migration can recover the original value from the database, and an exact comparison will never match an amount that is one cent off with its invoice.

**Fix.**
- The migration goes through `float8` and then rounds to the cent: `round(col::float8::numeric, 2)`. This is exact as long as the `real` had not already lost the cent.
- Before migrating production, count the affected amounts (`abs(amount) >= 131072`, and the same for invoices). If there are any, fix them from the source: re-import the bank feed using `remote_id`, extract the original invoice again.

### Requiring evidence also loses correct matches

**Finding.** The rework only accepts an invoice if the bank label designates it: by its number, or by the supplier's name, all of whose distinctive words must appear as whole words. On the seed, at that step (before ambiguous cases were left unmatched), matches went from 551 to 461: 92 earlier matches disappeared, 2 of which were replaced by the right invoice (SFRI SARL instead of SFR, Sage instead of Qonto). The 92 break down as follows:
- 48 whose label contains no word of the invoice's supplier. 30 of them were wrong suppliers: "VIR TRANSGOURMET" → Uber, "CB AMAZON BUSINESS EU" → Microsoft. Losing them is intended. The other 18 are "PRLV SEPA OVH SAS" → OVHcloud: the same supplier under another name, so correct matches that are missed.
- 44 where the supplier is probably right, but the label only writes part of its name: "CB SLACK T0123" → Slack Technologies, "CB METRO PARIS NANTERRE" → Metro Cash & Carry, "VIR SEPA LEFEBVRE AVOCATS" → Cabinet Lefebvre Avocats, "CB SNCF INTERNET" → SNCF Voyageurs. These are correct matches that are missed.

**Why I keep the strict rule.** The README says it: an incorrect pairing is worse than no pairing at all. An unmatched transaction stays visible, and the customer handles it by hand. A wrong match goes unnoticed. And a looser rule, where a single word of the name would be enough, wrongly designates another supplier in about twenty labels of the seed: "PRO" finds Free Pro in "CB LEROY MERLIN PRO", "DUPONT" finds Imprimerie Dupont in the incoming payment "VIR RECU CLIENT DUPONT", "CABINET" mixes up three different firms.

**How to recover these cases without losing precision.** A per-company alias table ("SLACK" → Slack Technologies, "OVH SAS" → OVHcloud), learned from the matches users make or confirm by hand. It is deterministic and explainable, and AI could suggest aliases for a human to validate.

### Without statistics, the candidate query takes minutes instead of milliseconds

**Finding.** Once candidate selection moved to a single SQL query (a join between eligible transactions and invoices), the first run right after `db:reset` did not finish: more than 5 minutes. Right after a bulk load, the tables have no statistics yet. Postgres assumes they hold a single row, picks nested loops, and recomputes the anti-join ("invoice already taken") for every transaction. After an `ANALYZE`, it picks merge and hash joins, and the same query takes 35 ms.

**What I did.** `db:reset` runs `ANALYZE` after the seed. In production, statistics are kept up to date automatically, but a large import right before the job could bring the problem back. The 30-second statement timeout then turns it into a visible error (run rolled back, exit code 1) instead of a stuck job. The real prevention would be to run `ANALYZE` at the end of bulk imports.
