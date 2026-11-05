-- ABFM Training: functions the staff app and admin portal call.
-- All run as "security definer" with a fixed search_path and check sign-in / admin rights themselves.

-- ---------- helpers (private, not callable from the app) ----------
create or replace function private.hit(p_key text, p_limit integer, p_seconds integer) returns boolean
language plpgsql security definer set search_path = private, public as $$
declare v_n integer;
begin
  insert into private.rate as r (key, n, reset_at) values (p_key, 1, now() + make_interval(secs => p_seconds))
  on conflict (key) do update set
    n = case when r.reset_at < now() then 1 else r.n + 1 end,
    reset_at = case when r.reset_at < now() then now() + make_interval(secs => p_seconds) else r.reset_at end
  returning n into v_n;
  if random() < 0.01 then delete from private.rate where reset_at < now() - interval '1 day'; end if;
  return v_n <= p_limit;
end $$;

create or replace function private.clip(p text, p_len integer) returns text
language sql immutable as $$ select nullif(left(btrim(regexp_replace(coalesce(p, ''), '[[:cntrl:]]', ' ', 'g')), p_len), '') $$;

create or replace function private.norm_hr(p text) returns text
language sql immutable as $$ select nullif(left(upper(regexp_replace(coalesce(p, ''), '\s+', '', 'g')), 30), '') $$;

create or replace function private.settings() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select content from public.docs where name = 'settings'), '{}'::jsonb)
$$;

-- The staff member signed in with this token (or null). Also marks the phone as seen.
create or replace function private.staff_for(p_token text) returns public.staff
language plpgsql security definer set search_path = public, extensions as $$
declare v_hash text; v_staff public.staff;
begin
  if p_token is null or length(p_token) < 20 then return null; end if;
  v_hash := encode(digest(p_token, 'sha256'), 'hex');
  select s.* into v_staff from public.sessions x join public.staff s on s.hr = x.hr where x.token_hash = v_hash;
  if v_staff.hr is not null then update public.sessions set last_seen = now() where token_hash = v_hash and last_seen < now() - interval '10 minutes'; end if;
  return v_staff;
end $$;

-- A person's saved progress, so it can follow them to a new phone.
create or replace function private.progress(p_hr text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'done', coalesce((select jsonb_agg(jsonb_build_array(item, d)) from (
        select item, to_char(max(time) at time zone 'Asia/Dubai', 'YYYY-MM-DD') d from public.records
        where hr = p_hr and type = 'video' and item is not null group by item) v), '[]'::jsonb),
    'quiz', coalesce((select jsonb_object_agg(item, q) from (
        select distinct on (item) item, jsonb_build_object('score', score, 'n', n, 'pass', coalesce(pass, false), 'at', to_char(time at time zone 'Asia/Dubai', 'YYYY-MM-DD')) q
        from public.records where hr = p_hr and type = 'quiz' and item is not null
        order by item, coalesce(pass, false) desc, time desc) z), '{}'::jsonb),
    'certs', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'path', path, 'title', title,
        'at', to_char(time at time zone 'Asia/Dubai', 'YYYY-MM-DD'), 'name', name, 'hr', hr, 'site', site, 'trade', trade, 'score', score,
        'signedBy', coalesce(signed_by, ''), 'signedAt', coalesce(to_char(signed_at at time zone 'Asia/Dubai', 'YYYY-MM-DD'), ''))) from public.certificates where hr = p_hr), '[]'::jsonb)
  )
$$;

-- Keep only one language's translations, so phones download much less.
create or replace function private.one_lang(p_list jsonb, p_lang text) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_agg(
    (e - 'tr' - 'trq' - 'gemini' - 'geminiTries' - 'quizTries' - 'draftSource' - 'stepsFrom' - 'review')
    || case when p_lang <> 'en' and e -> 'tr' ? p_lang then jsonb_build_object('tr', jsonb_build_object(p_lang, e -> 'tr' -> p_lang)) else '{}'::jsonb end
    || case when p_lang <> 'en' and e -> 'trq' ? p_lang then jsonb_build_object('trq', jsonb_build_object(p_lang, e -> 'trq' -> p_lang)) else '{}'::jsonb end
    order by ord), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_list, '[]'::jsonb)) with ordinality as t(e, ord)
$$;

-- Settings that are safe to send to phones.
create or replace function private.public_settings(p_lang text) returns jsonb
language sql stable security definer set search_path = public as $$
  select (s - 'tr' - 'excludeKeywords' - 'requestUrl')
    || case when p_lang <> 'en' and s -> 'tr' ? p_lang then jsonb_build_object('tr', jsonb_build_object(p_lang, s -> 'tr' -> p_lang)) else '{}'::jsonb end
  from (select private.settings() s) x
$$;

-- ---------- staff app ----------

-- Before sign-in: just enough to show the sign-in screen.
create or replace function public.app_start(p_lang text default 'en') returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('ok', true, 'settings', jsonb_build_object(
    'siteName', s -> 'siteName', 'tagline', s -> 'tagline', 'staffLogin', coalesce((s ->> 'staffLogin')::boolean, false)))
  from (select private.settings() s) x
$$;

-- All the app content. Needs a valid sign-in when staff sign-in is turned on.
create or replace function public.app_content(p_token text default null, p_lang text default 'en') returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_set jsonb := private.settings(); v_staff public.staff; v_lang text := coalesce(nullif(left(p_lang, 5), ''), 'en');
begin
  if coalesce((v_set ->> 'staffLogin')::boolean, false) then
    v_staff := private.staff_for(p_token);
    if v_staff.hr is null then return jsonb_build_object('ok', false, 'error', 'login'); end if;
    if not v_staff.active then return jsonb_build_object('ok', false, 'error', 'inactive'); end if;
  end if;
  return jsonb_build_object('ok', true,
    'settings', private.public_settings(v_lang),
    'videos', (select jsonb_build_object('updated', content -> 'updated', 'videos', private.one_lang(content -> 'videos', v_lang)) from public.docs where name = 'videos'),
    'paths', (select jsonb_build_object('paths', private.one_lang(content -> 'paths', v_lang), 'assignments', coalesce(content -> 'assignments', '[]')) from public.docs where name = 'paths'),
    'toolbox', (select jsonb_build_object('talks', private.one_lang(content -> 'talks', v_lang)) from public.docs where name = 'toolbox'),
    'health', (select content from public.docs where name = 'health'));
end $$;

create or replace function public.staff_login(p_hr text, p_device text default '') returns jsonb
language plpgsql volatile security definer set search_path = public, extensions as $$
declare v_hr text := private.norm_hr(p_hr); v_dev text := left(regexp_replace(coalesce(p_device, ''), '[^A-Za-z0-9_-]', '', 'g'), 20);
  v_staff public.staff; v_token text;
begin
  if not private.hit('login:' || v_dev, 10, 600) or not private.hit('login:all', 600, 3600) then return jsonb_build_object('ok', false, 'error', 'busy'); end if;
  if v_hr is null then return jsonb_build_object('ok', false, 'error', 'notfound'); end if;
  select * into v_staff from public.staff where hr = v_hr;
  if v_staff.hr is null then return jsonb_build_object('ok', false, 'error', 'notfound'); end if;
  if not v_staff.active then return jsonb_build_object('ok', false, 'error', 'inactive'); end if;
  v_token := encode(gen_random_bytes(24), 'hex');
  insert into public.sessions (token_hash, hr, device) values (encode(digest(v_token, 'sha256'), 'hex'), v_hr, v_dev);
  return jsonb_build_object('ok', true, 'token', v_token,
    'staff', jsonb_build_object('hr', v_staff.hr, 'name', v_staff.name, 'site', v_staff.site, 'trade', v_staff.trade),
    'progress', private.progress(v_hr));
end $$;

create or replace function public.staff_me(p_token text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_staff public.staff := private.staff_for(p_token);
begin
  if v_staff.hr is null then return jsonb_build_object('ok', false, 'error', 'token'); end if;
  if not v_staff.active then return jsonb_build_object('ok', false, 'error', 'inactive'); end if;
  return jsonb_build_object('ok', true, 'staff', jsonb_build_object('hr', v_staff.hr, 'name', v_staff.name, 'site', v_staff.site, 'trade', v_staff.trade),
    'progress', private.progress(v_staff.hr));
end $$;

create or replace function public.staff_logout(p_token text) returns jsonb
language sql volatile security definer set search_path = public, extensions as $$
  delete from public.sessions where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex');
  select jsonb_build_object('ok', true);
$$;

-- Save finished videos, quizzes, paths and certificates.
-- With sign-in: recorded against the HR number. Without sign-in (sign-in turned off): against the name the person typed.
create or replace function public.staff_record(p_token text, p_profile jsonb, p_events jsonb, p_device text default '') returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_dev text := left(regexp_replace(coalesce(p_device, ''), '[^A-Za-z0-9_-]', '', 'g'), 20);
  v_staff public.staff; v_hr text; v_name text; v_site text; v_trade text; v_ver boolean := false; v_set jsonb := private.settings();
  e jsonb; v_time timestamptz; v_saved integer := 0;
begin
  if not private.hit('rec:' || v_dev, 200, 3600) then return jsonb_build_object('ok', false, 'error', 'busy'); end if;
  if p_token is not null and p_token <> '' then
    v_staff := private.staff_for(p_token);
    if v_staff.hr is null then return jsonb_build_object('ok', false, 'error', 'token'); end if;
    if not v_staff.active then return jsonb_build_object('ok', true, 'skipped', 'inactive'); end if;
    v_hr := v_staff.hr; v_name := v_staff.name; v_site := v_staff.site; v_trade := v_staff.trade; v_ver := true;
  else
    if coalesce((v_set ->> 'staffLogin')::boolean, false) or not coalesce((v_set ->> 'recordsEnabled')::boolean, false) then
      return jsonb_build_object('ok', false, 'error', 'login');
    end if;
    v_name := private.clip(p_profile ->> 'name', 80); v_site := private.clip(p_profile ->> 'site', 80); v_trade := private.clip(p_profile ->> 'trade', 60);
    if v_name is null then return jsonb_build_object('ok', false, 'error', 'name'); end if;
  end if;
  for e in select * from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) limit 25 loop
    if not coalesce((e ->> 'type') = any (array['video', 'quiz', 'path', 'cert']), false) then continue; end if;
    begin v_time := (e ->> 'time')::timestamptz; exception when others then v_time := now(); end;
    if v_time is null or v_time > now() + interval '1 day' or v_time < now() - interval '400 days' then v_time := now(); end if;
    insert into public.records (time, hr, name, site, trade, type, item, title, score, n, pass, code, lang, verified, device)
    values (v_time, v_hr, v_name, v_site, v_trade, e ->> 'type', private.clip(e ->> 'item', 80), private.clip(e ->> 'title', 160),
      case when jsonb_typeof(e -> 'score') = 'number' then (e ->> 'score')::numeric end,
      case when jsonb_typeof(e -> 'n') = 'number' then (e ->> 'n')::integer end,
      case when jsonb_typeof(e -> 'pass') = 'boolean' then (e ->> 'pass')::boolean end,
      private.clip(e ->> 'code', 12), private.clip(e ->> 'lang', 5), v_ver, v_dev);
    if e ->> 'type' = 'cert' and private.clip(e ->> 'code', 12) is not null then
      insert into public.certificates (code, time, hr, name, site, trade, path, title, score)
      values (private.clip(e ->> 'code', 12), v_time, v_hr, v_name, v_site, v_trade, private.clip(e ->> 'item', 80), private.clip(e ->> 'title', 160),
        case when jsonb_typeof(e -> 'score') = 'number' then (e ->> 'score')::numeric end)
      on conflict (code) do nothing;
    end if;
    v_saved := v_saved + 1;
  end loop;
  return jsonb_build_object('ok', true, 'saved', v_saved);
end $$;

-- A supervisor signs off a certificate with their PIN.
create or replace function public.staff_signoff(p_token text, p_profile jsonb, p_pin text, p_cert jsonb, p_device text default '') returns jsonb
language plpgsql volatile security definer set search_path = public, extensions as $$
declare v_dev text := left(regexp_replace(coalesce(p_device, ''), '[^A-Za-z0-9_-]', '', 'g'), 20);
  v_sup public.supervisors; v_staff public.staff; v_code text := private.clip(upper(p_cert ->> 'code'), 12);
  v_hr text; v_name text; v_site text; v_trade text;
begin
  if not private.hit('pin:' || v_dev, 6, 900) or not private.hit('pin:all', 200, 3600) then return jsonb_build_object('ok', false, 'error', 'busy'); end if;
  if coalesce(p_pin, '') = '' then return jsonb_build_object('ok', false, 'error', 'pin'); end if;
  select * into v_sup from public.supervisors where active and pin_hash = crypt(p_pin, pin_hash) limit 1;
  if v_sup.name is null then return jsonb_build_object('ok', false, 'error', 'pin'); end if;
  if v_code is null then return jsonb_build_object('ok', false, 'error', 'code'); end if;
  v_staff := private.staff_for(p_token);
  if v_staff.hr is not null then v_hr := v_staff.hr; v_name := v_staff.name; v_site := v_staff.site; v_trade := v_staff.trade;
  else v_name := private.clip(coalesce(p_cert ->> 'name', p_profile ->> 'name'), 80); v_site := private.clip(p_profile ->> 'site', 80); v_trade := private.clip(p_profile ->> 'trade', 60); end if;
  insert into public.certificates (code, hr, name, site, trade, path, title, score, signed_by, signed_at)
  values (v_code, v_hr, v_name, v_site, v_trade, private.clip(p_cert ->> 'path', 80), private.clip(p_cert ->> 'title', 160),
    case when jsonb_typeof(p_cert -> 'score') = 'number' then (p_cert ->> 'score')::numeric end, v_sup.name, now())
  on conflict (code) do update set signed_by = excluded.signed_by, signed_at = now();
  insert into public.records (hr, name, site, trade, type, item, title, code, verified, device)
  values (v_hr, v_name, v_site, v_trade, 'signoff', private.clip(p_cert ->> 'path', 80), private.clip(p_cert ->> 'title', 160), v_code, v_hr is not null, v_dev);
  return jsonb_build_object('ok', true, 'supervisor', v_sup.name);
end $$;

-- Anyone with a certificate link can check it.
create or replace function public.verify_cert(p_code text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare c public.certificates;
begin
  if not private.hit('verify:all', 600, 3600) then return jsonb_build_object('ok', false, 'error', 'busy'); end if;
  select * into c from public.certificates where code = upper(btrim(coalesce(p_code, '')));
  if c.code is null then return jsonb_build_object('ok', false, 'error', 'notfound'); end if;
  return jsonb_build_object('ok', true, 'cert', jsonb_build_object('name', c.name, 'hr', case when c.hr is null then '' else '•••' || right(c.hr, 3) end,
    'title', c.title, 'at', to_char(c.time at time zone 'Asia/Dubai', 'YYYY-MM-DD'), 'score', c.score, 'signedBy', coalesce(c.signed_by, '')));
end $$;

-- Counts of video plays and searches that found nothing.
create or replace function public.track_stats(p_events jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare e jsonb; v_day date := (now() at time zone 'Asia/Dubai')::date;
begin
  if not coalesce((private.settings() ->> 'statsEnabled')::boolean, false) then return jsonb_build_object('ok', true, 'off', true); end if;
  if not private.hit('stats:all', 3000, 3600) then return jsonb_build_object('ok', false, 'error', 'busy'); end if;
  for e in select * from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) limit 100 loop
    if not coalesce((e ->> 'kind') = any (array['view', 'nores']), false) or private.clip(e ->> 'key', 80) is null then continue; end if;
    insert into public.stats as s (day, kind, key, count)
    values (v_day, e ->> 'kind', lower(private.clip(e ->> 'key', 80)), greatest(1, least(50, coalesce((e ->> 'n')::integer, 1))))
    on conflict (day, kind, key) do update set count = s.count + excluded.count;
  end loop;
  return jsonb_build_object('ok', true);
end $$;

-- "Request a video".
create or replace function public.submit_request(p_token text, p_body jsonb, p_device text default '') returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_staff public.staff := private.staff_for(p_token); v_topic text := private.clip(p_body ->> 'topic', 200);
  v_dev text := left(regexp_replace(coalesce(p_device, ''), '[^A-Za-z0-9_-]', '', 'g'), 20);
begin
  if coalesce(p_body ->> 'website', '') <> '' then return jsonb_build_object('ok', true); end if;   -- spam trap
  if v_topic is null then return jsonb_build_object('ok', false, 'error', 'topic'); end if;
  if not private.hit('req:' || v_dev, 10, 3600) or not private.hit('req:all', 200, 3600) then return jsonb_build_object('ok', false, 'error', 'busy'); end if;
  insert into public.requests (topic, category, details, name, site, lang, hr)
  values (v_topic, private.clip(p_body ->> 'category', 60), private.clip(p_body ->> 'details', 1000),
    coalesce(v_staff.name, private.clip(p_body ->> 'name', 80)), coalesce(nullif(v_staff.site, ''), private.clip(p_body ->> 'site', 80)), private.clip(p_body ->> 'lang', 5), v_staff.hr);
  return jsonb_build_object('ok', true);
end $$;

-- Used by the Ask AI function: is this phone allowed to ask now?
create or replace function public.ai_allowed(p_token text, p_device text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_set jsonb := private.settings(); v_staff public.staff; v_dev text := left(regexp_replace(coalesce(p_device, ''), '[^A-Za-z0-9_-]', '', 'g'), 20);
begin
  if not coalesce((v_set ->> 'aiEnabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'off'); end if;
  if coalesce((v_set ->> 'staffLogin')::boolean, false) then
    v_staff := private.staff_for(p_token);
    if v_staff.hr is null or not v_staff.active then return jsonb_build_object('ok', false, 'error', 'login'); end if;
  end if;
  if not private.hit('ai:' || coalesce(v_staff.hr, v_dev), 30, 3600) or not private.hit('ai:hour', 300, 3600) or not private.hit('ai:day', 2000, 86400) then
    return jsonb_build_object('ok', false, 'error', 'busy');
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- admin portal ----------

-- Save a content document. Refuses if someone else (or the daily job) saved it in the meantime.
create or replace function public.admin_save_doc(p_name text, p_content jsonb, p_version integer) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_ver integer;
begin
  if not public.is_admin() then raise exception 'not an admin' using errcode = '42501'; end if;
  if p_name not in ('videos', 'settings', 'channels', 'pending', 'health', 'paths', 'toolbox') then raise exception 'unknown document %', p_name; end if;
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

create or replace function public.admin_set_supervisor(p_name text, p_pin text) returns jsonb
language plpgsql volatile security definer set search_path = public, extensions as $$
declare v_name text := private.clip(p_name, 80); v_pin text := regexp_replace(coalesce(p_pin, ''), '\D', '', 'g');
begin
  if not public.is_admin() then raise exception 'not an admin' using errcode = '42501'; end if;
  if v_name is null or length(v_pin) < 4 or length(v_pin) > 12 then return jsonb_build_object('ok', false, 'error', 'pin'); end if;
  if exists (select 1 from public.supervisors where name <> v_name and pin_hash = crypt(v_pin, pin_hash)) then return jsonb_build_object('ok', false, 'error', 'pinused'); end if;
  insert into public.supervisors (name, pin_hash, active) values (v_name, crypt(v_pin, gen_salt('bf')), true)
  on conflict (name) do update set pin_hash = excluded.pin_hash, active = true;
  return jsonb_build_object('ok', true);
end $$;

-- Everything the "Staff & records" tab needs, in one call.
create or replace function public.admin_records(p_days integer default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not an admin' using errcode = '42501'; end if;
  return jsonb_build_object('ok', true,
    'records', coalesce((select jsonb_agg(jsonb_build_array(time, coalesce(hr, ''), name, site, trade, type, item, title, score, n, pass, code, verified) order by time)
      from (select * from public.records where p_days <= 0 or time > now() - make_interval(days => p_days) order by time desc limit 50000) r), '[]'::jsonb),
    'certs', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'time', time, 'hr', coalesce(hr, ''), 'name', name, 'site', site, 'trade', trade, 'path', path,
      'title', title, 'score', score, 'signedBy', signed_by, 'signedAt', signed_at) order by time) from public.certificates), '[]'::jsonb),
    'staff', coalesce((select jsonb_agg(jsonb_build_object('hr', hr, 'name', name, 'site', site, 'trade', trade, 'active', active) order by name) from public.staff), '[]'::jsonb));
end $$;

create or replace function public.admin_stats(p_days integer default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not an admin' using errcode = '42501'; end if;
  return jsonb_build_object('ok', true, 'counts', coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'key', key, 'n', n)) from (
    select kind, key, sum(count)::integer n from public.stats where day > (now() at time zone 'Asia/Dubai')::date - p_days group by kind, key) x), '[]'::jsonb));
end $$;

-- Keep staff.updated_at current, and sign people out when they are deactivated.
create or replace function private.staff_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.hr := private.norm_hr(new.hr);
  new.updated_at := now();
  if tg_op = 'UPDATE' and old.active and not new.active then delete from public.sessions where hr = old.hr; end if;
  return new;
end $$;
create trigger staff_changed before insert or update on public.staff for each row execute function private.staff_changed();

-- Who may call what.
revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
grant usage on schema private to postgres, service_role;
grant execute on function public.app_start(text), public.app_content(text, text), public.staff_login(text, text), public.staff_me(text),
  public.staff_logout(text), public.staff_record(text, jsonb, jsonb, text), public.staff_signoff(text, jsonb, text, jsonb, text),
  public.verify_cert(text), public.track_stats(jsonb), public.submit_request(text, jsonb, text), public.ai_allowed(text, text) to anon, authenticated;
grant execute on function public.is_admin(), public.admin_save_doc(text, jsonb, integer), public.admin_set_supervisor(text, text),
  public.admin_records(integer), public.admin_stats(integer) to authenticated;
