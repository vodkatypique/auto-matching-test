export type TransactionRow = {
  id: string;
  amount_cents: number;
  label: string;
  date: Date;
};

export type InvoiceRow = {
  id: string;
  supplier_name: string;
  invoice_number: string;
  tax_free_total_cents: number;
  vat_amount_cents: number;
  due_date: string;
};
