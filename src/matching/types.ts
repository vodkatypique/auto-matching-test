// The statuses found in the data. The database stores them as free text.
export type TransactionStatus = "Booked" | "Pending";
export type InvoiceStatus = "Pending" | "ToPay" | "Paid" | "Cancelled";

export type TransactionRow = {
  id: string;
  amount_cents: number;
  label: string;
  date: string;
};

export type InvoiceRow = {
  id: string;
  supplier_name: string;
  invoice_number: string;
  tax_free_total_cents: number;
  vat_amount_cents: number;
  due_date: string | null;
};

// An invoice whose due date is known. Used as a type predicate when filtering
// out invoices without one, so TypeScript knows due_date is a string after.
export type InvoiceWithDueDate = InvoiceRow & { due_date: string };
