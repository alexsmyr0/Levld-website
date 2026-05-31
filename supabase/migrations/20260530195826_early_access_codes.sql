create table public.early_access_codes (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null unique,
  email               text not null,
  stripe_session_id   text unique,
  stripe_customer_id  text,
  amount_paid_cents   integer,
  currency            text default 'usd',
  status              text not null default 'issued',  -- issued | redeemed | revoked
  redeemed_at         timestamptz,
  redeemed_by_user_id uuid references auth.users(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index early_access_codes_email_idx  on public.early_access_codes (email);
create index early_access_codes_status_idx on public.early_access_codes (status);

-- RLS on, zero policies = deny-all to anon/authenticated.
-- Only the service-role Edge Functions read/write this table.
alter table public.early_access_codes enable row level security;
