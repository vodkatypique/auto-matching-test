-- real is a binary float: most cent values cannot be stored exactly.
-- A direct real -> numeric cast keeps only 6 significant digits
-- (12345.67 becomes 12345.7), so go through float8 and round to the cent.
--
-- Why two decimals: I checked the business rules. These columns hold final
-- amounts (bank amounts, totals excluding VAT, VAT amounts), and in France
-- those are expressed to the cent. If the system ever has to support other
-- currencies, this choice must be revisited: not every currency has two
-- decimals (JPY has none, KWD has three).
alter table transaction
  alter column amount type numeric(12, 2)
    using round(amount::float8::numeric, 2);

alter table buying_invoice
  alter column tax_free_total type numeric(12, 2)
    using round(tax_free_total::float8::numeric, 2),
  alter column vat_amount type numeric(12, 2)
    using round(vat_amount::float8::numeric, 2);
