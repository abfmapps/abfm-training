-- One super admin. Only they can add or remove admins and change the
-- "Requests & Ask AI" switches. Other admins can do everything else.

create or replace function public.is_super_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() and lower(coalesce(auth.jwt() ->> 'email', '')) = 'zarrade.omar@gmail.com';
$$;
revoke all on function public.is_super_admin() from public, anon;
grant execute on function public.is_super_admin() to authenticated;

-- Only the super admin manages the admin list.
drop policy if exists "admins add admins" on public.admins;
drop policy if exists "admins remove admins" on public.admins;
create policy "super admin adds admins" on public.admins for insert to authenticated with check (public.is_super_admin());
create policy "super admin removes admins" on public.admins for delete to authenticated
  using (public.is_super_admin() and lower(email) <> 'zarrade.omar@gmail.com');

-- Saving settings: other admins can't change the Requests / Ask AI switches.
create or replace function public.admin_save_doc(p_name text, p_content jsonb, p_version integer) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_ver integer;
begin
  if not public.is_admin() then raise exception 'not an admin' using errcode = '42501'; end if;
  if p_name not in ('videos', 'settings', 'channels', 'pending', 'health', 'paths', 'toolbox') then raise exception 'unknown document %', p_name; end if;
  if p_name = 'settings' and not public.is_super_admin() then
    p_content := (p_content - 'requestsEnabled' - 'aiEnabled') || coalesce((select jsonb_strip_nulls(jsonb_build_object(
      'requestsEnabled', content -> 'requestsEnabled', 'aiEnabled', content -> 'aiEnabled')) from public.docs where name = 'settings'), '{}'::jsonb);
  end if;
  if p_version is null or p_version = 0 then
    insert into public.docs (name, content, updated_by) values (p_name, p_content, auth.jwt() ->> 'email')
    on conflict (name) do nothing returning version into v_ver;
  else
    update public.docs set content = p_content, version = version + 1, updated_at = now(), updated_by = auth.jwt() ->> 'email'
    where name = p_name and version = p_version returning version into v_ver;
  end if;
  if v_ver is null then return jsonb_build_object('ok', false, 'error', 'conflict'); end if;
  return jsonb_build_object('ok', true, 'version', v_ver);
end $$;
