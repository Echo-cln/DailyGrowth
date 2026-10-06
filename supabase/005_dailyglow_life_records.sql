-- Per-user daily life records shared by DailyGlow web and Android.
-- Payload is a versioned JSON snapshot; RLS ensures users can access only their own row.

create table if not exists public.daily_life_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  record_date date not null,
  record_type text not null default 'daily_life'
    check (record_type = 'daily_life'),
  schema_version integer not null default 1,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, record_date, record_type)
);

create index if not exists daily_life_records_user_date_idx
  on public.daily_life_records (user_id, record_date desc);

alter table public.daily_life_records enable row level security;
grant select, insert, update, delete
  on public.daily_life_records to authenticated, service_role;

drop policy if exists "Users manage own daily life records"
  on public.daily_life_records;
create policy "Users manage own daily life records"
  on public.daily_life_records
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

comment on table public.daily_life_records is
  'Per-user DailyGlow life module snapshot by record date; RLS restricts access to the owning user.';
