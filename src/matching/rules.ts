import type {
  CandidateRules,
  InvoiceStatus,
  TransactionStatus,
} from "./types";

// README rule: the due date falls between 3 days before and 30 days after
// the transaction date.
export const MAX_DAYS_DUE_BEFORE_PAYMENT = 3;
export const MAX_DAYS_DUE_AFTER_PAYMENT = 30;

// Invoice statuses a payment can be matched to.
// Cancelled is never eligible: a cancelled invoice will never be paid.
// Pending and Paid are ambiguous and need a product decision:
// - Pending may mean "awaiting payment" or "awaiting the customer's validation";
// - Paid may mean "the customer marked it as paid", the bank transaction being
//   that payment, or "already settled by other means", in which case matching
//   it would record a second payment.
// The seed data points to the first reading for both: no Paid invoice is
// linked to a transaction, and most Paid candidates are confirmed by the bank
// label. So they are kept. Removing a status from this list excludes it.
export const ELIGIBLE_INVOICE_STATUSES = [
  "ToPay",
  "Pending",
  "Paid",
] satisfies InvoiceStatus[];

// Only booked bank transactions: a pending one can still change or disappear.
export const ELIGIBLE_TRANSACTION_STATUS = "Booked" satisfies TransactionStatus;

export const CANDIDATE_RULES: CandidateRules = {
  transactionStatus: ELIGIBLE_TRANSACTION_STATUS,
  invoiceStatuses: ELIGIBLE_INVOICE_STATUSES,
  maxDaysDueBeforePayment: MAX_DAYS_DUE_BEFORE_PAYMENT,
  maxDaysDueAfterPayment: MAX_DAYS_DUE_AFTER_PAYMENT,
};
