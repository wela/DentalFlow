-- Additive migration: existing patient and visit records are retained.
alter table public.appointment_status_history add column if not exists old_date date;
alter table public.appointment_status_history add column if not exists new_date date;
alter table public.notification_jobs add column if not exists kind text not null default 'reminder';
alter table public.notification_jobs add column if not exists simulated boolean not null default true;

create or replace function public.guard_friday_booking() returns trigger language plpgsql security definer set search_path=public as $$
declare cap integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.clinic_id::text,0));
  if not exists(select 1 from patients where id=new.patient_id and clinic_id=new.clinic_id) then raise exception 'Patient does not belong to clinic'; end if;
  if new.appointment_type_id is not null and not exists(select 1 from appointment_types where id=new.appointment_type_id and clinic_id=new.clinic_id) then raise exception 'Invalid appointment type'; end if;
  if new.status in ('pending_approval','awaiting_confirmation','confirmed','reschedule_requested') then
    if exists(select 1 from appointments where clinic_id=new.clinic_id and patient_id=new.patient_id and id<>new.id and status in ('pending_approval','awaiting_confirmation','confirmed','reschedule_requested')) then raise exception 'Patient already has an active appointment'; end if;
    if TG_OP='INSERT' or new.appointment_date is distinct from old.appointment_date or old.status not in ('pending_approval','awaiting_confirmation','confirmed','reschedule_requested') then
      if extract(dow from new.appointment_date)<>5 or new.appointment_date<(now() at time zone 'Africa/Accra')::date then raise exception 'Choose a future or current Friday'; end if;
      if exists(select 1 from blocked_dates where clinic_id=new.clinic_id and blocked_date=new.appointment_date) then raise exception 'Date is blocked'; end if;
      select coalesce(w.capacity_override,c.daily_capacity) into cap from clinic_settings c join working_schedules w on w.clinic_id=c.clinic_id and w.weekday=5 and w.enabled where c.clinic_id=new.clinic_id;
      if cap is null then raise exception 'Friday schedule is not configured'; end if;
      if (select count(*) from appointments where clinic_id=new.clinic_id and appointment_date=new.appointment_date and id<>new.id and status in ('pending_approval','awaiting_confirmation','confirmed','reschedule_requested'))>=cap then raise exception 'Friday is full'; end if;
    end if;
  end if;
  return new;
end $$;
create trigger friday_booking_guard before insert or update on public.appointments for each row execute function public.guard_friday_booking();

create or replace function public.queue_visit_message(aid uuid, event_kind text, event_key text, due timestamptz default now()) returns void language plpgsql security definer set search_path=public as $$
declare a appointments%rowtype; p patients%rowtype; live boolean; body_text text;
begin
  select * into a from appointments where id=aid;
  select * into p from patients where id=a.patient_id;
  select messaging_enabled and messaging_provider<>'mock' into live from clinic_settings where clinic_id=a.clinic_id;
  body_text:='Hello '||p.full_name||', your dental appointment '||case when event_kind='cancel' then 'on '||a.appointment_date||' has been cancelled.' else 'is scheduled for '||a.appointment_date||case when a.appointment_time is null then '' else ' at '||to_char(a.appointment_time,'HH24:MI') end||'.' end||' Please contact the clinic with any questions.';
  insert into notification_jobs(clinic_id,patient_id,appointment_id,channel,recipient,body,scheduled_for,idempotency_key,kind,simulated)
  values(a.clinic_id,p.id,a.id,'sms',p.phone,body_text,due,event_key,event_kind,not(coalesce(live,false) and p.messaging_consent and p.opted_out_at is null)) on conflict(idempotency_key) do nothing;
end $$;

create or replace function public.visit_changed() returns trigger language plpgsql security definer set search_path=public as $$
declare k text; reminder integer; due timestamptz;
begin
  if TG_OP='UPDATE' and new.status=old.status and new.appointment_date=old.appointment_date then return new; end if;
  k:=case when TG_OP='INSERT' then 'add' when new.status='cancelled' then 'cancel' when new.status='completed' then 'complete' when new.appointment_date<>old.appointment_date then 'reschedule' else 'status' end;
  insert into appointment_status_history(appointment_id,from_status,to_status,changed_by,reason,old_date,new_date) values(new.id,case when TG_OP='UPDATE' then old.status else null end,new.status,auth.uid(),k,case when TG_OP='UPDATE' then old.appointment_date else null end,new.appointment_date);
  insert into audit_logs(clinic_id,actor_id,action,entity_type,entity_id) values(new.clinic_id,auth.uid(),k,'appointment',new.id);
  if k in ('complete','cancel','reschedule') then
    update notification_jobs set status='cancelled' where appointment_id=new.id and status='pending';
    update patient_confirmation_tokens set used_at=now() where appointment_id=new.id and used_at is null;
  end if;
  if new.status='completed' then
    insert into follow_up_recommendations(clinic_id,patient_id,source_appointment_id,interval_weeks,target_date)
    select new.clinic_id,new.patient_id,new.id,p.default_follow_up_weeks,coalesce(new.completed_at::date,new.appointment_date)+p.default_follow_up_weeks*7 from patients p where p.id=new.patient_id
    on conflict(source_appointment_id) do update set target_date=excluded.target_date,interval_weeks=excluded.interval_weeks;
  elsif k='cancel' or new.status in ('awaiting_confirmation','confirmed') then
    perform queue_visit_message(new.id,k,new.id||':'||k||':'||new.updated_at);
    if k in ('add','reschedule') or (TG_OP='UPDATE' and old.status in ('draft','pending_approval')) then
      foreach reminder in array (select reminder_days from clinic_settings where clinic_id=new.clinic_id) loop
        due:=((new.appointment_date-reminder)::text||' 06:00:00+00')::timestamptz;
        if due>now() then perform queue_visit_message(new.id,'reminder',new.id||':reminder:'||new.updated_at||':'||reminder,due); end if;
      end loop;
    end if;
  end if;
  return new;
end $$;
create trigger record_visit_change after insert or update on public.appointments for each row execute function public.visit_changed();

create or replace function public.quick_visit(p_clinic uuid,p_action text,p_id uuid,p_date date default null) returns uuid language plpgsql security definer set search_path=public as $$
declare a appointments%rowtype; result uuid;
begin
  if not is_clinic_member(p_clinic) then raise exception 'Unauthorized'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_clinic::text,0));
  if p_action='add' then
    insert into appointments(clinic_id,patient_id,appointment_date,status,created_by) values(p_clinic,p_id,p_date,'awaiting_confirmation',auth.uid()) returning id into result;
    return result;
  end if;
  select * into a from appointments where id=p_id and clinic_id=p_clinic for update;
  if not found then raise exception 'Appointment not found'; end if;
  if p_action='sms' then
    perform queue_visit_message(a.id,'manual',a.id||':manual:'||a.updated_at);
    update notification_jobs set status='pending',attempt_count=0,scheduled_for=now() where idempotency_key=a.id||':manual:'||a.updated_at and status='failed';
    return a.id;
  end if;
  if a.status not in ('pending_approval','awaiting_confirmation','confirmed','reschedule_requested') then raise exception 'Visit is already closed'; end if;
  if p_action='complete' then update appointments set status='completed',completed_at=now(),updated_at=now() where id=a.id;
  elsif p_action='cancel' then update appointments set status='cancelled',cancelled_at=now(),updated_at=now() where id=a.id;
  elsif p_action='reschedule' then update appointments set appointment_date=p_date,appointment_time=null,status='awaiting_confirmation',updated_at=now() where id=a.id;
  else raise exception 'Invalid action'; end if;
  return a.id;
end $$;
revoke all on function public.queue_visit_message(uuid,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.quick_visit(uuid,text,uuid,date) from public,anon;
grant execute on function public.quick_visit(uuid,text,uuid,date) to authenticated;

-- Keep the original booking API functional; the trigger now owns capacity checks.
create or replace function public.book_appointment(p_clinic uuid,p_patient uuid,p_date date,p_time time,p_type uuid,p_status public.appointment_status default 'awaiting_confirmation') returns uuid language plpgsql security definer set search_path=public as $$
declare result uuid;
begin
  if not is_clinic_member(p_clinic) then raise exception 'Unauthorized'; end if;
  insert into appointments(clinic_id,patient_id,appointment_date,appointment_time,appointment_type_id,status,created_by)
  values(p_clinic,p_patient,p_date,p_time,p_type,p_status,auth.uid()) returning id into result;
  return result;
end $$;

create or replace function public.claim_notification_jobs(p_limit int default 25) returns setof public.notification_jobs language plpgsql security definer set search_path=public as $$
begin
  return query with claimed as (
    select j.id from notification_jobs j left join appointments a on a.id=j.appointment_id
    where j.status='pending' and j.scheduled_for<=now() and j.attempt_count<j.max_attempts
      and (j.kind='cancel' or a.id is null or a.status in ('awaiting_confirmation','confirmed','reschedule_requested'))
    order by j.scheduled_for for update of j skip locked limit greatest(1,least(p_limit,100))
  ) update notification_jobs j set status='processing',attempt_count=attempt_count+1 from claimed where j.id=claimed.id returning j.*;
end $$;
