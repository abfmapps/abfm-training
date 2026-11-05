-- ABFM Training: database schema.
-- Staff never read tables directly: everything they do goes through the functions in 0002,
-- which check their sign-in. Only admins (emails listed in public.admins) can read and edit tables.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- App content: one JSON document per file the app used to have (videos, settings, paths, toolbox, channels, pending, health).
create table public.docs (
  name text primary key,
  content jsonb not null,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by text
);

-- Admin accounts (Supabase Auth email + password). Only these emails can use the admin portal.
create table public.admins (
  email text primary key,
  added_at timestamptz not null default now()
);

-- Staff who may sign in with their HR number.
create table public.staff (
  hr text primary key,
  name text not null,
  site text not null default '',
  trade text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Signed-in phones. Only a hash of each sign-in token is kept.
create table public.sessions (
  token_hash text primary key,
  hr text not null references public.staff(hr) on delete cascade on update cascade,
  device text,
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
create index sessions_hr_idx on public.sessions(hr);

-- Everything staff complete: watched videos, quizzes, finished paths, certificates, sign-offs.
create table public.records (
  id bigint generated always as identity primary key,
  time timestamptz not null default now(),
  hr text,
  name text,
  site text,
  trade text,
  type text not null check (type in ('video', 'quiz', 'path', 'cert', 'signoff')),
  item text,
  title text,
  score numeric,
  n integer,
  pass boolean,
  code text,
  lang text,
  verified boolean not null default false,
  device text
);
create index records_hr_idx on public.records(hr);
create index records_time_idx on public.records(time);

create table public.certificates (
  code text primary key,
  time timestamptz not null default now(),
  hr text,
  name text,
  site text,
  trade text,
  path text,
  title text,
  score numeric,
  signed_by text,
  signed_at timestamptz
);
create index certificates_hr_idx on public.certificates(hr);

-- Supervisors sign off certificates with a PIN. Only a hash of the PIN is kept.
create table public.supervisors (
  name text primary key,
  pin_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Usage counts per day: video plays and searches that found nothing. No names.
create table public.stats (
  day date not null,
  kind text not null check (kind in ('view', 'nores')),
  key text not null,
  count integer not null default 0,
  primary key (day, kind, key)
);

-- "Request a video" from staff.
create table public.requests (
  id bigint generated always as identity primary key,
  time timestamptz not null default now(),
  topic text not null,
  category text,
  details text,
  name text,
  site text,
  lang text,
  hr text,
  status text not null default 'new'
);

-- Rate limits (sign-in attempts, PIN tries, AI questions…).
create table private.rate (
  key text primary key,
  n integer not null,
  reset_at timestamptz not null
);

-- Row level security: on for every table; only admins get policies.
alter table public.docs enable row level security;
alter table public.admins enable row level security;
alter table public.staff enable row level security;
alter table public.sessions enable row level security;
alter table public.records enable row level security;
alter table public.certificates enable row level security;
alter table public.supervisors enable row level security;
alter table public.stats enable row level security;
alter table public.requests enable row level security;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins a where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

create policy "admins read docs" on public.docs for select to authenticated using (public.is_admin());
create policy "admins read admins" on public.admins for select to authenticated using (public.is_admin());
create policy "admins add admins" on public.admins for insert to authenticated with check (public.is_admin());
create policy "admins remove admins" on public.admins for delete to authenticated using (public.is_admin());
create policy "admins manage staff" on public.staff for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admins read sessions" on public.sessions for select to authenticated using (public.is_admin());
create policy "admins end sessions" on public.sessions for delete to authenticated using (public.is_admin());
create policy "admins read records" on public.records for select to authenticated using (public.is_admin());
create policy "admins manage certificates" on public.certificates for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admins read supervisors" on public.supervisors for select to authenticated using (public.is_admin());
create policy "admins remove supervisors" on public.supervisors for delete to authenticated using (public.is_admin());
create policy "admins read stats" on public.stats for select to authenticated using (public.is_admin());
create policy "admins manage requests" on public.requests for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Staff (anon) have no direct table access at all.
revoke all on all tables in schema public from anon;
