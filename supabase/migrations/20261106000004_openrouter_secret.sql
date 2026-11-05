-- OpenRouter: a third AI that can do the text jobs instead of Groq (Settings → AI).
alter table private.app_secrets drop constraint if exists app_secrets_name_check;
alter table private.app_secrets add constraint app_secrets_name_check check (name in ('gemini', 'github', 'groq', 'openrouter'));

create or replace function public.admin_set_secret(p_name text, p_value text) returns jsonb
language plpgsql volatile security definer set search_path = public, private as $$
begin
  if not public.is_owner() then raise exception 'only the owner can change shared keys' using errcode = '42501'; end if;
  if p_name not in ('gemini', 'github', 'groq', 'openrouter') then raise exception 'unknown key %', p_name; end if;
  if coalesce(btrim(p_value), '') = '' then
    delete from private.app_secrets where name = p_name;
  else
    insert into private.app_secrets (name, value, updated_by) values (p_name, btrim(p_value), auth.jwt() ->> 'email')
    on conflict (name) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by;
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_secret_status() returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not public.is_admin() then raise exception 'not an admin' using errcode = '42501'; end if;
  return jsonb_build_object('ok', true, 'owner', public.is_owner(),
    'gemini', exists (select 1 from private.app_secrets where name = 'gemini'),
    'github', exists (select 1 from private.app_secrets where name = 'github'),
    'groq', exists (select 1 from private.app_secrets where name = 'groq'),
    'openrouter', exists (select 1 from private.app_secrets where name = 'openrouter'),
    'geminiSetAt', (select updated_at from private.app_secrets where name = 'gemini'),
    'githubSetAt', (select updated_at from private.app_secrets where name = 'github'),
    'groqSetAt', (select updated_at from private.app_secrets where name = 'groq'),
    'openrouterSetAt', (select updated_at from private.app_secrets where name = 'openrouter'));
end $$;

revoke all on function public.admin_set_secret(text, text), public.admin_secret_status() from public, anon;
grant execute on function public.admin_set_secret(text, text), public.admin_secret_status() to authenticated;
