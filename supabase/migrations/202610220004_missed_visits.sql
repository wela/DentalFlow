-- A visit that was never closed on its Friday and is then moved records a no-show before the reschedule.
create or replace function public.record_missed_visit() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if old.appointment_date<(now() at time zone 'Africa/Accra')::date and new.appointment_date is distinct from old.appointment_date
     and old.status in ('pending_approval','awaiting_confirmation','confirmed','reschedule_requested') then
    insert into appointment_status_history(appointment_id,from_status,to_status,changed_by,reason,old_date,new_date)
    values(old.id,old.status,old.status,auth.uid(),'no show',old.appointment_date,old.appointment_date);
  end if;
  return new;
end $$;
drop trigger if exists appointments_record_missed_visit on public.appointments;
create trigger appointments_record_missed_visit before update of appointment_date on public.appointments for each row execute function public.record_missed_visit();

-- "Not now": after a completion, or instead of rescheduling. The slot is released (a missed or same-day visit becomes a
-- no-show without an SMS; an upcoming one is cancelled and the patient told), and the patient stays on the
-- Overview until their next visit is booked.
create or replace function public.defer_follow_up(p_clinic uuid,p_id uuid) returns uuid language plpgsql security definer set search_path=public as $$
declare a appointments%rowtype;
begin
  if not is_clinic_member(p_clinic) then raise exception 'Unauthorized'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_clinic::text,0));
  select * into a from appointments where id=p_id and clinic_id=p_clinic for update;
  if not found then raise exception 'Appointment not found'; end if;
  if a.status in ('pending_approval','awaiting_confirmation','confirmed','reschedule_requested') then
    if a.appointment_date<=(now() at time zone 'Africa/Accra')::date then
      update appointments set status='no_show',updated_at=now() where id=a.id;
      update appointment_status_history set reason='no show' where appointment_id=a.id and to_status='no_show' and created_at=now();
      update notification_jobs set status='cancelled' where appointment_id=a.id and status='pending';
    else
      update appointments set status='cancelled',updated_at=now() where id=a.id;
    end if;
  elsif a.status<>'completed' then raise exception 'This visit is already closed';
  end if;
  insert into appointment_status_history(appointment_id,from_status,to_status,changed_by,reason,new_date,created_at)
  select a.id,status,status,auth.uid(),'next visit not booked',a.appointment_date,clock_timestamp() from appointments where id=a.id;
  return a.id;
end $$;
revoke all on function public.defer_follow_up(uuid,uuid) from public,anon;
grant execute on function public.defer_follow_up(uuid,uuid) to authenticated;

-- SMS show dates as patients read them: "Friday 30 October" instead of 2026-10-30.
create or replace function public.queue_visit_message(aid uuid, event_kind text, event_key text, due timestamptz default now()) returns void language plpgsql security definer set search_path=public as $$
declare a appointments%rowtype; p patients%rowtype; live boolean; body_text text;
begin
  select * into a from appointments where id=aid;
  select * into p from patients where id=a.patient_id;
  select messaging_enabled and messaging_provider<>'mock' into live from clinic_settings where clinic_id=a.clinic_id;
  body_text:='Hello '||p.full_name||', your dental appointment '||case when event_kind='cancel' then 'on '||to_char(a.appointment_date,'FMDay FMDD FMMonth')||' has been cancelled.' else 'is on '||to_char(a.appointment_date,'FMDay FMDD FMMonth')||case when a.appointment_time is null then '' else ' at '||to_char(a.appointment_time,'HH24:MI') end||'.' end||' Please contact the clinic with any questions.';
  insert into notification_jobs(clinic_id,patient_id,appointment_id,channel,recipient,body,scheduled_for,idempotency_key,kind,simulated)
  values(a.clinic_id,p.id,a.id,'sms',p.phone,body_text,due,event_key,event_kind,not(coalesce(live,false) and p.messaging_consent and p.opted_out_at is null)) on conflict(idempotency_key) do nothing;
end $$;
