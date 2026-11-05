-- Fixed search_path for helper functions (Supabase security advisor).
alter function private.clip(text, integer) set search_path = pg_catalog;
alter function private.norm_hr(text) set search_path = pg_catalog;
alter function private.one_lang(jsonb, text) set search_path = pg_catalog;
-- The http extension was only used once, to import the JSON files from GitHub.
drop extension if exists http;
