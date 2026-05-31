-- The Edge Functions connect as `service_role` (bypasses RLS) but still need
-- table-level privileges. Without these, inserts/updates fail with 42501
-- "permission denied for table early_access_codes".
--
-- stripe-webhook: INSERT ... RETURNING  -> needs INSERT + SELECT
-- redeem-code:    UPDATE ... RETURNING  -> needs UPDATE + SELECT
grant select, insert, update on table public.early_access_codes to service_role;
