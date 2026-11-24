-- due_date was free text, read by new Date() in JavaScript as UTC midnight,
-- while transaction.date came back as local midnight: the date window shifted
-- with the machine's time zone. As a date column, Postgres stores a real
-- calendar date and rejects impossible ones (2026-02-30).
-- Before running this in production, check that every value is ISO
-- (YYYY-MM-DD): with the default DateStyle, the cast reads 05/08/2026 as May 8.
alter table buying_invoice
  alter column due_date type date using due_date::date;
