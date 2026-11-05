-- Shared keys for all admins (Gemini, GitHub), set by the owner and never sent to any browser.
alter table public.admins add column if not exists role text not null default 'admin' check (role in ('owner', 'admin'));
update public.admins set role = 'owner' where lower(email) = 'zarrade.omar@gmail.com';

create table if not exists private.app_secrets (
  name text primary key check (name in ('gemini', 'github')),
  value text not null,
  updated_at timestamptz not null default now(),
  updated_by text
);

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins a where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', '')) and a.role = 'owner');
$$;

-- Owner only: save (or clear, with an empty value) a shared key.
create or replace function public.admin_set_secret(p_name text, p_value text) returns jsonb
language plpgsql volatile security definer set search_path = public, private as $$
begin
  if not public.is_owner() then raise exception 'only the owner can change shared keys' using errcode = '42501'; end if;
  if p_name not in ('gemini', 'github') then raise exception 'unknown key %', p_name; end if;
  if coalesce(btrim(p_value), '') = '' then
    delete from private.app_secrets where name = p_name;
  else
    insert into private.app_secrets (name, value, updated_by) values (p_name, btrim(p_value), auth.jwt() ->> 'email')
    on conflict (name) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Any admin: which shared keys exist (never the keys themselves), and whether you are the owner.
create or replace function public.admin_secret_status() returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not public.is_admin() then raise exception 'not an admin' using errcode = '42501'; end if;
  return jsonb_build_object('ok', true, 'owner', public.is_owner(),
    'gemini', exists (select 1 from private.app_secrets where name = 'gemini'),
    'github', exists (select 1 from private.app_secrets where name = 'github'),
    'geminiSetAt', (select updated_at from private.app_secrets where name = 'gemini'),
    'githubSetAt', (select updated_at from private.app_secrets where name = 'github'));
end $$;

-- Server functions only (service role): read a shared key.
create or replace function public.service_get_secret(p_name text) returns text
language sql stable security definer set search_path = private as $$
  select value from private.app_secrets where name = p_name;
$$;

revoke all on function public.is_owner(), public.admin_set_secret(text, text), public.admin_secret_status(), public.service_get_secret(text) from public, anon, authenticated;
grant execute on function public.is_owner(), public.admin_set_secret(text, text), public.admin_secret_status() to authenticated;
grant execute on function public.service_get_secret(text) to service_role;
