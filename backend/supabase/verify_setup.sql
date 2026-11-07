-- Read-only. Run after 001_orma.sql in Supabase Dashboard > SQL Editor.
-- Expected: 14, true, true, true, true. No patient/account data is returned.
with tables as (
  select c.relrowsecurity
  from pg_class c
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname like 'orma\_%' escape '\' and c.relkind='r'
)
select
  (select count(*) from tables) as orma_table_count,
  (select count(*)=14 and bool_and(relrowsecurity) from tables) as all_tables_have_rls,
  has_function_privilege('service_role','public.orma_server_action(uuid,text,jsonb)','execute') as backend_can_call_rpc,
  not has_function_privilege('authenticated','public.orma_server_action(uuid,text,jsonb)','execute') as direct_client_rpc_blocked,
  not has_table_privilege('anon','public.orma_doses','select')
    and not has_table_privilege('authenticated','public.orma_doses','insert') as direct_health_access_blocked;

-- Expected: one row with id = orma, public = false.
select id, public from storage.buckets where id='orma';
