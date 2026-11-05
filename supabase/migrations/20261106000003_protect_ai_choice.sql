-- Settings → AI (which AI is on, which goes first) is owner-only, like the Requests / Ask AI switches.
create or replace function public.admin_save_doc(p_name text, p_content jsonb, p_version integer) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_ver integer;
begin
  if not public.is_admin() then raise exception 'not an admin' using errcode = '42501'; end if;
  if p_name not in ('videos', 'settings', 'channels', 'pending', 'health', 'paths', 'toolbox') then raise exception 'unknown document %', p_name; end if;
  if p_name = 'settings' and not public.is_super_admin() then
    p_content := (p_content - 'requestsEnabled' - 'aiEnabled' - 'ai') || coalesce((select jsonb_strip_nulls(jsonb_build_object(
      'requestsEnabled', content -> 'requestsEnabled', 'aiEnabled', content -> 'aiEnabled', 'ai', content -> 'ai')) from public.docs where name = 'settings'), '{}'::jsonb);
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
