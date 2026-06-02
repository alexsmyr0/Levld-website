-- Fix: early_access_codes.redeemed_by_user_id must null out when its referenced
-- auth.users row is deleted — not block the delete.
--
-- As shipped, the FK had no ON DELETE rule (defaults to NO ACTION), so deleting
-- any user who had redeemed a code failed with a foreign-key violation. That
-- breaks account deletion and the C-10 anon-user purge. This restores the
-- original G-03 intent (`on delete set null`): the code row survives, marked
-- redeemed, with redeemed_by_user_id cleared.
--
-- NOTE: early_access_codes is owned by the Levld-website repo (shared Supabase
-- project). This corrective migration is mirrored there too — see that repo.

alter table public.early_access_codes
  drop constraint early_access_codes_redeemed_by_user_id_fkey;

alter table public.early_access_codes
  add constraint early_access_codes_redeemed_by_user_id_fkey
    foreign key (redeemed_by_user_id) references auth.users (id) on delete set null;
