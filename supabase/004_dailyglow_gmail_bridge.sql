-- Preserve the 08:00 growth brief, 09:00 fund strategy, and 14:00 intraday
-- review as separate daily records. Neither fund report may overwrite the other.
alter table public.daily_hub_items
  drop constraint if exists daily_hub_items_content_type_check;

alter table public.daily_hub_items
  add constraint daily_hub_items_content_type_check
  check (content_type in ('growth_brief', 'fund_strategy', 'market_intraday', 'workout_plan'));
