-- Run once in your Supabase project: Dashboard → SQL Editor → New query → paste → Run.
-- Each row is one saved document (a course, or the "meta" marker) owned by one user.

create table if not exists public.user_docs (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id         text        not null,
  body       jsonb       not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- Row-level security: a signed-in user can only see and change their own rows.
alter table public.user_docs enable row level security;

create policy "Read own docs"   on public.user_docs for select using (auth.uid() = user_id);
create policy "Insert own docs" on public.user_docs for insert with check (auth.uid() = user_id);
create policy "Update own docs" on public.user_docs for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Delete own docs" on public.user_docs for delete using (auth.uid() = user_id);
