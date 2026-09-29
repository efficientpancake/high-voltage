-- High Voltage: cloud-saved projects.
-- Paste this whole file into Supabase → SQL Editor → New query → Run. Safe to run once.

create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title       text not null default 'Untitled project',
  view        text not null default 'wizard',
  brief       jsonb not null default '{}'::jsonb,
  outputs     jsonb not null default '{}'::jsonb,
  chats       jsonb not null default '{}'::jsonb,
  files       jsonb not null default '{}'::jsonb,  -- { docs: [...], social: [...] }
  active_tab  int  not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists projects_user_updated_idx
  on public.projects (user_id, updated_at desc);

-- Row Level Security: each person can only ever see and change their own projects.
alter table public.projects enable row level security;

create policy "Read own projects"   on public.projects for select using (auth.uid() = user_id);
create policy "Create own projects" on public.projects for insert with check (auth.uid() = user_id);
create policy "Update own projects" on public.projects for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Delete own projects" on public.projects for delete using (auth.uid() = user_id);
