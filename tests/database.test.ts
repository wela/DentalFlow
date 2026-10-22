import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll,afterAll,it,expect } from 'vitest';
let db:PGlite;
const cid='00000000-0000-0000-0000-000000000001',uid='00000000-0000-0000-0000-000000000002';
let friday:string;
beforeAll(async()=>{
 db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select '${uid}'::uuid$$;`);
 // PGlite includes gen_random_uuid in core; pgcrypto is not needed by these migrations.
 await db.exec(readFileSync('supabase/migrations/202610190001_initial_schema.sql','utf8').replace('create extension if not exists pgcrypto;',''));
 await db.exec(readFileSync('supabase/migrations/202610210002_friday_workflow.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/202610210003_clinic_day.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/202610220004_missed_visits.sql','utf8'));
 await db.exec(`insert into auth.users values('${uid}');insert into user_profiles values('${uid}','Dentist',now());insert into clinics(id,name) values('${cid}','Test clinic');insert into clinic_memberships values('${cid}','${uid}','dentist',now());insert into clinic_settings(clinic_id,daily_capacity) values('${cid}',1);insert into working_schedules(clinic_id,weekday) values('${cid}',5);`);
 friday=(await db.query<{date_text:string}>("select to_char(d,'YYYY-MM-DD') as date_text from generate_series(current_date+1,current_date+7,interval '1 day') d where extract(dow from d)=5")).rows[0].date_text;
},30000);
afterAll(async()=>{await db?.close()});
it('executes transactional booking, capacity checks, cancellation, rescheduling and history',async()=>{
 const p=(await db.query<{id:string}>(`insert into patients(clinic_id,full_name,phone) values('${cid}','Ama','+233244123456') returning id`)).rows[0].id;
 const p2=(await db.query<{id:string}>(`insert into patients(clinic_id,full_name,phone) values('${cid}','Kojo','+233244123457') returning id`)).rows[0].id;
 const a=(await db.query<{id:string}>('select quick_visit($1,\'add\',$2,$3) id',[cid,p,friday])).rows[0].id;
 await expect(db.query('select quick_visit($1,\'add\',$2,$3)',[cid,p,friday])).rejects.toThrow('active appointment');
 await expect(db.query('select quick_visit($1,\'add\',$2,$3)',[cid,p2,friday])).rejects.toThrow('Friday is full');
 await db.query('select quick_visit($1,\'reschedule\',$2,$3::date+7)',[cid,a,friday]);
 expect((await db.query<{reason:string}>('select reason from appointment_status_history where appointment_id=$1 order by created_at',[a])).rows.map(r=>r.reason)).toContain('reschedule');
 const a2=(await db.query<{id:string}>('select quick_visit($1,\'add\',$2,$3) id',[cid,p2,friday])).rows[0].id;
 await db.query('select quick_visit($1,\'cancel\',$2)',[cid,a2]);
 expect((await db.query<{status:string}>('select status from appointments where id=$1',[a2])).rows[0].status).toBe('cancelled');
 expect((await db.query<{n:number}>("select count(*)::int n from notification_jobs where appointment_id=$1 and kind='reminder' and status='pending'",[a2])).rows[0].n).toBe(0);
 await db.query('select quick_visit($1,\'complete\',$2)',[cid,a]);
 expect((await db.query<{completed_at:string}>('select completed_at from appointments where id=$1',[a])).rows[0].completed_at).toBeTruthy();
 expect((await db.query('select * from follow_up_recommendations where source_appointment_id=$1',[a])).rows).toHaveLength(1);
});
it('claims mock cancellation notices only once',async()=>{
 const first=await db.query<{id:string;simulated:boolean}>("select * from claim_notification_jobs(100)");
 expect(first.rows.length).toBeGreaterThan(0);expect(first.rows.every(r=>r.simulated)).toBe(true);
 const second=await db.query('select * from claim_notification_jobs(100)');expect(second.rows).toHaveLength(0);
});
it('undoes recent completion and preserves history',async()=>{
 const a=(await db.query<{id:string}>("select id from appointments where status='completed' limit 1")).rows[0].id;
 await db.query("select clinic_day_action($1,'undo',$2)",[cid,a]);
 expect((await db.query<{status:string}>('select status from appointments where id=$1',[a])).rows[0].status).toBe('awaiting_confirmation');
 expect((await db.query("select * from appointment_status_history where appointment_id=$1 and reason='completion undone'",[a])).rows).toHaveLength(1);
 await db.query("select clinic_day_action($1,'complete',$2)",[cid,a]);
 await db.query("update appointments set completed_at=now()-interval '6 minutes' where id=$1",[a]);
 await expect(db.query("select clinic_day_action($1,'undo',$2)",[cid,a])).rejects.toThrow('five minutes');
});
it('requires acknowledgement of settings conflicts and restricts receptionist writes',async()=>{
 const p=(await db.query<{id:string}>(`insert into patients(clinic_id,full_name,phone) values('${cid}','Efua','+233244123458') returning id`)).rows[0].id;
 await db.query("select quick_visit($1,'add',$2,$3)",[cid,p,friday]);
 const config={clinicName:'Friday Clinic',contactNumber:'+233244123456',capacity:2,blocked:[friday],reminderDays:[2,1],provider:'mock',messagingEnabled:false};
 await expect(db.query('select save_clinic_settings($1,$2,false)',[cid,JSON.stringify(config)])).rejects.toThrow('acknowledge');
 await db.query('select save_clinic_settings($1,$2,true)',[cid,JSON.stringify(config)]);
 expect((await db.query<{daily_capacity:number}>('select daily_capacity from clinic_settings where clinic_id=$1',[cid])).rows[0].daily_capacity).toBe(2);
 expect((await db.query("select * from appointments where patient_id=$1 and status='awaiting_confirmation'",[p])).rows).toHaveLength(1);
 await db.exec(`update clinic_memberships set role='receptionist' where user_id='${uid}'`);
 await expect(db.query('select save_clinic_settings($1,$2,true)',[cid,JSON.stringify(config)])).rejects.toThrow('administrators');
 await db.exec(`update clinic_memberships set role='dentist' where user_id='${uid}'`);
});
it('recovers interrupted simulations and flags uncertain live delivery',async()=>{
 const a=(await db.query<{id:string}>("select id from appointments where status='awaiting_confirmation' limit 1")).rows[0].id;
 await db.query("select queue_visit_message($1,'manual','recovery-sim')",[a]);await db.query("select queue_visit_message($1,'manual','recovery-live')",[a]);
 await db.exec("update notification_jobs set status='processing',simulated=(idempotency_key='recovery-sim') where idempotency_key in ('recovery-sim','recovery-live');update notification_jobs set claimed_at=now()-interval '11 minutes' where idempotency_key in ('recovery-sim','recovery-live')");
 await db.query('select * from claim_notification_jobs(100)');
 expect((await db.query<{status:string}>("select status from notification_jobs where idempotency_key='recovery-live'")).rows[0].status).toBe('failed');
 expect((await db.query<{status:string}>("select status from notification_jobs where idempotency_key='recovery-sim'")).rows[0].status).toBe('processing');
});
it('records idempotent receipts and never downgrades delivered',async()=>{
 const j=(await db.query<{id:string}>("select id from notification_jobs where idempotency_key='recovery-live'")).rows[0].id;
 await db.query("insert into notification_attempts(job_id,provider,provider_message_id,status) values($1,'http','gateway-1','sent')",[j]);
 await db.query("select record_delivery_receipt('event-1','gateway-1','delivered')");await db.query("select record_delivery_receipt('event-1','gateway-1','delivered')");await db.query("select record_delivery_receipt('event-2','gateway-1','failed')");
 expect((await db.query<{status:string}>('select status from notification_jobs where id=$1',[j])).rows[0].status).toBe('delivered');
 expect((await db.query("select * from notification_receipts where event_id='event-1'")).rows).toHaveLength(1);
});
it('records a no-show when a missed visit is rescheduled',async()=>{
 const p=(await db.query<{id:string}>(`insert into patients(clinic_id,full_name,phone) values('${cid}','Kweku','+233244123459') returning id`)).rows[0].id;
 // Booking guards reject past dates, so seed the missed visit directly.
 await db.exec('alter table appointments disable trigger user');
 const a=(await db.query<{id:string}>(`insert into appointments(clinic_id,patient_id,appointment_date,status) values('${cid}','${p}',$1::date-7,'confirmed') returning id`,[friday])).rows[0].id;
 await db.exec('alter table appointments enable trigger user');
 await db.query("select clinic_day_action($1,'reschedule',$2,$3::date+7)",[cid,a,friday]);
 expect((await db.query<{reason:string}>('select reason from appointment_status_history where appointment_id=$1',[a])).rows.map(r=>r.reason)).toEqual(expect.arrayContaining(['no show','reschedule']));
});
it('records Not now on a completed visit',async()=>{
 const a=(await db.query<{id:string}>("select id from appointments where status='completed' limit 1")).rows[0].id;
 await db.query('select defer_follow_up($1,$2)',[cid,a]);
 expect((await db.query("select * from appointment_status_history where appointment_id=$1 and reason='next visit not booked'",[a])).rows).toHaveLength(1);
});
it('frees the slot with Not now: missed visits become no-shows, upcoming ones are cancelled',async()=>{
 const p=(await db.query<{id:string}>(`insert into patients(clinic_id,full_name,phone) values('${cid}','Esi','+233244123460') returning id`)).rows[0].id;
 await db.exec('alter table appointments disable trigger user');
 const missed=(await db.query<{id:string}>(`insert into appointments(clinic_id,patient_id,appointment_date,status) values('${cid}','${p}',$1::date-14,'confirmed') returning id`,[friday])).rows[0].id;
 await db.exec('alter table appointments enable trigger user');
 await db.query('select defer_follow_up($1,$2)',[cid,missed]);
 expect((await db.query<{status:string}>('select status from appointments where id=$1',[missed])).rows[0].status).toBe('no_show');
 expect((await db.query("select * from notification_jobs where appointment_id=$1 and kind='cancel'",[missed])).rows).toHaveLength(0);
 expect((await db.query<{reason:string}>('select reason from appointment_status_history where appointment_id=$1 order by created_at',[missed])).rows.map(r=>r.reason)).toEqual(['no show','next visit not booked']);
 const upcoming=(await db.query<{id:string}>('select quick_visit($1,\'add\',$2,$3::date+28) id',[cid,p,friday])).rows[0].id;
 await db.query('select defer_follow_up($1,$2)',[cid,upcoming]);
 expect((await db.query<{status:string}>('select status from appointments where id=$1',[upcoming])).rows[0].status).toBe('cancelled');
 expect((await db.query("select * from notification_jobs where appointment_id=$1 and kind='cancel'",[upcoming])).rows).toHaveLength(1);
});
it('writes appointment SMS with dates patients can read',async()=>{
 const body=(await db.query<{body:string}>("select body from notification_jobs where kind='add' order by created_at desc limit 1")).rows[0].body;
 expect(body).toMatch(/is on Friday \d{1,2} [A-Z][a-z]+\./);
});
