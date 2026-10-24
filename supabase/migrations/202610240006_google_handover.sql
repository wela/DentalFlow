-- Existing records are production by default. Never infer test status from names or dates.
create table workspace_lifecycle (
 user_id uuid primary key references auth.users(id), mode text not null default 'production' check(mode in ('production','test')),
 test_session uuid, cleanup_active boolean not null default false, test_cleared_at timestamptz,
 test_account_sub text, developer_disconnected_at timestamptz, production_confirmed_at timestamptz,
 operation_token uuid, operation_until timestamptz, operation text, revocation_warning text
);
alter table workspace_lifecycle enable row level security;
revoke all on workspace_lifecycle from public,anon,authenticated;
grant all on workspace_lifecycle to service_role;
alter table google_connections add column connection_id uuid not null default gen_random_uuid();
alter table google_connections add column account_sub text;
alter table google_connections add column account_email text;
alter table google_connections add column is_test boolean not null default false;
alter table google_calendar_mappings add column account_sub text;
alter table google_calendar_mappings add column is_test boolean not null default false;
alter table google_event_refs add column account_sub text;
alter table google_event_refs add column test_session uuid;
alter table google_event_refs add column test_deleted_at timestamptz;
alter table google_event_refs add column cleanup_error text;
create table google_created_calendars (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),clinic_id uuid not null references clinics(id),
 account_sub text not null,test_session uuid,calendar_id text,status text not null default 'creating' check(status in ('creating','created','uncertain')),
 created_at timestamptz not null default now()
);
alter table google_created_calendars enable row level security;
revoke all on google_created_calendars from public,anon,authenticated;
grant all on google_created_calendars to service_role;
alter table patients add column is_test boolean not null default false;
alter table patients add column test_session uuid;
alter table appointments add column is_test boolean not null default false;
alter table appointments add column test_session uuid;
alter table notification_jobs add column is_test boolean not null default false;
alter table patients add constraint patient_test_session check(is_test=(test_session is not null));
alter table appointments add constraint appointment_test_session check(is_test=(test_session is not null));

create function workspace_is_test(cid uuid) returns boolean language sql stable security definer set search_path=public as $$
 select coalesce((select l.mode='test' from clinics c join workspace_lifecycle l on l.user_id=c.doctor_id where c.id=cid),false)
$$;
revoke all on function workspace_is_test(uuid) from public,anon;
grant execute on function workspace_is_test(uuid) to authenticated,service_role;
create policy patient_mode on patients as restrictive for all using(is_test=workspace_is_test(clinic_id)) with check(is_test=workspace_is_test(clinic_id));
create policy appointment_mode on appointments as restrictive for all using(is_test=workspace_is_test(clinic_id)) with check(is_test=workspace_is_test(clinic_id));
create policy notification_mode on notification_jobs as restrictive for select using(is_test=workspace_is_test(clinic_id));

create function set_patient_test_scope() returns trigger language plpgsql security definer set search_path=public as $$
declare l workspace_lifecycle%rowtype;
begin
 select l0.* into l from workspace_lifecycle l0 join clinics c on c.doctor_id=l0.user_id where c.id=new.clinic_id for share of l0;
 if l.operation='mode' and l.operation_until>now() then raise exception 'Workspace mode is changing. Refresh before saving'; end if;
 if TG_OP='INSERT' then
  if new.is_test<>coalesce(l.mode='test',false) then raise exception 'Workspace mode changed. Refresh before registering a patient'; end if;
  new.test_session:=case when new.is_test then l.test_session else null end;
 elsif new.is_test<>old.is_test or new.test_session is distinct from old.test_session then raise exception 'Test classification is immutable'; end if;
 if new.is_test<>coalesce(l.mode='test',false) then raise exception 'Patient belongs to a different workspace mode'; end if;
 if new.is_test and (l.cleanup_active or l.test_cleared_at is not null) then raise exception 'Test data is locked for cleanup or handover'; end if;
 return new;
end $$;
create trigger aaa_patient_test_scope before insert or update on patients for each row execute function set_patient_test_scope();
create function set_appointment_test_scope() returns trigger language plpgsql security definer set search_path=public as $$
declare p patients%rowtype;l workspace_lifecycle%rowtype;
begin
 select * into p from patients where id=new.patient_id and clinic_id=new.clinic_id;
 select l0.* into l from workspace_lifecycle l0 join clinics c on c.doctor_id=l0.user_id where c.id=new.clinic_id for share of l0;
 if TG_OP='INSERT' then new.is_test:=p.is_test;new.test_session:=p.test_session;
 elsif new.is_test<>old.is_test or new.test_session is distinct from old.test_session then raise exception 'Test classification is immutable'; end if;
 -- Service-only sync metadata updates are allowed while a mode is inactive, but never business edits.
 if TG_OP='UPDATE' and auth.uid() is null and new.status=old.status and new.patient_id=old.patient_id and new.appointment_date=old.appointment_date and new.appointment_time is not distinct from old.appointment_time and new.duration_minutes is not distinct from old.duration_minutes then return new; end if;
 if new.is_test is distinct from p.is_test or new.is_test<>coalesce(l.mode='test',false) then raise exception 'Appointment belongs to a different workspace mode'; end if;
 if new.is_test and (l.cleanup_active or l.test_cleared_at is not null) then raise exception 'Test data is locked for cleanup or handover'; end if;
 return new;
end $$;
create trigger aaa_appointment_test_scope before insert or update on appointments for each row execute function set_appointment_test_scope();
revoke delete on patients from authenticated,anon;

-- Security-definer booking functions must enforce the current mode, not bypass its RLS filter.
alter function multi_clinic_visit(uuid,text,uuid,date,time,int) rename to multi_clinic_visit_v5;
create function multi_clinic_visit(p_clinic uuid,p_action text,p_id uuid,p_date date default null,p_time time default null,p_duration int default null) returns uuid language plpgsql security definer set search_path=public as $$
declare scoped boolean;
begin
 if not is_clinic_member(p_clinic) then raise exception 'Unauthorized'; end if;
 if p_action='add' then select is_test=workspace_is_test(p_clinic) into scoped from patients where id=p_id and clinic_id=p_clinic;
 elsif p_action='retry' then select is_test=workspace_is_test(p_clinic) into scoped from notification_jobs where id=p_id and clinic_id=p_clinic;
 else select is_test=workspace_is_test(p_clinic) into scoped from appointments where id=p_id and clinic_id=p_clinic; end if;
 if scoped is not true then raise exception 'Record is not in the current workspace mode'; end if;
 if exists(select 1 from workspace_lifecycle l join clinics c on c.doctor_id=l.user_id where c.id=p_clinic and l.mode='test' and (l.cleanup_active or l.test_cleared_at is not null)) then raise exception 'Test workspace is locked for cleanup or handover'; end if;
 if p_action='defer' then return defer_follow_up(p_clinic,p_id); end if;
 return multi_clinic_visit_v5(p_clinic,p_action,p_id,p_date,p_time,p_duration);
end $$;
revoke all on function multi_clinic_visit_v5(uuid,text,uuid,date,time,int),quick_visit(uuid,text,uuid,date),clinic_day_action(uuid,text,uuid,date),defer_follow_up(uuid,uuid),book_appointment(uuid,uuid,date,time,uuid,appointment_status) from public,anon,authenticated;
revoke all on function multi_clinic_visit(uuid,text,uuid,date,time,int) from public,anon;
-- A mode expectation is carried by the UI and checked under the same transaction lock.
alter function multi_clinic_visit(uuid,text,uuid,date,time,int) rename to multi_clinic_visit_scoped;
create function multi_clinic_visit(p_clinic uuid,p_action text,p_id uuid,p_date date default null,p_time time default null,p_duration int default null,p_expected_test boolean default false) returns uuid language plpgsql security definer set search_path=public as $$
declare actual boolean;
begin
 perform 1 from workspace_lifecycle l join clinics c on c.doctor_id=l.user_id where c.id=p_clinic for share of l;
 actual:=workspace_is_test(p_clinic);
 if p_expected_test is distinct from actual then raise exception 'Workspace mode changed. Refresh before saving'; end if;
 return multi_clinic_visit_scoped(p_clinic,p_action,p_id,p_date,p_time,p_duration);
end $$;
revoke all on function multi_clinic_visit_scoped(uuid,text,uuid,date,time,int) from public,anon,authenticated;
revoke all on function multi_clinic_visit(uuid,text,uuid,date,time,int,boolean) from public,anon;
grant execute on function multi_clinic_visit(uuid,text,uuid,date,time,int,boolean) to authenticated;
create function test_message_scope() returns trigger language plpgsql security definer set search_path=public as $$
begin
 select is_test into new.is_test from patients where id=new.patient_id;
 if new.is_test then new.simulated:=true; end if;
 return new;
end $$;
create trigger aaa_test_message before insert or update on notification_jobs for each row execute function test_message_scope();

-- One bounded, server-only lease serializes Google operations with cleanup/account replacement.
create function begin_google_operation(uid uuid,op text) returns uuid language plpgsql security definer set search_path=public as $$
declare l workspace_lifecycle%rowtype;lease uuid:=gen_random_uuid();
begin
 insert into workspace_lifecycle(user_id) values(uid) on conflict do nothing;
 select * into l from workspace_lifecycle where user_id=uid for update;
 if l.operation_until>now() then raise exception 'Another Google operation is running. Retry shortly'; end if;
 if l.cleanup_active and op not in ('cleanup','disconnect','connect','status') then raise exception 'Test cleanup must finish before other Google changes'; end if;
 update workspace_lifecycle set operation_token=lease,operation_until=now()+interval '120 seconds',operation=op where user_id=uid;
 return lease;
end $$;
create function finish_test_cleanup(uid uuid,sid uuid) returns void language plpgsql security definer set search_path=public as $$
declare l workspace_lifecycle%rowtype;
begin
 select * into l from workspace_lifecycle where user_id=uid for update;
 if l.mode<>'test' or not l.cleanup_active or l.test_session is distinct from sid then raise exception 'Invalid test cleanup session'; end if;
 if exists(select 1 from google_event_refs r join appointments a on a.id=r.appointment_id join clinics c on c.id=a.clinic_id where c.doctor_id=uid and a.is_test and a.test_session=sid and r.test_deleted_at is null) then raise exception 'Google deletion is incomplete. Local references retained'; end if;
 if exists(select 1 from appointments a join patients p on p.id=a.patient_id join clinics c on c.id=p.clinic_id where c.doctor_id=uid and p.is_test and p.test_session=sid and (not a.is_test or a.test_session is distinct from sid)) then raise exception 'Production reference detected. Cleanup stopped'; end if;
 delete from notification_receipts where job_id in(select j.id from notification_jobs j join patients p on p.id=j.patient_id join clinics c on c.id=p.clinic_id where c.doctor_id=uid and p.is_test and p.test_session=sid);
 delete from audit_logs where entity_id in(select a.id from appointments a join clinics c on c.id=a.clinic_id where c.doctor_id=uid and a.is_test and a.test_session=sid union select p.id from patients p join clinics c on c.id=p.clinic_id where c.doctor_id=uid and p.is_test and p.test_session=sid);
 delete from google_event_refs where appointment_id in(select a.id from appointments a join clinics c on c.id=a.clinic_id where c.doctor_id=uid and a.is_test and a.test_session=sid);
 delete from appointments where is_test and test_session=sid and clinic_id in(select id from clinics where doctor_id=uid);
 delete from patients where is_test and test_session=sid and clinic_id in(select id from clinics where doctor_id=uid);
 update workspace_lifecycle set cleanup_active=false,test_cleared_at=now() where user_id=uid;
end $$;
revoke all on function begin_google_operation(uuid,text),finish_test_cleanup(uuid,uuid) from public,anon,authenticated;
grant execute on function begin_google_operation(uuid,text),finish_test_cleanup(uuid,uuid) to service_role;

-- Capacity/conflicts stay isolated between fictional and production records.
create or replace function guard_friday_booking() returns trigger language plpgsql security definer set search_path=public as $$
declare c clinics%rowtype; s working_schedules%rowtype; cap int; restoring boolean;
begin
 select * into c from clinics where id=new.clinic_id;
 perform pg_advisory_xact_lock(hashtextextended(coalesce(c.workspace_root,c.id)::text,0));
 if TG_OP='UPDATE' and (new.clinic_id<>old.clinic_id or new.patient_id<>old.patient_id) then raise exception 'Visit ownership cannot change'; end if;
 if not exists(select 1 from patients where id=new.patient_id and clinic_id=new.clinic_id) then raise exception 'Patient does not belong to clinic'; end if;
 if new.status in ('pending_approval','awaiting_confirmation','confirmed','reschedule_requested') then
  if exists(select 1 from appointments where is_test=new.is_test and clinic_id=new.clinic_id and patient_id=new.patient_id and id<>new.id and status in ('pending_approval','awaiting_confirmation','confirmed','reschedule_requested')) then raise exception 'Patient already has an active appointment'; end if;
  if TG_OP='INSERT' or new.appointment_date is distinct from old.appointment_date or new.appointment_time is distinct from old.appointment_time or new.duration_minutes is distinct from old.duration_minutes or old.status not in ('pending_approval','awaiting_confirmation','confirmed','reschedule_requested') then
   restoring:=TG_OP='UPDATE' and old.status='completed' and old.completed_at>=now()-interval '5 minutes' and new.appointment_date=old.appointment_date and new.appointment_time is not distinct from old.appointment_time;
   if new.appointment_date<(now() at time zone 'Africa/Accra')::date and not restoring then raise exception 'Choose an upcoming date'; end if;
   if exists(select 1 from blocked_dates where clinic_id=new.clinic_id and blocked_date=new.appointment_date) then raise exception 'Date is blocked'; end if;
   select * into s from working_schedules where clinic_id=new.clinic_id and weekday=extract(dow from new.appointment_date) and enabled;
   if not found then raise exception 'Clinic is closed on this date'; end if;
   if c.kind='ug' then
    if exists(select 1 from appointments a join clinics other on other.id=a.clinic_id where a.is_test=new.is_test and coalesce(other.workspace_root,other.id)=coalesce(c.workspace_root,c.id) and a.clinic_id<>new.clinic_id and a.appointment_date=new.appointment_date and a.status in ('pending_approval','awaiting_confirmation','confirmed','reschedule_requested','completed')) then raise exception 'Doctor has an overlapping clinic booking on this date'; end if;
    if extract(dow from new.appointment_date)<>5 or new.appointment_time is not null or new.duration_minutes is not null then raise exception 'UG bookings are Friday date-only'; end if;
    select coalesce(s.capacity_override,daily_capacity) into cap from clinic_settings where clinic_id=new.clinic_id;
    if (select count(*) from appointments where is_test=new.is_test and clinic_id=new.clinic_id and appointment_date=new.appointment_date and id<>new.id and status in ('pending_approval','awaiting_confirmation','confirmed','reschedule_requested'))>=cap then raise exception 'Friday is full'; end if;
   else
    if new.appointment_time is null or new.duration_minutes is null or new.duration_minutes not between 30 and 60 then raise exception 'Choose a time and duration from 30 to 60 minutes'; end if;
    if new.appointment_time<s.opens or new.appointment_date+new.appointment_time+make_interval(mins=>new.duration_minutes)>new.appointment_date+s.closes then raise exception 'Appointment is outside clinic hours'; end if;
    if new.appointment_date+new.appointment_time < now() at time zone 'Africa/Accra' and not restoring then raise exception 'Choose an upcoming time'; end if;
    if exists(select 1 from appointments a join clinics other on other.id=a.clinic_id where a.is_test=new.is_test and coalesce(other.workspace_root,other.id)=coalesce(c.workspace_root,c.id) and a.id<>new.id and a.appointment_date=new.appointment_date and a.status in ('pending_approval','awaiting_confirmation','confirmed','reschedule_requested','completed') and (a.appointment_time is null or (a.appointment_date+a.appointment_time<new.appointment_date+new.appointment_time+make_interval(mins=>new.duration_minutes) and new.appointment_date+new.appointment_time<a.appointment_date+a.appointment_time+make_interval(mins=>a.duration_minutes)))) then raise exception 'Doctor has an overlapping appointment'; end if;
   end if;
  end if;
 end if;
 return new;
end $$;
