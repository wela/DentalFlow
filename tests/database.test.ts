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
