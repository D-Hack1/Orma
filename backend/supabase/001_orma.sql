-- Orma: run this whole file once in Supabase Dashboard > SQL Editor.
-- Creates new orma_* objects only. Does not delete existing tables or Auth users.
begin;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.orma_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 100),
  phone text not null default '' check (phone = '' or phone ~ '^\+[1-9][0-9]{7,14}$'),
  language text not null default 'en' check (language in ('en','ml')),
  created_at timestamptz not null default now()
);
create table if not exists public.orma_families (
  id uuid primary key default gen_random_uuid(), name text not null,
  lead_uid uuid not null references auth.users(id), timezone text not null default 'Asia/Kolkata',
  created_at timestamptz not null default now()
);
create table if not exists public.orma_members (
  id uuid primary key default gen_random_uuid(), family_id uuid not null references public.orma_families(id) on delete cascade,
  owner_uid uuid references auth.users(id), name text not null,
  mode text not null default 'assisted' check (mode in ('assisted','independent','keypad')),
  language text not null default 'ml' check (language in ('en','ml')),
  relations jsonb not null default '{}', nurse_uids uuid[] not null default '{}',
  calls_consent boolean not null default false, fl_consent boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists public.orma_access (
  family_id uuid references public.orma_families(id) on delete cascade,
  uid uuid references auth.users(id) on delete cascade,
  roles text[] not null check (roles <@ array['leadSupporter','supporter','member','nurse']::text[]),
  member_ids uuid[] not null default '{}', active boolean not null default true,
  primary key (family_id,uid)
);
create table if not exists public.orma_sharing (
  member_id uuid primary key references public.orma_members(id) on delete cascade,
  counts boolean not null default false, messages boolean not null default false,
  risk boolean not null default false, nurse_notes boolean not null default false,
  per_supporter jsonb not null default '{}', version integer not null default 0
);
create table if not exists public.orma_schedules (
  member_id uuid references public.orma_members(id) on delete cascade,
  slot text check (slot in ('morning','noon','night')), time text not null check (time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  after_food boolean not null default true, medicines jsonb not null check (jsonb_typeof(medicines)='array'),
  confirmed_by uuid references auth.users(id), confirmed_at timestamptz not null default now(),
  primary key (member_id,slot)
);
create table if not exists public.orma_doses (
  id uuid unique not null default gen_random_uuid(), member_id uuid references public.orma_members(id) on delete cascade,
  date date not null, slot text not null check (slot in ('morning','noon','night')),
  status text not null check (status in ('confirmed','reported','partial','pending','unknown')),
  count_taken integer, count_expected integer, medicines_taken jsonb not null default '[]',
  source text not null, by_uid uuid not null references auth.users(id), at timestamptz not null default now(),
  evidence jsonb not null default '[]', request_id text,
  primary key (member_id,date,slot)
);
create table if not exists public.orma_invites (
  code_hash text primary key, family_id uuid not null references public.orma_families(id) on delete cascade,
  member_id uuid references public.orma_members(id) on delete cascade,
  role text not null check (role in ('member','supporter','nurse')), relation text not null default 'other',
  created_by uuid not null references auth.users(id), expires_at timestamptz not null, used_by uuid references auth.users(id)
);
create table if not exists public.orma_devices (
  id text primary key, uid uuid not null references auth.users(id), family_id uuid not null references public.orma_families(id) on delete cascade,
  member_ids uuid[] not null, tier text not null default 'T1', updated_at timestamptz not null default now()
);
create table if not exists public.orma_snoozes (
  member_id uuid references public.orma_members(id) on delete cascade, date date, slot text,
  remind_at timestamptz not null, by_uid uuid references auth.users(id), reason text not null,
  primary key (member_id,date,slot)
);
create table if not exists public.orma_messages (
  id uuid primary key default gen_random_uuid(), family_id uuid not null references public.orma_families(id) on delete cascade,
  member_id uuid not null references public.orma_members(id) on delete cascade,
  sender_uid uuid not null references auth.users(id), recipient_uid uuid not null references auth.users(id),
  text text not null check (length(text) between 1 and 2000), urgency text not null default 'normal', at timestamptz not null default now()
);
create table if not exists public.orma_alerts (
  id uuid primary key default gen_random_uuid(), member_id uuid not null references public.orma_members(id) on delete cascade,
  date date not null, slot text not null, type text not null, rule text not null, at timestamptz not null default now(),
  unique (member_id,date,slot,type)
);
create table if not exists public.orma_audit (
  id bigint generated always as identity primary key, actor uuid not null references auth.users(id),
  member_id uuid, action text not null, at timestamptz not null default now()
);
create table if not exists public.orma_join_attempts (
  actor uuid not null references auth.users(id), at timestamptz not null default now()
);
create index if not exists orma_members_family on public.orma_members(family_id);
create index if not exists orma_messages_inbox on public.orma_messages(recipient_uid,at desc);
create index if not exists orma_join_rate on public.orma_join_attempts(actor,at);

-- Direct clients cannot read or mutate canonical health documents. The backend
-- validates Supabase Auth tokens and calls the narrowly checked RPC below.
do $$ declare t text; begin
  foreach t in array array['orma_profiles','orma_families','orma_members','orma_access','orma_sharing','orma_schedules','orma_doses','orma_invites','orma_devices','orma_snoozes','orma_messages','orma_alerts','orma_audit','orma_join_attempts'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on table public.%I from anon, authenticated',t);
    execute format('grant all on table public.%I to service_role',t);
  end loop;
end $$;
grant usage,select on sequence public.orma_audit_id_seq to service_role;

create or replace function public.orma_can_access(a uuid,m uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from orma_members x join orma_access y on y.family_id=x.family_id and y.uid=a and y.active
 where x.id=m and (x.owner_uid=a or y.roles && array['leadSupporter','supporter']::text[]
 or ('nurse'=any(y.roles) and a=any(x.nurse_uids) and m=any(y.member_ids))))
$$;
create or replace function public.orma_shares(a uuid,m uuid,f text) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce((select case when x.owner_uid=a then true else coalesce(
 (s.per_supporter->a::text->>f)::boolean,
 case f when 'counts' then s.counts when 'messages' then s.messages when 'risk' then s.risk when 'nurseNotes' then s.nurse_notes else false end)
 end from orma_members x join orma_sharing s on s.member_id=x.id where x.id=m),false)
$$;
create or replace function public.orma_can_manage(a uuid,m uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from orma_members x join orma_access y on y.family_id=x.family_id and y.uid=a and y.active
 where x.id=m and ((x.owner_uid=a and x.mode='independent') or
 (y.roles && array['leadSupporter','supporter']::text[] and (x.owner_uid is null or orma_shares(a,m,'counts')))))
$$;

create or replace function public.orma_server_action(actor uuid,action text,p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare
 f uuid; m uuid; u uuid; k text; code text; sl text; dt date; n integer; total integer; used integer;
 rec orma_members%rowtype; acc orma_access%rowtype; inv orma_invites%rowtype; dose orma_doses%rowtype; sched orma_schedules%rowtype;
 item jsonb; other_row record; payload jsonb; result jsonb; member_list jsonb; contact_list jsonb; doses_list jsonb;
 selected jsonb; selected_ids jsonb; en text; ml text; outcome text; expected integer; amount integer; prior integer; visible boolean;
begin
 if actor is null or not exists(select 1 from auth.users where id=actor) then raise exception 'Sign in first' using errcode='28000'; end if;
 if action='saveProfile' then
   if length(trim(coalesce(p->>'name',''))) not between 1 and 100 or coalesce(p->>'language','en') not in ('en','ml') then raise exception 'Invalid profile'; end if;
   insert into orma_profiles(id,name,phone,language) values(actor,trim(p->>'name'),coalesce(p->>'phone',''),coalesce(p->>'language','en'))
   on conflict(id) do update set name=excluded.name,phone=excluded.phone,language=excluded.language;
   return jsonb_build_object('saved',true);
 end if;
 if action='listMyFamilies' then
   return jsonb_build_object('families',coalesce((select jsonb_agg(jsonb_build_object('familyId',x.id,'name',x.name,'role',case when y.roles && array['leadSupporter','supporter']::text[] then 'supporter' else 'assisted' end)) from orma_families x join orma_access y on y.family_id=x.id where y.uid=actor and y.active),'[]'::jsonb));
 end if;
 if action='createFamily' then
   if not exists(select 1 from orma_profiles where id=actor) or length(trim(coalesce(p->>'name',''))) not between 1 and 100 then raise exception 'Complete your profile and family name'; end if;
   if (select count(*) from orma_families where lead_uid=actor)>=5 then raise exception 'Family limit reached'; end if;
   insert into orma_families(name,lead_uid) values(trim(p->>'name'),actor) returning id into f;
   insert into orma_access(family_id,uid,roles) values(f,actor,array['leadSupporter']);
   if coalesce((p->>'independent')::boolean,false) then
     insert into orma_members(family_id,owner_uid,name,mode,language) select f,actor,name,'independent',language from orma_profiles where id=actor returning id into m;
     insert into orma_sharing(member_id) values(m);
     update orma_access set roles=array['leadSupporter','member'],member_ids=array[m] where family_id=f and uid=actor;
   end if;
   return jsonb_build_object('familyId',f,'memberId',m);
 end if;
 if action='joinFamily' then
   if (select count(*) from orma_join_attempts where orma_join_attempts.actor=orma_server_action.actor and at>now()-interval '1 minute')>=10 then return jsonb_build_object('error','Too many attempts. Wait a minute.'); end if;
   insert into orma_join_attempts(actor) values(actor);
   select * into inv from orma_invites where code_hash=encode(digest(upper(trim(p->>'code')),'sha256'),'hex') for update;
   if not found or inv.expires_at<now() or (inv.used_by is not null and inv.used_by<>actor) then return jsonb_build_object('error','Invalid, expired or used pairing code'); end if;
   if not exists(select 1 from orma_profiles where id=actor) then raise exception 'Complete your profile'; end if;
   f:=inv.family_id; m:=inv.member_id;
   if inv.role='member' then
     select * into rec from orma_members where id=m and family_id=f for update;
     if not found or (rec.owner_uid is not null and rec.owner_uid<>actor) then raise exception 'This person already has an account'; end if;
     update orma_members x set owner_uid=actor,name=y.name,language=y.language from orma_profiles y where x.id=m and y.id=actor;
     if coalesce((p->>'shareMedicineDetails')::boolean,false) then
       update orma_sharing set per_supporter=per_supporter||jsonb_build_object(inv.created_by::text,coalesce(per_supporter->inv.created_by::text,'{}')||jsonb_build_object('counts',true)),version=version+1 where member_id=m;
     end if;
   elsif inv.role='nurse' then
     if m is null then raise exception 'Nurse assignment required'; end if;
     update orma_members set nurse_uids=array(select distinct x from unnest(nurse_uids||array[actor]) x) where id=m and family_id=f;
   else
     update orma_members set relations=relations||jsonb_build_object(actor::text,inv.relation) where family_id=f;
   end if;
   insert into orma_access(family_id,uid,roles,member_ids) values(f,actor,array[inv.role],case when inv.role='supporter' then coalesce((select array_agg(id) from orma_members where family_id=f),'{}') else array[m] end)
   on conflict(family_id,uid) do update set active=true,roles=array(select distinct x from unnest(orma_access.roles||excluded.roles) x),member_ids=array(select distinct x from unnest(orma_access.member_ids||excluded.member_ids) x);
   update orma_invites set used_by=actor where code_hash=inv.code_hash;
   return jsonb_build_object('familyId',f,'memberId',m,'role',inv.role);
 end if;
 f:=(p->>'familyId')::uuid;
 select * into acc from orma_access where family_id=f and uid=actor and active;
 if not found then raise exception 'Family access is not allowed' using errcode='42501'; end if;
 if action='addFamilyMember' then
   if not ('leadSupporter'=any(acc.roles)) then raise exception 'Only family lead can add members' using errcode='42501'; end if;
   if length(trim(coalesce(p->>'name',''))) not between 1 and 100 or (select count(*) from orma_members where family_id=f)>=30 then raise exception 'Check member name or family size'; end if;
   insert into orma_members(family_id,name,mode,language,relations) values(f,trim(p->>'name'),coalesce(p->>'mode','assisted'),coalesce(p->>'language','ml'),jsonb_build_object(actor::text,coalesce(p->>'caregiverRelation','child'))) returning id into m;
   insert into orma_sharing(member_id) values(m);
   update orma_access set member_ids=array_append(member_ids,m) where family_id=f and roles && array['leadSupporter','supporter']::text[];
   return jsonb_build_object('memberId',m);
 end if;
 if action='inviteFamilyMember' then
   if not ('leadSupporter'=any(acc.roles)) or p->>'role' not in ('member','supporter','nurse') then raise exception 'Invitation not allowed' using errcode='42501'; end if;
   m:=nullif(p->>'memberId','')::uuid;
   if p->>'role' in ('member','nurse') and (m is null or not orma_can_access(actor,m)) then raise exception 'Choose a family member'; end if;
   if m is not null and not exists(select 1 from orma_members where id=m and family_id=f) then raise exception 'Wrong family member'; end if;
   code:=upper(encode(gen_random_bytes(6),'hex'));
   insert into orma_invites(code_hash,family_id,member_id,role,relation,created_by,expires_at) values(encode(digest(code,'sha256'),'hex'),f,m,p->>'role',coalesce(p->>'relation','other'),actor,now()+interval '24 hours');
   return jsonb_build_object('code',code,'expiresInHours',24);
 end if;
 if action='getFamily' then
   select coalesce(jsonb_agg(jsonb_build_object('uid',x.id,'name',x.name,'phone',x.phone,'roles',y.roles)),'[]') into contact_list
   from orma_profiles x join orma_access y on y.uid=x.id where y.family_id=f and y.active and x.id<>actor;
   select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.name,'mode',x.mode,'language',x.language,'isOwner',x.owner_uid=actor,
     'canManage',orma_can_manage(actor,x.id),'awaitingAccount',x.owner_uid is null,
     'relations',case when x.owner_uid=actor then x.relations else '{}'::jsonb end,
     'schedules',case when x.owner_uid=actor or orma_can_manage(actor,x.id) or orma_shares(actor,x.id,'counts') then coalesce((select jsonb_agg(jsonb_build_object('slot',s.slot,'time',s.time,'afterFood',s.after_food,'medicines',s.medicines)) from orma_schedules s where s.member_id=x.id),'[]') else '[]'::jsonb end,
     'sharing',jsonb_build_object('counts',orma_shares(actor,x.id,'counts'),'messages',orma_shares(actor,x.id,'messages'),'risk',orma_shares(actor,x.id,'risk'),'nurseNotes',orma_shares(actor,x.id,'nurseNotes')))),'[]') into member_list
   from orma_members x where x.family_id=f and orma_can_access(actor,x.id);
   select coalesce(jsonb_agg(jsonb_build_object('memberId',d.member_id,'date',d.date,'slot',d.slot,'status',d.status)||case when orma_shares(actor,d.member_id,'counts') then jsonb_build_object('countTaken',d.count_taken,'countExpected',d.count_expected,'source',d.source,'by',d.by_uid,'at',d.at) else '{}'::jsonb end),'[]') into doses_list
   from orma_doses d join orma_members x on x.id=d.member_id where x.family_id=f and d.date=(now() at time zone 'Asia/Kolkata')::date and orma_can_access(actor,x.id);
   return jsonb_build_object('familyId',f,'name',(select name from orma_families where id=f),'uid',actor,'timezone','Asia/Kolkata',
    'role',case when exists(select 1 from orma_members where family_id=f and owner_uid=actor and mode='independent') then 'independent' when acc.roles && array['leadSupporter','supporter']::text[] then 'supporter' when 'nurse'=any(acc.roles) then 'nurse' else 'assisted' end,
    'members',member_list,'contacts',contact_list,'doses',doses_list,
    'messages',coalesce((select jsonb_agg(to_jsonb(x)) from (select id,sender_uid,recipient_uid,text,urgency,at from orma_messages where family_id=f and (recipient_uid=actor or sender_uid=actor) order by at desc limit 30) x),'[]'));
 end if;
 if action='registerDevice' then
   selected_ids:=coalesce(p->'memberIds','[]');
   if length(coalesce(p->>'deviceId','')) not between 1 and 120 or exists(select 1 from jsonb_array_elements_text(selected_ids) x where not orma_can_access(actor,x::uuid) or not exists(select 1 from orma_members where id=x::uuid and family_id=f)) then raise exception 'Invalid device members' using errcode='42501'; end if;
   if exists(select 1 from orma_devices where id=p->>'deviceId' and uid<>actor) then raise exception 'Device belongs to another account' using errcode='42501'; end if;
   insert into orma_devices(id,uid,family_id,member_ids,tier) values(p->>'deviceId',actor,f,array(select x::uuid from jsonb_array_elements_text(selected_ids) x),coalesce(p->>'tier','T1'))
   on conflict(id) do update set family_id=excluded.family_id,member_ids=excluded.member_ids,tier=excluded.tier,updated_at=now();
   return jsonb_build_object('registered',true);
 end if;
 m:=(p->>'memberId')::uuid;
 select * into rec from orma_members where id=m and family_id=f for update;
 if not found or not orma_can_access(actor,m) then raise exception 'Member access denied' using errcode='42501'; end if;
 if action='updateMedicineSchedule' then
   if not orma_can_manage(actor,m) then raise exception 'Medicine details must be shared with an authorized supporter' using errcode='42501'; end if;
   sl:=p->>'slot'; selected:=p->'medicines';
   if sl not in ('morning','noon','night') or coalesce(p->>'time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or jsonb_typeof(selected)<>'array' or jsonb_array_length(selected) not between 1 and 12 then raise exception 'Invalid confirmed schedule'; end if;
   if exists(select 1 from orma_doses where member_id=m and date=(now() at time zone 'Asia/Kolkata')::date and slot=sl and status in ('confirmed','reported','partial')) then raise exception 'Today has a recorded dose; review changes with your care team'; end if;
   total:=0;
   for item in select value from jsonb_array_elements(selected) loop
     n:=(item->>'count')::integer; prior:=(item->>'stock')::integer;
     if coalesce(item->>'id','') !~ '^[A-Za-z0-9_-]{1,80}$' or length(trim(coalesce(item->>'name',''))) not between 1 and 100 or n not between 1 and 20 or prior not between 0 and 10000 then raise exception 'Invalid medicine fields'; end if;
     total:=total+n;
     if exists(select 1 from orma_schedules s cross join lateral jsonb_array_elements(s.medicines) x where s.member_id=m and s.slot<>sl and x->>'id'=item->>'id' and (x->>'name'<>item->>'name' or (x->>'stock')::integer<>prior)) then raise exception 'Shared medicine stock must agree across times'; end if;
   end loop;
   if total>99 or (select count(distinct value->>'id') from jsonb_array_elements(selected))<>jsonb_array_length(selected) then raise exception 'Invalid medicine counts'; end if;
   insert into orma_schedules(member_id,slot,time,after_food,medicines,confirmed_by) values(m,sl,p->>'time',coalesce((p->>'afterFood')::boolean,true),selected,actor)
   on conflict(member_id,slot) do update set time=excluded.time,after_food=excluded.after_food,medicines=excluded.medicines,confirmed_by=actor,confirmed_at=now();
   insert into orma_audit(actor,member_id,action) values(actor,m,'schedule_confirmed');
   return jsonb_build_object('saved',true,'slot',sl);
 end if;
 if action='setSharing' then
   if rec.owner_uid<>actor or rec.owner_uid is null then raise exception 'Only the member changes sharing' using errcode='42501'; end if;
   payload:=p->'changes';
   if coalesce(payload->>'doseStatus','true')<>'true' then raise exception 'Minimum dose status cannot be hidden'; end if;
   if exists(select 1 from jsonb_object_keys(payload) x where x not in ('counts','messages','risk','nurseNotes','askedTwice','supporterId','doseStatus')) then raise exception 'Unknown sharing field'; end if;
   if payload ? 'supporterId' and payload->>'supporterId' is not null then
     u:=(payload->>'supporterId')::uuid;
     if not exists(select 1 from orma_access where family_id=f and uid=u and active) then raise exception 'Supporter not in this family'; end if;
     update orma_sharing set per_supporter=per_supporter||jsonb_build_object(u::text,coalesce(per_supporter->u::text,'{}')||(payload-'supporterId'-'doseStatus')),version=version+1 where member_id=m;
   else
     update orma_sharing set counts=coalesce((payload->>'counts')::boolean,counts),messages=coalesce((payload->>'messages')::boolean,messages),risk=coalesce((payload->>'risk')::boolean,risk),nurse_notes=coalesce((payload->>'nurseNotes')::boolean,nurse_notes),version=version+1 where member_id=m;
   end if;
   return jsonb_build_object('saved',true,'textEn','Your sharing settings were updated.','textMl','പങ്കിടൽ ക്രമീകരണം മാറ്റി.');
 end if;
 if action='sendMessage' then
   u:=(p->>'to')::uuid; en:=trim(coalesce(p->>'text',''));
   if length(en) not between 1 and 2000 or not exists(select 1 from orma_access where family_id=f and uid=u and active) then raise exception 'Choose a family recipient and message'; end if;
   insert into orma_messages(family_id,member_id,sender_uid,recipient_uid,text,urgency) values(f,m,actor,u,en,case when en ~* 'chest pain|breathless|നെഞ്ചുവേദന|ശ്വാസം മുട്ട' then 'urgent' else 'normal' end);
   return jsonb_build_object('textEn','Your message was sent.','textMl','സന്ദേശം അയച്ചു.');
 end if;
 sl:=p->>'slot'; dt:=coalesce(nullif(p->>'date','')::date,(now() at time zone 'Asia/Kolkata')::date);
 if sl not in ('morning','noon','night') then raise exception 'Choose the dose time'; end if;
 select * into sched from orma_schedules where member_id=m and slot=sl;
 select * into dose from orma_doses where member_id=m and date=dt and slot=sl;
 visible:=orma_shares(actor,m,'counts');
 if action='snooze' then
   if dt<>(now() at time zone 'Asia/Kolkata')::date or sched.member_id is null then raise exception 'A confirmed schedule for today is needed'; end if;
   if dose.status in ('confirmed','reported','partial') then raise exception 'This dose is already recorded'; end if;
   if exists(select 1 from jsonb_array_elements(sched.medicines) x where coalesce((x->>'timeCritical')::boolean,false)) then return jsonb_build_object('allowed',false,'textEn','This medicine has fixed timing. Ask your care team before changing it.','textMl','ഈ മരുന്നിന്റെ സമയം മാറ്റുന്നതിന് മുമ്പ് പരിചരണ സംഘത്തോട് ചോദിക്കൂ.'); end if;
   n:=coalesce((p->>'delayMinutes')::integer,30); if n not between 1 and 120 then raise exception 'Snooze must be 1 to 120 minutes'; end if;
   insert into orma_snoozes(member_id,date,slot,remind_at,by_uid,reason) values(m,dt,sl,now()+make_interval(mins=>n),actor,coalesce(p->>'reason','later')) on conflict(member_id,date,slot) do update set remind_at=excluded.remind_at,by_uid=actor,reason=excluded.reason;
   return jsonb_build_object('allowed',true,'remindAt',now()+make_interval(mins=>n),'textEn',format('I will remind you in %s minutes. This does not record a dose.',n),'textMl',format('%s മിനിറ്റിന് ശേഷം ഓർമ്മിപ്പിക്കാം. മരുന്ന് കഴിച്ചതായി രേഖപ്പെടുത്തിയിട്ടില്ല.',n));
 end if;
 if action='logDose' then
   if dt<>(now() at time zone 'Asia/Kolkata')::date or sched.member_id is null then raise exception 'Choose a confirmed dose for today'; end if;
   if dose.status in ('confirmed','reported','partial') then
     insert into orma_audit(actor,member_id,action) values(actor,m,'duplicate_blocked');
     insert into orma_alerts(member_id,date,slot,type,rule) values(m,dt,sl,'double','duplicate_attempt') on conflict do nothing;
     return jsonb_build_object('result','duplicate_blocked','status',dose.status,'reply',jsonb_build_object('textEn','A record already exists. Check it before taking more.','textMl','നേരത്തേ രേഖപ്പെടുത്തിയിട്ടുണ്ട്. വീണ്ടും കഴിക്കുന്നതിന് മുമ്പ് പരിശോധിക്കൂ.'));
   end if;
   n:=(p->>'countTaken')::integer; total:=0; selected_ids:=coalesce(p->'medicinesTaken','[]');
   select sum((x->>'count')::integer) into total from jsonb_array_elements(sched.medicines) x;
   if n is null or n<1 or n>total then raise exception 'Count must match the confirmed prescription'; end if;
   if jsonb_array_length(selected_ids)=0 and n=total then select jsonb_agg(x->>'id') into selected_ids from jsonb_array_elements(sched.medicines) x; end if;
   if jsonb_array_length(selected_ids)=0 then raise exception 'Choose which medicine was taken'; end if;
   if exists(select 1 from jsonb_array_elements_text(selected_ids) x where not exists(select 1 from jsonb_array_elements(sched.medicines) y where y->>'id'=x)) then raise exception 'Medicine not on confirmed schedule'; end if;
   select sum((x->>'count')::integer) into expected from jsonb_array_elements(sched.medicines) x where selected_ids ? (x->>'id');
   if n<>expected and not (jsonb_array_length(selected_ids)=1 and n<=expected) then raise exception 'Choose exact medicines and count'; end if;
   for item in select value from jsonb_array_elements(sched.medicines) where selected_ids ? (value->>'id') loop
     amount:=case when jsonb_array_length(selected_ids)=1 then n else (item->>'count')::integer end;
     prior:=(item->>'stock')::integer; if prior<amount then raise exception 'Recorded stock is too low; ask your supporter to check'; end if;
     update orma_schedules s set medicines=(select jsonb_agg(case when x->>'id'=item->>'id' then jsonb_set(x,'{stock}',to_jsonb(prior-amount)) else x end) from jsonb_array_elements(s.medicines) x) where s.member_id=m;
   end loop;
   outcome:=case when n<total then 'partial' when rec.owner_uid=actor then 'confirmed' else 'reported' end;
   insert into orma_doses(member_id,date,slot,status,count_taken,count_expected,medicines_taken,source,by_uid,evidence,request_id) values(m,dt,sl,outcome,n,total,selected_ids,coalesce(p->>'source','tap'),actor,coalesce(p->'evidence','[]'),p->>'requestId');
   if outcome='partial' then insert into orma_alerts(member_id,date,slot,type,rule) values(m,dt,sl,'partial','partial_count') on conflict do nothing; end if;
   return jsonb_build_object('result',case when outcome='partial' then 'partial' else 'logged' end,'status',outcome,'reply',jsonb_build_object('textEn',case when visible then format('%s of %s tablets recorded.',n,total) else 'The dose was recorded.' end,'textMl',case when visible then format('%s ഗുളികകളിൽ %s കഴിച്ചതായി രേഖപ്പെടുത്തി.',total,n) else 'മരുന്ന് കഴിച്ചതായി രേഖപ്പെടുത്തി.' end));
 end if;
 if action in ('askStatus','answer','explain') then
   if dose.id is null then
     if sched.member_id is not null and (dt::text||' '||sched.time)::timestamp at time zone 'Asia/Kolkata'>now() then
       return jsonb_build_object('status','pending','textEn','It is not time for this dose yet.','textMl','ഈ മരുന്ന് കഴിക്കേണ്ട സമയം ആയിട്ടില്ല.','sentences','[]'::jsonb);
     end if;
     insert into orma_alerts(member_id,date,slot,type,rule) values(m,dt,sl,'unknown','no_confirmed_record') on conflict do nothing;
     return jsonb_build_object('status','unknown','textEn','There is no confirmed record. Wait before taking more and contact your family.','textMl','സ്ഥിരീകരിച്ച രേഖയില്ല. വീണ്ടും കഴിക്കുന്നതിന് മുമ്പ് കാത്തിരിക്കുക. കുടുംബത്തെ ബന്ധപ്പെടൂ.','sentences','[]'::jsonb);
   end if;
   en:=case when visible then format('%s of %s tablets recorded at %s.',dose.count_taken,dose.count_expected,to_char(dose.at at time zone 'Asia/Kolkata','HH24:MI')) else 'A dose record exists. Tablet details are private.' end;
   ml:=case when visible then format('%s ഗുളികകളിൽ %s കഴിച്ചതായി %s ന് രേഖപ്പെടുത്തി.',dose.count_expected,dose.count_taken,to_char(dose.at at time zone 'Asia/Kolkata','HH24:MI')) else 'മരുന്നിന്റെ രേഖയുണ്ട്. ഗുളിക വിവരങ്ങൾ സ്വകാര്യമാണ്.' end;
   return jsonb_build_object('status',dose.status,'textEn',en,'textMl',ml,'sentences',jsonb_build_array(jsonb_build_object('text',en,'textMl',ml,'cites',jsonb_build_array(dose.id))));
 end if;
 raise exception 'Unknown action';
end $$;

-- Only our authenticated backend can invoke this RPC with a verified Auth UID.
revoke all on function public.orma_can_access(uuid,uuid) from public,anon,authenticated;
revoke all on function public.orma_can_manage(uuid,uuid) from public,anon,authenticated;
revoke all on function public.orma_shares(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.orma_server_action(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.orma_server_action(uuid,text,jsonb) to service_role;

notify pgrst,'reload schema';
commit;
