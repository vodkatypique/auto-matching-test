export type TransactionRow = {
  id: string;
  amount: number;
  label: string;
  date: Date;
};

export type InvoiceRow = {
  id: string;
  supplier_name: string;
  invoice_number: string;
  tax_free_total: number;
  vat_amount: number;
  due_date: string;
};
