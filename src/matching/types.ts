// The statuses found in the data. The database stores them as free text.
export type TransactionStatus = "Booked" | "Pending";
export type InvoiceStatus = "Pending" | "ToPay" | "Paid" | "Cancelled";

// The rules that select candidate invoices in SQL: eligibility, then an exact
// amount and a due date within the window.
export type CandidateRules = {
  transactionStatus: TransactionStatus;
  invoiceStatuses: InvoiceStatus[];
  maxDaysDueBeforePayment: number;
  maxDaysDueAfterPayment: number;
};

export type TransactionRow = {
  id: string;
  label: string;
  reference: string | null;
};

export type InvoiceRow = {
  id: string;
  supplier_name: string | null;
  invoice_number: string | null;
};

// An eligible transaction and the invoices that pass the SQL rules for it
// (possibly none).
export type TransactionCandidates = {
  transaction: TransactionRow;
  candidates: InvoiceRow[];
};

// What the job decided for one transaction, and why.
// - no_candidate: no invoice passes every rule;
// - ambiguous: several invoices pass and nothing tells them apart;
// - contested: the chosen invoice is also chosen by another transaction.
export type MatchDecision =
  | { transactionId: string; outcome: "matched"; invoiceId: string }
  | {
      transactionId: string;
      outcome: "no_candidate" | "ambiguous" | "contested";
    };
