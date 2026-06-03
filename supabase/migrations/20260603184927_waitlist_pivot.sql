-- Waitlist pivot: the $5 paid "lifetime access" flow is replaced by a free
-- waitlist that grants 50% off at launch. We REUSE early_access_codes rather
-- than make a new table, so the existing redeem-code Edge Function keeps working
-- unchanged (it keys off code + email + status='issued').
--
-- Changes:
--   * add waitlist contact fields (first_name, last_name, phone)
--   * add offer_type to tell legacy paid 'lifetime' rows apart from 'waitlist_50'
--   * enforce ONE code per email (the anti-"infinite codes" guard) at the DB
--     level, on lower(email), so casing can never sneak a duplicate past it.
--
-- The Stripe columns (stripe_session_id, amount_paid_cents, …) stay — they're
-- already nullable and still hold the legacy paid rows. New waitlist rows leave
-- them null.
--
-- service_role already has select/insert/update on this table (see
-- 20260531111202_grant_service_role_early_access.sql), which is all the new
-- join-waitlist function needs. No new GRANT required.
--
-- NOTE (shared Supabase project): early_access_codes is owned by the
-- Levld-website repo but the project is shared with the Levld iOS app. This
-- migration is mirrored into that repo's supabase/migrations/ so both histories
-- stay a superset of remote. Apply with scripts/db-push-all.sh.

alter table public.early_access_codes
  add column if not exists first_name text,
  add column if not exists last_name  text,
  add column if not exists phone      text,
  add column if not exists offer_type text;

-- Backfill: every row that exists today is a legacy paid lifetime code.
update public.early_access_codes
  set offer_type = 'lifetime'
  where offer_type is null;

alter table public.early_access_codes
  alter column offer_type set default 'waitlist_50',
  alter column offer_type set not null;

-- Dedupe before adding the unique index: collapse any pre-existing rows that
-- share an email (test data from building the old flow). Per email we KEEP the
-- best row — a redeemed one if present, otherwise the most recent — and delete
-- the rest. Safe to rerun (no-op once unique).
delete from public.early_access_codes a
using (
  select id,
         row_number() over (
           partition by lower(email)
           order by (status = 'redeemed') desc, created_at desc
         ) as rn
  from public.early_access_codes
) b
where a.id = b.id and b.rn > 1;

-- One code per email. Enforced on lower(email) so casing can't sneak a dup past.
create unique index if not exists early_access_codes_email_unique
  on public.early_access_codes (lower(email));
