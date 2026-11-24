-- Who matched a transaction, when, and in which run. A bad run can then be
-- listed and reverted without touching the matches made by users:
--   update transaction
--   set matched_invoice_id = null, match_source = null,
--       matched_at = null, match_run_id = null
--   where match_run_id = '<run id>' and match_source = 'auto';
-- Matches made before this migration keep a null match_source: whether the
-- job or a user made them is unknown.
alter table transaction
  add column match_source text check (match_source in ('auto', 'manual')),
  add column matched_at timestamptz,
  add column match_run_id uuid;

-- An invoice is paid by at most one live transaction. This is the last line
-- of defence when two runs, or a run and a user, match the same invoice at
-- the same time. In production, the old job already linked some invoices to
-- several transactions: they must be listed and fixed before this index can
-- be created, and it should then be created concurrently to avoid locking
-- the table.
create unique index transaction_matched_invoice_id_key
  on transaction (matched_invoice_id)
  where matched_invoice_id is not null and deleted_at is null;
