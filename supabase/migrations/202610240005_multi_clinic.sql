-- Additive upgrade. Existing clinic, patient, appointment and history IDs remain unchanged.
alter table clinics add column kind text not null default 'ug' check(kind in ('ug','maritime','gilead','aura'));
alter table clinics add column color text not null default '#0f766e' check(color ~ '^#[0-9a-fA-F]{6}$');
alter table clinics add column workspace_root uuid references clinics(id);
alter table clinics add column doctor_id uuid references auth.users(id);
update clinics set workspace_root=id;
create unique index clinic_workspace_kind on clinics(workspace_root,kind);
alter table working_schedules add column opens time not null default '08:00';
alter table working_schedules add column closes time not null default '17:00';
alter table working_schedules add constraint schedule_hours check(opens<closes);
alter table appointments add column sync_status text not null default 'pending' check(sync_status in ('pending','synced','failed','disconnected'));
alter table appointments add column sync_error text;
alter table appointments add column sync_revision bigint not null default 1;
alter table appointment_status_history add column old_time time;
alter table appointment_status_history add column new_time time;

-- Server-only encrypted OAuth tokens and sync references; no browser grants or RLS policies.
create table google_connections(user_id uuid primary key references auth.users(id),tokens text not null,updated_at timestamptz not null default now());
create table google_calendar_mappings(clinic_id uuid primary key references clinics(id),user_id uuid not null references auth.users(id),calendar_id text not null,busy_calendars text[] not null default '{}');
create table google_event_refs(appointment_id uuid primary key references appointments(id),calendar_id text not null,event_id text not null,locked_until timestamptz,lock_token uuid,unique(calendar_id,event_id));
alter table google_connections enable row level security;
alter table google_calendar_mappings enable row level security;
alter table google_event_refs enable row level security;
revoke all on google_connections,google_calendar_mappings,google_event_refs from anon,authenticated;
grant all on google_connections,google_calendar_mappings,google_event_refs to service_role;

create or replace function setup_doctor_workspace(cid uuid) returns void language plpgsql security definer set search_path=public as $$
declare root clinics%rowtype; new_id uuid; spec record;
begin
 if not has_clinic_role(cid,array['admin','dentist']::member_role[]) then raise exception 'Unauthorized'; end if;
 select * into root from clinics where id=cid for update;
 if root.kind<>'ug' or root.workspace_root<>root.id then raise exception 'Select the existing UG clinic first'; end if;
 if root.doctor_id is not null and root.doctor_id<>auth.uid() then raise exception 'Workspace already belongs to another doctor'; end if;
 update clinics set name='UG Dental School',doctor_id=auth.uid(),workspace_root=cid where id=cid;
 for spec in select * from (values ('maritime','Maritime Regional Hospital','#2563eb'),('gilead','Gilead','#9333ea'),('aura','Aura','#ea580c')) as s(kind,name,color) loop
  insert into clinics(name,kind,color,workspace_root,doctor_id) values(spec.name,spec.kind,spec.color,cid,auth.uid()) on conflict(workspace_root,kind) do nothing;
  select id into new_id from clinics where workspace_root=cid and kind=spec.kind;
  insert into clinic_memberships(clinic_id,user_id,role) values(new_id,auth.uid(),'dentist') on conflict do nothing;
  insert into clinic_settings(clinic_id,appointment_duration_minutes) values(new_id,30) on conflict do nothing;
  if spec.kind='maritime' then
   insert into working_schedules(clinic_id,weekday,opens,closes) values(new_id,1,'09:00','13:00'),(new_id,2,'10:00','17:00'),(new_id,3,'10:00','13:00') on conflict do nothing;
  elsif spec.kind='gilead' then insert into working_schedules(clinic_id,weekday,opens,closes) values(new_id,6,'13:00','17:00') on conflict do nothing;
  else insert into working_schedules(clinic_id,weekday,opens,closes) values(new_id,1,'14:00','18:00') on conflict do nothing; end if;
 end loop;
end $$;
revoke all on function setup_doctor_workspace(uuid) from public,anon;
grant execute on function setup_doctor_workspace(uuid) to authenticated;

-- A common workspace lock serializes cross-clinic bookings, including direct database writes.
create or replace function guard_friday_booking() returns trigger language plpgsql security definer set search_path=public as $$
declare c clinics%rowtype; s working_schedules%rowtype; cap int; restoring boolean;
begin
 select * into c from clinics where id=new.clinic_id;
 perform pg_advisory_xact_lock(hashtextextended(coalesce(c.workspace_root,c.id)::text,0));
 if TG_OP='UPDATE' and (new.clinic_id<>old.clinic_id or new.patient_id<>old.patient_id) then raise exception 'Visit ownership cannot change'; end if;
 if not exists(select 1 from patients where id=new.patient_id and clinic_id=new.clinic_id) then raise exception 'Patient does not belong to clinic'; end if;
 if new.status in ('pending_approval','awaiting_confirmation','confirmed','reschedule_requested') then
  if exists(select 1 from appointments where clinic_id=new.clinic_id and patient_id=new.patient_id and id<>new.id and status in ('pending_approval','awaiting_confirmation','confirmed','reschedule_requested')) then raise exception 'Patient already has an active appointment'; end if;
  if TG_OP='INSERT' or new.appointment_date is distinct from old.appointment_date or new.appointment_time is distinct from old.appointment_time or new.duration_minutes is distinct from old.duration_minutes or old.status not in ('pending_approval','awaiting_confirmation','confirmed','reschedule_requested') then
   restoring:=TG_OP='UPDATE' and old.status='completed' and old.completed_at>=now()-interval '5 minutes' and new.appointment_date=old.appointment_date and new.appointment_time is not distinct from old.appointment_time;
   if new.appointment_date<(now() at time zone 'Africa/Accra')::date and not restoring then raise exception 'Choose an upcoming date'; end if;
   if exists(select 1 from blocked_dates where clinic_id=new.clinic_id and blocked_date=new.appointment_date) then raise exception 'Date is blocked'; end if;
   select * into s from working_schedules where clinic_id=new.clinic_id and weekday=extract(dow from new.appointment_date) and enabled;
   if not found then raise exception 'Clinic is closed on this date'; end if;
   if c.kind='ug' then
    if exists(select 1 from appointments a join clinics other on other.id=a.clinic_id where coalesce(other.workspace_root,other.id)=coalesce(c.workspace_root,c.id) and a.clinic_id<>new.clinic_id and a.appointment_date=new.appointment_date and a.status in ('pending_approval','awaiting_confirmation','confirmed','reschedule_requested','completed')) then raise exception 'Doctor has an overlapping clinic booking on this date'; end if;
    if extract(dow from new.appointment_date)<>5 or new.appointment_time is not null or new.duration_minutes is not null then raise exception 'UG bookings are Friday date-only'; end if;
    select coalesce(s.capacity_override,daily_capacity) into cap from clinic_settings where clinic_id=new.clinic_id;
    if (select count(*) from appointments where clinic_id=new.clinic_id and appointment_date=new.appointment_date and id<>new.id and status in ('pending_approval','awaiting_confirmation','confirmed','reschedule_requested'))>=cap then raise exception 'Friday is full'; end if;
   else
    if new.appointment_time is null or new.duration_minutes is null or new.duration_minutes not between 30 and 60 then raise exception 'Choose a time and duration from 30 to 60 minutes'; end if;
    if new.appointment_time<s.opens or new.appointment_date+new.appointment_time+make_interval(mins=>new.duration_minutes)>new.appointment_date+s.closes then raise exception 'Appointment is outside clinic hours'; end if;
    if new.appointment_date+new.appointment_time < now() at time zone 'Africa/Accra' and not restoring then raise exception 'Choose an upcoming time'; end if;
    if exists(select 1 from appointments a join clinics other on other.id=a.clinic_id where coalesce(other.workspace_root,other.id)=coalesce(c.workspace_root,c.id) and a.id<>new.id and a.appointment_date=new.appointment_date and a.status in ('pending_approval','awaiting_confirmation','confirmed','reschedule_requested','completed') and (a.appointment_time is null or (a.appointment_date+a.appointment_time<new.appointment_date+new.appointment_time+make_interval(mins=>new.duration_minutes) and new.appointment_date+new.appointment_time<a.appointment_date+a.appointment_time+make_interval(mins=>a.duration_minutes)))) then raise exception 'Doctor has an overlapping appointment'; end if;
   end if;
  end if;
 end if;
 return new;
end $$;

-- Never infer non-attendance from an unclosed visit.
create or replace function record_missed_visit() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if old.appointment_date<(now() at time zone 'Africa/Accra')::date and new.appointment_date is distinct from old.appointment_date and old.status in ('pending_approval','awaiting_confirmation','confirmed','reschedule_requested') then
  insert into appointment_status_history(appointment_id,from_status,to_status,changed_by,reason,old_date,new_date) values(old.id,old.status,old.status,auth.uid(),'attendance not recorded',old.appointment_date,old.appointment_date);
 end if;
 return new;
end $$;

create or replace function multi_clinic_visit(p_clinic uuid,p_action text,p_id uuid,p_date date default null,p_time time default null,p_duration int default null) returns uuid language plpgsql security definer set search_path=public as $$
declare result uuid; a appointments%rowtype; root uuid;
begin
 if not is_clinic_member(p_clinic) then raise exception 'Unauthorized'; end if;
 select coalesce(workspace_root,id) into root from clinics where id=p_clinic;
 perform pg_advisory_xact_lock(hashtextextended(root::text,0));
 if p_action='add' then
  insert into appointments(clinic_id,patient_id,appointment_date,appointment_time,duration_minutes,status,created_by) values(p_clinic,p_id,p_date,p_time,p_duration,'awaiting_confirmation',auth.uid()) returning id into result;
 elsif p_action='reschedule' then
  select * into a from appointments where id=p_id and clinic_id=p_clinic for update;
  if not found or a.status not in ('pending_approval','awaiting_confirmation','confirmed','reschedule_requested') then raise exception 'Active appointment not found'; end if;
  update appointments set appointment_date=p_date,appointment_time=p_time,duration_minutes=p_duration,arrived_at=null,status='awaiting_confirmation',updated_at=clock_timestamp() where id=p_id;
  result:=p_id;
 else result:=clinic_day_action(p_clinic,p_action,p_id,p_date); end if;
 return result;
end $$;
revoke all on function multi_clinic_visit(uuid,text,uuid,date,time,int) from public,anon;
grant execute on function multi_clinic_visit(uuid,text,uuid,date,time,int) to authenticated;
-- Business changes use checked RPCs. Browsers must not forge synchronization state.
revoke insert,update,delete on appointments from authenticated,anon;

create or replace function mark_calendar_pending() returns trigger language plpgsql as $$
begin
 if new.status is distinct from old.status or new.appointment_date is distinct from old.appointment_date or new.appointment_time is distinct from old.appointment_time or new.duration_minutes is distinct from old.duration_minutes then
  new.sync_status:='pending';new.sync_error:=null;new.sync_revision:=old.sync_revision+1;
 end if;
 return new;
end $$;
create trigger calendar_pending before update on appointments for each row execute function mark_calendar_pending();

create or replace function visit_changed() returns trigger language plpgsql security definer set search_path=public as $$
declare k text;
begin
 if TG_OP='UPDATE' and new.status=old.status and new.appointment_date=old.appointment_date and new.appointment_time is not distinct from old.appointment_time and new.duration_minutes is not distinct from old.duration_minutes then return new; end if;
 k:=case when TG_OP='INSERT' then 'add' when new.status='cancelled' then 'cancel' when new.status='completed' then 'complete' when new.appointment_date<>old.appointment_date or new.appointment_time is distinct from old.appointment_time or new.duration_minutes is distinct from old.duration_minutes then 'reschedule' else 'status' end;
 insert into appointment_status_history(appointment_id,from_status,to_status,changed_by,reason,old_date,new_date,old_time,new_time) values(new.id,case when TG_OP='UPDATE' then old.status else null end,new.status,auth.uid(),k,case when TG_OP='UPDATE' then old.appointment_date else null end,new.appointment_date,case when TG_OP='UPDATE' then old.appointment_time else null end,new.appointment_time);
 insert into audit_logs(clinic_id,actor_id,action,entity_type,entity_id) values(new.clinic_id,auth.uid(),k,'appointment',new.id);
 if k in ('complete','cancel','reschedule') then
  update notification_jobs set status='cancelled' where appointment_id=new.id and status='pending';
  update patient_confirmation_tokens set used_at=now() where appointment_id=new.id and used_at is null;
 end if;
 if new.status='completed' and exists(select 1 from clinics where id=new.clinic_id and kind='ug') then
  insert into follow_up_recommendations(clinic_id,patient_id,source_appointment_id,interval_weeks,target_date) select new.clinic_id,new.patient_id,new.id,p.default_follow_up_weeks,coalesce(new.completed_at::date,new.appointment_date)+p.default_follow_up_weeks*7 from patients p where p.id=new.patient_id on conflict(source_appointment_id) do update set target_date=excluded.target_date,interval_weeks=excluded.interval_weeks;
 elsif k='cancel' or new.status in ('awaiting_confirmation','confirmed') then
  perform queue_visit_message(new.id,k,new.id||':'||k||':'||new.sync_revision);
  if k in ('add','reschedule') then perform rebuild_reminders(new.id); end if;
 end if;
 return new;
end $$;

create or replace function queue_visit_message(aid uuid,event_kind text,event_key text,due timestamptz default now()) returns void language plpgsql security definer set search_path=public as $$
declare a appointments%rowtype;p patients%rowtype;c record;body_text text;
begin
 select * into a from appointments where id=aid;select * into p from patients where id=a.patient_id;
 select cl.name,s.* into c from clinics cl join clinic_settings s on s.clinic_id=cl.id where cl.id=a.clinic_id;
 body_text:='Hello '||p.full_name||', your appointment at '||c.name||' '||case when event_kind='cancel' then 'on '||to_char(a.appointment_date,'FMDay FMDD FMMonth')||' has been cancelled.' else 'is on '||to_char(a.appointment_date,'FMDay FMDD FMMonth')||case when a.appointment_time is null then '' else ' at '||to_char(a.appointment_time,'HH24:MI')||' (Ghana time)' end||'.' end||' Please contact the clinic'||case when coalesce(c.contact_number,'')='' then '' else ' on '||c.contact_number end||' to confirm or ask questions.';
 insert into notification_jobs(clinic_id,patient_id,appointment_id,channel,recipient,body,scheduled_for,idempotency_key,kind,simulated) values(a.clinic_id,p.id,a.id,'sms',p.phone,body_text,due,event_key,event_kind,not(c.messaging_enabled and c.messaging_provider<>'mock' and p.messaging_consent and p.opted_out_at is null)) on conflict(idempotency_key) do nothing;
end $$;

create or replace function save_workspace_schedule(cid uuid,config jsonb) returns void language plpgsql security definer set search_path=public as $$
declare s jsonb; root uuid;
begin
 if not has_clinic_role(cid,array['admin','dentist']::member_role[]) then raise exception 'Unauthorized'; end if;
 select coalesce(workspace_root,id) into root from clinics where id=cid;
 perform pg_advisory_xact_lock(hashtextextended(root::text,0));
 if length(config->>'name')<2 or (config->>'duration')::int not between 30 and 60 or (config->>'followUpWeeks')::int not between 1 and 52 then raise exception 'Invalid schedule'; end if;
 if exists(select 1 from clinics where id=cid and kind='ug') and exists(select 1 from jsonb_array_elements(config->'schedules') x where (x->>'enabled')::boolean and (x->>'weekday')::int<>5) then raise exception 'UG remains Friday date-only'; end if;
 update clinics set color=config->>'color' where id=cid;
 update clinic_settings set appointment_duration_minutes=(config->>'duration')::int,default_follow_up_weeks=(config->>'followUpWeeks')::int where clinic_id=cid;
 update working_schedules set enabled=false where clinic_id=cid;
 for s in select * from jsonb_array_elements(config->'schedules') loop
  insert into working_schedules(clinic_id,weekday,enabled,opens,closes) values(cid,(s->>'weekday')::smallint,(s->>'enabled')::boolean,(s->>'opens')::time,(s->>'closes')::time) on conflict(clinic_id,weekday) do update set enabled=excluded.enabled,opens=excluded.opens,closes=excluded.closes;
 end loop;
 insert into audit_logs(clinic_id,actor_id,action,entity_type,entity_id) values(cid,auth.uid(),'schedule.updated','clinic',cid);
end $$;
revoke all on function save_workspace_schedule(uuid,jsonb) from public,anon;
grant execute on function save_workspace_schedule(uuid,jsonb) to authenticated;

create function preserve_patient_clinic() returns trigger language plpgsql as $$
begin
 if new.clinic_id<>old.clinic_id then raise exception 'Patient records cannot be moved between clinics'; end if;
 return new;
end $$;
create trigger patient_clinic_immutable before update on patients for each row execute function preserve_patient_clinic();
create function patient_calendar_name_changed() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.full_name<>old.full_name then update appointments set sync_status='pending',sync_error=null,sync_revision=sync_revision+1 where patient_id=new.id; end if;
 return new;
end $$;
create trigger patient_calendar_name after update on patients for each row execute function patient_calendar_name_changed();

create or replace function save_clinic_settings(cid uuid,config jsonb,acknowledge boolean default false) returns void language plpgsql security definer set search_path=public as $$
declare cap integer; conflicts integer; a record; c clinics%rowtype;
begin
 if not has_clinic_role(cid,array['admin','dentist']::member_role[]) then raise exception 'Only clinic administrators and dentists can change settings'; end if;
 select * into c from clinics where id=cid;
 perform pg_advisory_xact_lock(hashtextextended(coalesce(c.workspace_root,c.id)::text,0));
 cap:=(config->>'capacity')::integer;
 if cap is null or cap not between 1 and 100 or length(config->>'clinicName')<2 then raise exception 'Invalid settings'; end if;
 if exists(select 1 from jsonb_array_elements_text(config->'reminderDays') d where d::integer not between 1 and 60) then raise exception 'Invalid reminder interval'; end if;
 select count(*) into conflicts from appointments where clinic_id=cid and appointment_date>=current_date and status in ('pending_approval','awaiting_confirmation','confirmed','reschedule_requested') and (appointment_date in (select value::date from jsonb_array_elements_text(config->'blocked')) or (c.kind='ug' and appointment_date in (select appointment_date from appointments where clinic_id=cid and status in ('pending_approval','awaiting_confirmation','confirmed','reschedule_requested') group by appointment_date having count(*)>cap)));
 if conflicts>0 and not acknowledge then raise exception 'Existing bookings are affected. Review and acknowledge the impact before saving'; end if;
 update clinics set name=config->>'clinicName',updated_at=now() where id=cid;
 update clinic_settings set contact_number=config->>'contactNumber',daily_capacity=cap,reminder_days=array(select distinct value::int from jsonb_array_elements_text(config->'reminderDays')),messaging_enabled=(config->>'messagingEnabled')::boolean,messaging_provider=config->>'provider',updated_at=now() where clinic_id=cid;
 update working_schedules set capacity_override=null where clinic_id=cid and weekday=5;
 delete from blocked_dates where clinic_id=cid and blocked_date not in (select value::date from jsonb_array_elements_text(config->'blocked'));
 insert into blocked_dates(clinic_id,blocked_date,reason) select cid,value::date,'Clinic unavailable' from jsonb_array_elements_text(config->'blocked') on conflict(clinic_id,blocked_date) do nothing;
 for a in select id from appointments where clinic_id=cid and appointment_date>=current_date loop perform rebuild_reminders(a.id); end loop;
 insert into audit_logs(clinic_id,actor_id,action,entity_type,entity_id,metadata) values(cid,auth.uid(),'settings.updated','clinic',cid,jsonb_build_object('affectedBookings',conflicts));
end $$;
