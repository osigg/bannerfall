-- Bannerfall online schema. Paste into the Supabase SQL editor and run once.
-- One row per world holds the full game state as JSON plus a version number
-- used for optimistic concurrency (see js/store-supabase.js).

create table if not exists public.worlds (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  state jsonb,                    -- null while the world is still a lobby
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.world_members (
  world_id uuid not null references public.worlds(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  joined_at timestamptz not null default now(),
  primary key (world_id, user_id)
);

alter table public.worlds enable row level security;
alter table public.world_members enable row level security;

-- security definer avoids recursive RLS when policies check membership
create or replace function public.is_member(w uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.world_members where world_id = w and user_id = auth.uid());
$$;

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists worlds_touch on public.worlds;
create trigger worlds_touch before update on public.worlds for each row execute function public.touch_updated_at();

drop policy if exists "read worlds you belong to" on public.worlds;
create policy "read worlds you belong to" on public.worlds for select
  using (public.is_member(id) or owner = auth.uid());

drop policy if exists "create your own worlds" on public.worlds;
create policy "create your own worlds" on public.worlds for insert
  with check (owner = auth.uid());

-- Members can write state. This trusts your friends: a member could write any
-- state. Move validation into an Edge Function if that ever matters.
drop policy if exists "members update worlds" on public.worlds;
create policy "members update worlds" on public.worlds for update
  using (public.is_member(id)) with check (public.is_member(id));

drop policy if exists "see the roster of your worlds" on public.world_members;
create policy "see the roster of your worlds" on public.world_members for select
  using (public.is_member(world_id));

drop policy if exists "join as yourself" on public.world_members;
create policy "join as yourself" on public.world_members for insert
  with check (user_id = auth.uid());

drop policy if exists "rename yourself" on public.world_members;
create policy "rename yourself" on public.world_members for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
