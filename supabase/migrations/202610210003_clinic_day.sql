alter table public.appointments add column if not exists arrived_at timestamptz;
alter table public.appointments add column if not exists completion_previous_status public.appointment_status;
alter table public.notification_jobs add column if not exists claimed_at timestamptz;
create table public.notification_receipts(event_id text primary key,job_id uuid not null references public.notification_jobs(id),status text not null check(status in ('delivered','failed')),received_at timestamptz not null default now());
alter table public.notification_receipts enable row level security;

create or replace function public.visit_completion_snapshot() returns trigger language plpgsql set search_path=public as $$
begin
 if new.status='completed' and old.status<>'completed' then new.completion_previous_status:=old.status; end if;
 if new.appointment_date<>old.appointment_date then new.arrived_at:=null; end if;
 return new;
end $$;
create trigger capture_completion before update on public.appointments for each row execute function public.visit_completion_snapshot();

create or replace function public.rebuild_reminders(aid uuid) returns void language plpgsql security definer set search_path=public as $$
declare a appointments%rowtype; days integer; due timestamptz;
begin
 select * into a from appointments where id=aid;
 update notification_jobs set status='cancelled' where appointment_id=aid and kind='reminder' and status='pending';
 if a.status not in ('awaiting_confirmation','confirmed','reschedule_requested') then return; end if;
 foreach days in array (select reminder_days from clinic_settings where clinic_id=a.clinic_id) loop
  due:=((a.appointment_date-days)::text||' 06:00:00+00')::timestamptz;
  if due>now() then perform queue_visit_message(a.id,'reminder',a.id||':reminder:rebuild:'||clock_timestamp()||':'||days,due); end if;
 end loop;
end $$;

create or replace function public.clinic_day_action(p_clinic uuid,p_action text,p_id uuid,p_date date default null) returns uuid language plpgsql security definer set search_path=public as $$
declare a appointments%rowtype; j notification_jobs%rowtype; result uuid;
begin
 if not is_clinic_member(p_clinic) then raise exception 'Unauthorized'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_clinic::text,0));
 if p_action='retry' then
  select * into j from notification_jobs where id=p_id and clinic_id=p_clinic for update;
  if not found or j.status<>'failed' then raise exception 'Only failed messages can be retried'; end if;
  if j.kind<>'cancel' and exists(select 1 from appointments where id=j.appointment_id and (status in ('completed','cancelled','no_show') or (j.kind='reminder' and appointment_date<current_date))) then raise exception 'This message is outdated'; end if;
  update notification_jobs set status='pending',attempt_count=0,scheduled_for=now(),last_error=null where id=j.id;
  return j.appointment_id;
 end if;
 if p_action not in ('arrive','undo') then
  result:=quick_visit(p_clinic,p_action,p_id,p_date);
  if p_action='complete' then update follow_up_recommendations set status='pending' where source_appointment_id=result; end if;
  return result;
 end if;
 select * into a from appointments where id=p_id and clinic_id=p_clinic for update;
 if not found then raise exception 'Appointment not found'; end if;
 if p_action='arrive' then
  if a.appointment_date<>(now() at time zone 'Africa/Accra')::date or a.status not in ('awaiting_confirmation','confirmed','reschedule_requested') then raise exception 'Check-in is for today’s active visits'; end if;
  if a.arrived_at is null then
   update appointments set arrived_at=now() where id=a.id;
   insert into appointment_status_history(appointment_id,from_status,to_status,changed_by,reason,new_date) values(a.id,a.status,a.status,auth.uid(),'arrived',a.appointment_date);
  end if;
 else
  if a.status<>'completed' or a.completed_at is null or a.completed_at<now()-interval '5 minutes' then raise exception 'Undo is available for five minutes after completion'; end if;
  update appointments set status=coalesce(a.completion_previous_status,'confirmed'),completed_at=null,updated_at=now() where id=a.id;
  update follow_up_recommendations set status='expired' where source_appointment_id=a.id;
  update appointment_status_history set reason='completion undone' where appointment_id=a.id and created_at=now() and from_status='completed';
  perform rebuild_reminders(a.id);
 end if;
 return a.id;
end $$;

create or replace function public.save_clinic_settings(cid uuid,config jsonb,acknowledge boolean default false) returns void language plpgsql security definer set search_path=public as $$
declare cap integer; conflicts integer; a record;
begin
 if not has_clinic_role(cid,array['admin','dentist']::member_role[]) then raise exception 'Only clinic administrators and dentists can change settings'; end if;
 perform pg_advisory_xact_lock(hashtextextended(cid::text,0));
 cap:=(config->>'capacity')::integer;
 if cap is null or cap not between 1 and 100 or length(config->>'clinicName')<2 then raise exception 'Invalid settings'; end if;
 if exists(select 1 from jsonb_array_elements_text(config->'reminderDays') d where d::integer not between 1 and 60) then raise exception 'Invalid reminder interval'; end if;
 select count(*) into conflicts from appointments where clinic_id=cid and appointment_date>=current_date and status in ('pending_approval','awaiting_confirmation','confirmed','reschedule_requested') and (appointment_date in (select value::date from jsonb_array_elements_text(config->'blocked')) or appointment_date in (select appointment_date from appointments where clinic_id=cid and status in ('pending_approval','awaiting_confirmation','confirmed','reschedule_requested') group by appointment_date having count(*)>cap));
 if conflicts>0 and not acknowledge then raise exception 'Existing bookings are affected. Review and acknowledge the impact before saving'; end if;
 update clinics set name=config->>'clinicName',updated_at=now() where id=cid;
 update clinic_settings set contact_number=config->>'contactNumber',daily_capacity=cap,reminder_days=array(select distinct value::int from jsonb_array_elements_text(config->'reminderDays')),messaging_enabled=(config->>'messagingEnabled')::boolean,messaging_provider=config->>'provider',updated_at=now() where clinic_id=cid;
 update working_schedules set capacity_override=null where clinic_id=cid and weekday=5;
 delete from blocked_dates where clinic_id=cid and blocked_date not in (select value::date from jsonb_array_elements_text(config->'blocked'));
 insert into blocked_dates(clinic_id,blocked_date,reason) select cid,value::date,'Clinic unavailable' from jsonb_array_elements_text(config->'blocked') on conflict(clinic_id,blocked_date) do nothing;
 for a in select id from appointments where clinic_id=cid and appointment_date>=current_date loop perform rebuild_reminders(a.id); end loop;
 insert into audit_logs(clinic_id,actor_id,action,entity_type,entity_id,metadata) values(cid,auth.uid(),'settings.updated','clinic',cid,jsonb_build_object('affectedBookings',conflicts));
end $$;

create or replace function public.set_job_claim_time() returns trigger language plpgsql as $$
begin
 if new.status='processing' and old.status<>'processing' then new.claimed_at:=now(); end if;
 return new;
end $$;
create trigger set_claim_time before update on public.notification_jobs for each row execute function public.set_job_claim_time();

create or replace function public.claim_notification_jobs(p_limit int default 25) returns setof public.notification_jobs language plpgsql security definer set search_path=public as $$
begin
 update notification_jobs set status=case when simulated and attempt_count<max_attempts then 'pending'::notification_status else 'failed'::notification_status end,last_error=case when simulated then 'Interrupted simulation recovered' else 'Delivery uncertain: check the provider before retrying' end where status='processing' and coalesce(claimed_at,created_at)<now()-interval '10 minutes';
 update notification_jobs j set status='cancelled',last_error='Reminder is outdated' from appointments a where j.appointment_id=a.id and j.kind='reminder' and j.status='pending' and (a.appointment_date<current_date or a.status in ('completed','cancelled','no_show'));
 return query with claimed as (
 select j.id from notification_jobs j left join appointments a on a.id=j.appointment_id
 where j.status='pending' and j.scheduled_for<=now() and j.attempt_count<j.max_attempts and (j.kind='cancel' or a.id is null or a.status in ('awaiting_confirmation','confirmed','reschedule_requested'))
 order by j.scheduled_for for update of j skip locked limit greatest(1,least(p_limit,100))
 ) update notification_jobs j set status='processing',attempt_count=attempt_count+1 from claimed where j.id=claimed.id returning j.*;
end $$;

create or replace function public.record_delivery_receipt(eid text,provider_id text,result text) returns void language plpgsql security definer set search_path=public as $$
declare jid uuid;
begin
 if result not in ('delivered','failed') then raise exception 'Invalid receipt status'; end if;
 select j.id into jid from notification_attempts a join notification_jobs j on j.id=a.job_id where a.provider='http' and a.provider_message_id=provider_id and not j.simulated order by a.attempted_at desc limit 1;
 if jid is null then raise exception 'Provider message is not yet recorded'; end if;
 insert into notification_receipts(event_id,job_id,status) values(eid,jid,result) on conflict do nothing;
 if not found then return; end if;
 update notification_jobs set status=result::notification_status,last_error=case when result='failed' then 'Provider reported delivery failure' else null end where id=jid and status not in ('delivered','cancelled');
end $$;
revoke all on function public.rebuild_reminders(uuid) from public,anon,authenticated;
revoke all on function public.clinic_day_action(uuid,text,uuid,date) from public,anon;
grant execute on function public.clinic_day_action(uuid,text,uuid,date) to authenticated;
revoke all on function public.save_clinic_settings(uuid,jsonb,boolean) from public,anon;
grant execute on function public.save_clinic_settings(uuid,jsonb,boolean) to authenticated;
revoke all on function public.record_delivery_receipt(text,text,text) from public,anon,authenticated;
grant execute on function public.record_delivery_receipt(text,text,text) to service_role;
create or replace function public.queue_visit_message(aid uuid, event_kind text, event_key text, due timestamptz default now()) returns void language plpgsql security definer set search_path=public as $$
declare a appointments%rowtype; p patients%rowtype; live boolean; body_text text; clinic_name text; contact text;
begin
  select * into a from appointments where id=aid;
  select * into p from patients where id=a.patient_id;
  select messaging_enabled and messaging_provider<>'mock' into live from clinic_settings where clinic_id=a.clinic_id;
  select c.name,cs.contact_number into clinic_name,contact from clinics c join clinic_settings cs on cs.clinic_id=c.id where c.id=a.clinic_id;
  body_text:='Hello '||p.full_name||', your appointment at '||clinic_name||' '||case when event_kind='cancel' then 'on '||a.appointment_date||' has been cancelled.' else 'is scheduled for '||a.appointment_date||case when a.appointment_time is null then '' else ' at '||to_char(a.appointment_time,'HH24:MI') end||'.' end||' Please contact the clinic'||case when coalesce(contact,'')='' then '' else ' on '||contact end||' with any questions.';
  insert into notification_jobs(clinic_id,patient_id,appointment_id,channel,recipient,body,scheduled_for,idempotency_key,kind,simulated)
  values(a.clinic_id,p.id,a.id,'sms',p.phone,body_text,due,event_key,event_kind,not(coalesce(live,false) and p.messaging_consent and p.opted_out_at is null)) on conflict(idempotency_key) do nothing;
end $$;
create or replace function public.guard_friday_booking() returns trigger language plpgsql security definer set search_path=public as $$
declare cap integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.clinic_id::text,0));
  if not exists(select 1 from patients where id=new.patient_id and clinic_id=new.clinic_id) then raise exception 'Patient does not belong to clinic'; end if;
  if new.appointment_type_id is not null and not exists(select 1 from appointment_types where id=new.appointment_type_id and clinic_id=new.clinic_id) then raise exception 'Invalid appointment type'; end if;
  if new.status in ('pending_approval','awaiting_confirmation','confirmed','reschedule_requested') then
    if exists(select 1 from appointments where clinic_id=new.clinic_id and patient_id=new.patient_id and id<>new.id and status in ('pending_approval','awaiting_confirmation','confirmed','reschedule_requested')) then raise exception 'Patient already has an active appointment'; end if;
    if TG_OP='INSERT' or new.appointment_date is distinct from old.appointment_date or old.status not in ('pending_approval','awaiting_confirmation','confirmed','reschedule_requested') then
      if extract(dow from new.appointment_date)<>5 or (new.appointment_date<(now() at time zone 'Africa/Accra')::date and not (TG_OP='UPDATE' and old.status='completed' and old.completed_at>=now()-interval '5 minutes' and new.appointment_date=old.appointment_date)) then raise exception 'Choose a future or current Friday'; end if;
      if exists(select 1 from blocked_dates where clinic_id=new.clinic_id and blocked_date=new.appointment_date) then raise exception 'Date is blocked'; end if;
      select coalesce(w.capacity_override,c.daily_capacity) into cap from clinic_settings c join working_schedules w on w.clinic_id=c.clinic_id and w.weekday=5 and w.enabled where c.clinic_id=new.clinic_id;
      if cap is null then raise exception 'Friday schedule is not configured'; end if;
      if (select count(*) from appointments where clinic_id=new.clinic_id and appointment_date=new.appointment_date and id<>new.id and status in ('pending_approval','awaiting_confirmation','confirmed','reschedule_requested'))>=cap then raise exception 'Friday is full'; end if;
    end if;
  end if;
  return new;
end $$;
