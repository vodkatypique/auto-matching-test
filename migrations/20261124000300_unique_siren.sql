-- The job finds the company by its SIREN. Without this constraint, a duplicate
-- SIREN would make it process whichever row comes first, and never the other.
alter table company add constraint company_siren_key unique (siren);
