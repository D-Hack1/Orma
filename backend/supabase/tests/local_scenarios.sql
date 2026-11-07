-- LOCAL VALIDATION ONLY. Requires an isolated PostgreSQL database with an
-- auth.users(id uuid) fixture table and Supabase's three API roles.
-- Do not run this fixture against the hosted project.
begin;
do $$
declare
  child uuid := '10000000-0000-4000-8000-000000000001';
  parent uuid := '10000000-0000-4000-8000-000000000002';
  outsider uuid := '10000000-0000-4000-8000-000000000003';
  family uuid; member uuid; pairing text; reply jsonb; payload jsonb;
  denied boolean := false; row_count integer;
begin
  insert into auth.users(id) values(child),(parent),(outsider);
  perform orma_server_action(child,'saveProfile','{"name":"Son","language":"en","phone":""}');
  perform orma_server_action(parent,'saveProfile','{"name":"Mother","language":"ml","phone":""}');
  perform orma_server_action(outsider,'saveProfile','{"name":"Other","language":"en","phone":""}');
  reply := orma_server_action(child,'createFamily','{"name":"Validation family"}');
  family := (reply->>'familyId')::uuid;
  reply := orma_server_action(child,'addFamilyMember',jsonb_build_object('familyId',family,'name','Mother','mode','assisted','language','ml','caregiverRelation','son'));
  member := (reply->>'memberId')::uuid;
  payload := jsonb_build_object('familyId',family,'memberId',member,'slot','morning','time','08:00','medicines',
    '[{"id":"demo-pill","name":"Fictional test tablet","count":2,"stock":10}]'::jsonb);
  perform orma_server_action(child,'updateMedicineSchedule',payload);
  perform orma_server_action(child,'updateMedicineSchedule',payload||'{"slot":"noon","time":"13:00"}');
  reply := orma_server_action(child,'inviteFamilyMember',jsonb_build_object('familyId',family,'memberId',member,'role','member'));
  pairing := reply->>'code';
  reply := orma_server_action(parent,'joinFamily',jsonb_build_object('code',pairing,'shareMedicineDetails',true));
  assert reply->>'familyId'=family::text, 'Pairing must join the intended family';
  reply := orma_server_action(parent,'getFamily',jsonb_build_object('familyId',family));
  assert (reply#>>'{members,0,isOwner}')::boolean, 'Parent must own the claimed profile';
  assert reply#>>'{members,0,relations}' like '%son%', 'Parent must retain the son relationship';

  payload := jsonb_build_object('familyId',family,'memberId',member,'slot','morning','countTaken',2,'source','tap');
  reply := orma_server_action(parent,'logDose',payload);
  assert reply->>'status'='confirmed', 'Owner dose must be confirmed';
  select count(*) into row_count from orma_schedules where member_id=member and medicines#>>'{0,stock}'='8';
  assert row_count=2, 'Shared stock must decrement across both slots';
  reply := orma_server_action(parent,'logDose',payload);
  assert reply->>'result'='duplicate_blocked', 'Duplicate dose must be blocked';
  assert (select medicines#>>'{0,stock}'='8' from orma_schedules where member_id=member and slot='morning'), 'Duplicate must not decrement stock';

  reply := orma_server_action(parent,'snooze',payload||'{"slot":"noon","delayMinutes":10}');
  assert (reply->>'allowed')::boolean, 'Ten-minute snooze must be allowed';
  assert (reply->>'remindAt')::timestamptz between now()+interval '9 minutes' and now()+interval '11 minutes', 'Snooze must use the requested duration';
  assert not exists(select 1 from orma_doses where member_id=member and slot='noon'), 'Snooze must not create an ingestion record';

  begin
    perform orma_server_action(outsider,'getFamily',jsonb_build_object('familyId',family));
  exception when insufficient_privilege then denied:=true;
  end;
  assert denied, 'Unrelated account must not access family data';
  perform orma_server_action(parent,'setSharing',jsonb_build_object('familyId',family,'memberId',member,'changes',jsonb_build_object('counts',false,'supporterId',child)));
  reply := orma_server_action(child,'getFamily',jsonb_build_object('familyId',family));
  assert not ((reply#>'{doses,0}') ? 'countTaken'), 'Hidden dose counts must be omitted';
  assert jsonb_array_length(reply#>'{members,0,schedules}')=0, 'Private medicine details must be omitted';
  denied:=false;
  begin
    perform orma_server_action(child,'updateMedicineSchedule',payload||'{"slot":"night","time":"20:00","medicines":[{"id":"demo-pill","name":"Fictional test tablet","count":2,"stock":8}]}');
  exception when insufficient_privilege then denied:=true;
  end;
  assert denied, 'Supporter must respect revoked medicine sharing';

  assert not has_function_privilege('authenticated','public.orma_server_action(uuid,text,jsonb)','execute'), 'Mobile users cannot supply a trusted actor UID';
  assert has_function_privilege('service_role','public.orma_server_action(uuid,text,jsonb)','execute'), 'Backend must have RPC permission';
  assert not has_table_privilege('anon','public.orma_doses','select'), 'Anonymous direct reads must be blocked';
  assert not has_table_privilege('authenticated','public.orma_doses','insert'), 'Direct health writes must be blocked';
  assert (select count(*)=14 and bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname like 'orma\_%' escape '\' and c.relkind='r'), 'All 14 canonical tables must have RLS enabled';
  raise notice 'PASS: pairing, ownership, shared stock, duplicate guard, 10-minute snooze, family isolation, sharing and API grants';
end $$;
rollback;
