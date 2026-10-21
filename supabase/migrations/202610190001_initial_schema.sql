create extension if not exists pgcrypto;

create type public.member_role as enum ('admin','dentist','receptionist');
create type public.appointment_status as enum ('draft','pending_approval','awaiting_confirmation','confirmed','reschedule_requested','cancelled','completed','no_show');
create type public.notification_status as enum ('pending','processing','sent','delivered','failed','cancelled');

create table public.clinics (id uuid primary key default gen_random_uuid(), name text not null, timezone text not null default 'Africa/Accra', created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.user_profiles (id uuid primary key references auth.users(id) on delete cascade, full_name text not null, created_at timestamptz not null default now());
create table public.clinic_memberships (clinic_id uuid references public.clinics(id) on delete cascade, user_id uuid references public.user_profiles(id) on delete cascade, role public.member_role not null, created_at timestamptz not null default now(), primary key(clinic_id,user_id));
create table public.clinic_settings (clinic_id uuid primary key references public.clinics(id) on delete cascade, contact_number text, daily_capacity int not null default 8 check(daily_capacity>0 and daily_capacity<=100), default_follow_up_weeks int not null default 4 check(default_follow_up_weeks between 1 and 52), appointment_duration_minutes int check(appointment_duration_minutes>0), available_times time[], reminder_days int[] not null default '{7,2,1}', messaging_enabled boolean not null default false, messaging_provider text not null default 'mock', sms_price numeric(10,4) not null default 0, updated_at timestamptz not null default now());
create table public.working_schedules (id uuid primary key default gen_random_uuid(), clinic_id uuid not null references public.clinics(id) on delete cascade, weekday smallint not null check(weekday between 0 and 6), enabled boolean not null default true, capacity_override int check(capacity_override>0), unique(clinic_id,weekday));
create table public.blocked_dates (id uuid primary key default gen_random_uuid(), clinic_id uuid not null references public.clinics(id) on delete cascade, blocked_date date not null, reason text, unique(clinic_id,blocked_date));
create table public.patients (id uuid primary key default gen_random_uuid(), clinic_id uuid not null references public.clinics(id) on delete cascade, full_name text not null, phone text not null check(phone ~ '^\+[1-9][0-9]{7,14}$'), email text, preferred_channel text not null default 'sms' check(preferred_channel in ('sms','whatsapp','email')), messaging_consent boolean not null default false, opted_out_at timestamptz, default_follow_up_weeks int not null default 4 check(default_follow_up_weeks between 1 and 52), status text not null default 'active' check(status in ('active','inactive')), administrative_notes text, follow_up_not_required boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(clinic_id,phone));
create table public.appointment_types (id uuid primary key default gen_random_uuid(), clinic_id uuid not null references public.clinics(id) on delete cascade, name text not null, duration_minutes int, active boolean not null default true, unique(clinic_id,name));
create table public.appointments (id uuid primary key default gen_random_uuid(), clinic_id uuid not null references public.clinics(id) on delete cascade, patient_id uuid not null references public.patients(id) on delete restrict, appointment_type_id uuid references public.appointment_types(id), appointment_date date not null, appointment_time time, duration_minutes int, status public.appointment_status not null default 'draft', follow_up_weeks int, visit_key text, created_by uuid references auth.users(id), approved_by uuid references auth.users(id), completed_at timestamptz, cancelled_at timestamptz, cancellation_reason text, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create unique index appointments_no_duplicate_active on public.appointments(clinic_id,patient_id,coalesce(visit_key,appointment_date::text)) where status in ('pending_approval','awaiting_confirmation','confirmed','reschedule_requested');
create index appointments_clinic_date on public.appointments(clinic_id,appointment_date);
create table public.appointment_status_history (id uuid primary key default gen_random_uuid(), appointment_id uuid not null references public.appointments(id) on delete cascade, from_status public.appointment_status, to_status public.appointment_status not null, changed_by uuid references auth.users(id), reason text, created_at timestamptz not null default now());
create table public.follow_up_recommendations (id uuid primary key default gen_random_uuid(), clinic_id uuid not null references public.clinics(id) on delete cascade, patient_id uuid not null references public.patients(id) on delete cascade, source_appointment_id uuid not null references public.appointments(id) on delete cascade, interval_weeks int not null, target_date date not null, window_start date, window_end date, status text not null default 'pending' check(status in ('pending','scheduled','not_required','expired')), reviewed_by uuid references auth.users(id), created_at timestamptz not null default now(), unique(source_appointment_id));
create table public.notification_templates (id uuid primary key default gen_random_uuid(), clinic_id uuid not null references public.clinics(id) on delete cascade, kind text not null, channel text not null, body text not null, enabled boolean not null default true, unique(clinic_id,kind,channel));
create table public.notification_jobs (id uuid primary key default gen_random_uuid(), clinic_id uuid not null references public.clinics(id) on delete cascade, patient_id uuid not null references public.patients(id) on delete cascade, appointment_id uuid references public.appointments(id) on delete cascade, template_id uuid references public.notification_templates(id), channel text not null, recipient text not null, body text not null, scheduled_for timestamptz not null, status public.notification_status not null default 'pending', idempotency_key text not null unique, attempt_count int not null default 0, max_attempts int not null default 3, last_error text, created_at timestamptz not null default now());
create index notification_jobs_due on public.notification_jobs(scheduled_for) where status='pending';
create table public.notification_attempts (id uuid primary key default gen_random_uuid(), job_id uuid not null references public.notification_jobs(id) on delete cascade, provider text not null, provider_message_id text, status public.notification_status not null, response jsonb, attempted_at timestamptz not null default now());
create table public.patient_confirmation_tokens (id uuid primary key default gen_random_uuid(), appointment_id uuid not null references public.appointments(id) on delete cascade, token_hash text not null unique, purpose text not null check(purpose in ('confirm','manage')), expires_at timestamptz not null, used_at timestamptz, created_at timestamptz not null default now());
create table public.audit_logs (id bigint generated always as identity primary key, clinic_id uuid not null references public.clinics(id) on delete cascade, actor_id uuid references auth.users(id), action text not null, entity_type text not null, entity_id uuid, metadata jsonb not null default '{}', created_at timestamptz not null default now());

create or replace function public.is_clinic_member(cid uuid) returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from clinic_memberships where clinic_id=cid and user_id=auth.uid()) $$;
create or replace function public.has_clinic_role(cid uuid, allowed public.member_role[]) returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from clinic_memberships where clinic_id=cid and user_id=auth.uid() and role=any(allowed)) $$;

alter table public.clinics enable row level security; alter table public.user_profiles enable row level security; alter table public.clinic_memberships enable row level security; alter table public.clinic_settings enable row level security; alter table public.working_schedules enable row level security; alter table public.blocked_dates enable row level security; alter table public.patients enable row level security; alter table public.appointment_types enable row level security; alter table public.appointments enable row level security; alter table public.appointment_status_history enable row level security; alter table public.follow_up_recommendations enable row level security; alter table public.notification_templates enable row level security; alter table public.notification_jobs enable row level security; alter table public.notification_attempts enable row level security; alter table public.patient_confirmation_tokens enable row level security; alter table public.audit_logs enable row level security;

create policy clinics_member_read on public.clinics for select using(public.is_clinic_member(id));
create policy profiles_self_read on public.user_profiles for select using(id=auth.uid());
create policy memberships_member_read on public.clinic_memberships for select using(public.is_clinic_member(clinic_id));
create policy settings_member_read on public.clinic_settings for select using(public.is_clinic_member(clinic_id));
create policy settings_admin_write on public.clinic_settings for all using(public.has_clinic_role(clinic_id,array['admin','dentist']::public.member_role[])) with check(public.has_clinic_role(clinic_id,array['admin','dentist']::public.member_role[]));
create policy schedules_member_all on public.working_schedules for all using(public.is_clinic_member(clinic_id)) with check(public.has_clinic_role(clinic_id,array['admin','dentist']::public.member_role[]));
create policy blocked_member_all on public.blocked_dates for all using(public.is_clinic_member(clinic_id)) with check(public.has_clinic_role(clinic_id,array['admin','dentist']::public.member_role[]));
create policy patients_member_all on public.patients for all using(public.is_clinic_member(clinic_id)) with check(public.is_clinic_member(clinic_id));
create policy types_member_all on public.appointment_types for all using(public.is_clinic_member(clinic_id)) with check(public.is_clinic_member(clinic_id));
create policy appointments_member_all on public.appointments for all using(public.is_clinic_member(clinic_id)) with check(public.is_clinic_member(clinic_id));
create policy appointment_history_member_read on public.appointment_status_history for select using(exists(select 1 from public.appointments a where a.id=appointment_id and public.is_clinic_member(a.clinic_id)));
create policy followups_member_all on public.follow_up_recommendations for all using(public.is_clinic_member(clinic_id)) with check(public.is_clinic_member(clinic_id));
create policy templates_member_all on public.notification_templates for all using(public.is_clinic_member(clinic_id)) with check(public.has_clinic_role(clinic_id,array['admin','dentist']::public.member_role[]));
create policy jobs_member_read on public.notification_jobs for select using(public.is_clinic_member(clinic_id));
create policy attempts_member_read on public.notification_attempts for select using(exists(select 1 from public.notification_jobs j where j.id=job_id and public.is_clinic_member(j.clinic_id)));
create policy tokens_member_read on public.patient_confirmation_tokens for select using(exists(select 1 from public.appointments a where a.id=appointment_id and public.is_clinic_member(a.clinic_id)));
create policy audit_member_read on public.audit_logs for select using(public.has_clinic_role(clinic_id,array['admin','dentist']::public.member_role[]));

create or replace function public.book_appointment(p_clinic uuid,p_patient uuid,p_date date,p_time time,p_type uuid,p_status public.appointment_status default 'awaiting_confirmation') returns uuid language plpgsql security definer set search_path=public as $$
declare cap int; used int; new_id uuid; weekday int;
begin
  if not public.is_clinic_member(p_clinic) then raise exception 'unauthorized'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_clinic::text||p_date::text,0));
  weekday:=extract(dow from p_date);
  if not exists(select 1 from working_schedules where clinic_id=p_clinic and working_schedules.weekday=weekday and enabled) then raise exception 'clinic is not open on this date'; end if;
  if exists(select 1 from blocked_dates where clinic_id=p_clinic and blocked_date=p_date) then raise exception 'date is blocked'; end if;
  select coalesce(ws.capacity_override,cs.daily_capacity) into cap from clinic_settings cs join working_schedules ws on ws.clinic_id=cs.clinic_id and ws.weekday=weekday where cs.clinic_id=p_clinic;
  select count(*) into used from appointments where clinic_id=p_clinic and appointment_date=p_date and status in ('pending_approval','awaiting_confirmation','confirmed','reschedule_requested');
  if used>=cap then raise exception 'daily capacity reached'; end if;
  insert into appointments(clinic_id,patient_id,appointment_date,appointment_time,appointment_type_id,status,created_by) values(p_clinic,p_patient,p_date,p_time,p_type,p_status,auth.uid()) returning id into new_id;
  insert into audit_logs(clinic_id,actor_id,action,entity_type,entity_id) values(p_clinic,auth.uid(),'appointment.created','appointment',new_id);
  return new_id;
end $$;

create or replace function public.respond_to_appointment(p_token_hash text,p_status public.appointment_status) returns void language plpgsql security definer set search_path=public as $$
declare token_row public.patient_confirmation_tokens%rowtype; old_status public.appointment_status; clinic uuid;
begin
  if p_status not in ('confirmed','reschedule_requested') then raise exception 'invalid response status'; end if;
  select * into token_row from patient_confirmation_tokens where token_hash=p_token_hash and used_at is null and expires_at>now() for update;
  if not found then raise exception 'invalid, expired, or used token'; end if;
  select status,clinic_id into old_status,clinic from appointments where id=token_row.appointment_id for update;
  if old_status not in ('awaiting_confirmation','confirmed') then raise exception 'appointment cannot accept this response'; end if;
  update appointments set status=p_status,updated_at=now() where id=token_row.appointment_id;
  update patient_confirmation_tokens set used_at=now() where id=token_row.id;
  insert into appointment_status_history(appointment_id,from_status,to_status,reason) values(token_row.appointment_id,old_status,p_status,'Patient secure-link response');
  insert into audit_logs(clinic_id,action,entity_type,entity_id,metadata) values(clinic,'appointment.patient_response','appointment',token_row.appointment_id,jsonb_build_object('status',p_status));
end $$;

create or replace function public.claim_notification_jobs(p_limit int default 25) returns setof public.notification_jobs language plpgsql security definer set search_path=public as $$
begin
  return query
  with claimed as (
    select j.id from notification_jobs j
    join patients p on p.id=j.patient_id
    left join appointments a on a.id=j.appointment_id
    join clinic_settings cs on cs.clinic_id=j.clinic_id
    where j.status='pending' and j.scheduled_for<=now() and j.attempt_count<j.max_attempts
      and p.messaging_consent and p.opted_out_at is null and cs.messaging_enabled
      and (a.id is null or a.status not in ('cancelled','completed','no_show'))
    order by j.scheduled_for for update of j skip locked limit greatest(1,least(p_limit,100))
  )
  update notification_jobs j set status='processing',attempt_count=attempt_count+1
  from claimed where j.id=claimed.id returning j.*;
end $$;

revoke all on function public.respond_to_appointment(text,public.appointment_status) from public,anon,authenticated;
revoke all on function public.claim_notification_jobs(int) from public,anon,authenticated;
grant execute on function public.respond_to_appointment(text,public.appointment_status) to service_role;
grant execute on function public.claim_notification_jobs(int) to service_role;
