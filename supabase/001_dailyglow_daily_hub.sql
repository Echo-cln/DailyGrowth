-- DailyGlow unified daily hub
-- Applied to Supabase project bwqtqwlutkjuwwvymyqs on 2026-09-29.

create table if not exists public.daily_hub_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  content_date date not null,
  content_type text not null check (content_type in ('growth_brief', 'market_brief', 'workout_plan')),
  schema_version integer not null default 1,
  title text not null,
  summary text not null default '',
  payload jsonb not null default '{}'::jsonb,
  import_source text not null default 'manual_import',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, content_date, content_type)
);

create index if not exists daily_hub_items_user_date_idx on public.daily_hub_items(user_id, content_date desc);

create table if not exists public.daily_hub_action_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  item_id uuid not null references public.daily_hub_items(id) on delete cascade,
  action_key text not null,
  completed boolean not null default false,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, item_id, action_key)
);

create index if not exists daily_hub_actions_user_item_idx on public.daily_hub_action_states(user_id, item_id);

alter table public.daily_hub_items enable row level security;
alter table public.daily_hub_action_states enable row level security;

grant select, insert, update, delete on public.daily_hub_items to authenticated, service_role;
grant select, insert, update, delete on public.daily_hub_action_states to authenticated, service_role;

drop policy if exists "Users manage own daily hub items" on public.daily_hub_items;
create policy "Users manage own daily hub items" on public.daily_hub_items
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage own daily hub actions" on public.daily_hub_action_states;
create policy "Users manage own daily hub actions" on public.daily_hub_action_states
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);