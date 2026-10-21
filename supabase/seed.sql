-- Run after creating an authenticated user. Replace the UUID below with auth.users.id.
-- Demo records intentionally use fictional people and messaging remains disabled.
do $$ declare c uuid:=gen_random_uuid(); begin
  insert into clinics(id,name) values(c,'DentaFlow Demo Clinic');
  insert into clinic_settings(clinic_id,messaging_enabled,messaging_provider) values(c,false,'mock');
  insert into working_schedules(clinic_id,weekday,enabled) values(c,5,true);
  insert into appointment_types(clinic_id,name,duration_minutes) values(c,'Follow-up',30),(c,'Consultation',30),(c,'Review',30);
  insert into patients(clinic_id,full_name,phone,messaging_consent) values(c,'Ama Mensah','+233244123456',true),(c,'Kwame Asante','+233205887421',true),(c,'Efua Owusu','+233501229876',true);
end $$;
