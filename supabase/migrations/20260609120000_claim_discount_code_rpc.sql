-- MIRRORED FROM THE LEVLD-WEBSITE REPO — DO NOT EDIT HERE.
-- This Supabase project is shared by the website (early-access / waitlist flow)
-- and the iOS app. The website repo owns the source of truth for the
-- `early_access_codes` table and this RPC; this file is vendored only so the iOS
-- repo's migration history matches remote and `supabase db push` works.
--
-- claim_discount_code (G-04, rewritten for the 2026-06-09 waitlist / 50%-off
-- pivot). The iOS app (G-11 DiscountService) calls this when the user enters a
-- code on the referral screen. It one-shot-claims a `waitlist_50` code in
-- `early_access_codes` and returns a (success, error_code, message) verdict.
--
-- It does NOT grant entitlement and writes NO `subscriptions` row — unlike the
-- dead $5 model, the discount is only realized when the user buys the discounted
-- product on the paywall. The Superwall `has_waitlist_discount` attribute (set by
-- the app on success) routes the paywall to the 50%-off variant (D-12).
--
-- Concurrency: `for update` row lock + SECURITY DEFINER + RLS-locked table means
-- two racing claims on the same code resolve to exactly one `success`, the other
-- `already_redeemed`. The `error_code` strings below are a contract with the
-- app's DiscountService.outcome(forErrorCode:) — do not rename them.

create or replace function public.claim_discount_code(p_code text)
returns table (success boolean, error_code text, message text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row     public.early_access_codes;
  v_user_id uuid := auth.uid();
begin
  -- No JWT (not even an anonymous session) → cannot attribute the claim.
  if v_user_id is null then
    return query select false, 'unauthenticated', 'Sign in first';
    return;
  end if;

  -- Case-insensitive match, scoped to waitlist codes. Legacy 'lifetime' rows are
  -- not claimable through this path → they fall through to 'invalid_code'.
  select * into v_row
  from public.early_access_codes
  where upper(code) = upper(p_code)
    and offer_type = 'waitlist_50'
  for update;

  if not found then
    return query select false, 'invalid_code', 'Code not recognized';
    return;
  end if;

  -- status vocabulary: issued | redeemed | revoked. Only 'issued' is claimable.
  if v_row.status = 'redeemed' then
    return query select false, 'already_redeemed', 'This code has already been used';
    return;
  end if;

  if v_row.status = 'revoked' then
    return query select false, 'revoked', 'This code is no longer valid';
    return;
  end if;

  update public.early_access_codes
     set status              = 'redeemed',
         redeemed_by_user_id = v_user_id,
         redeemed_at         = now(),
         updated_at          = now()
   where id = v_row.id;

  return query select true, null::text, 'Discount applied';
end;
$$;

-- Least-privilege: the function is EXECUTE-granted to PUBLIC by default. Lock it
-- down to authenticated sessions only (which includes anonymous-auth users — they
-- carry a real auth.uid()). anon (no JWT) has no reason to call it.
revoke all on function public.claim_discount_code(text) from public;
grant execute on function public.claim_discount_code(text) to authenticated;
