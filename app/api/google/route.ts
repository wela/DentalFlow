import { NextResponse } from 'next/server';
import { authenticatedClinic } from '@/lib/auth';
import { accessToken,googleRequest,listCalendars } from '@/lib/google-calendar';
import { connection,lifecycle,assertConnectionScope,withGoogleOperation } from '@/lib/google-lifecycle';
import { disconnectGoogle } from '@/lib/google-handover';
import { createServiceClient } from '@/lib/supabase/server';
import { z } from 'zod';
export const maxDuration=60;
async function context(){const ctx=await authenticatedClinic();if(!ctx)return null;const {data:c}=await ctx.supabase.from('clinics').select('*').eq('id',ctx.clinicId).single();return c?{...ctx,clinic:c}:null;}
export async function GET(){
 const ctx=await context();if(!ctx)return NextResponse.json({error:'Unauthorized'},{status:401});
 try{
  const owner=ctx.clinic.doctor_id as string|undefined,c=owner?await connection(owner):null,l=owner?await lifecycle(owner):null,canManage=ctx.user.id===owner;
  let calendars:Awaited<ReturnType<typeof listCalendars>>=[],connectionError='';
  if(c&&canManage){try{await withGoogleOperation(owner!,'status',async()=>{const token=await accessToken(owner!);if(token)calendars=await listCalendars(token);});}catch(e){connectionError=e instanceof Error?e.message:'Google unavailable';}}
  const {data:mapping}=await createServiceClient().from('google_calendar_mappings').select('calendar_id,busy_calendars,account_sub,is_test').eq('clinic_id',ctx.clinicId).maybeSingle();
  return NextResponse.json({connected:!!c,canManage,email:canManage?c?.account_email:null,connectionStatus:!c?'disconnected':!c.account_sub?'legacy identity unverified':connectionError?'needs attention':'connected',connectionError,mode:l?.mode||'production',mapping:mapping?.account_sub===c?.account_sub&&mapping?.is_test===c?.is_test?mapping:null,calendars});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Google unavailable'},{status:503});}
}
export async function POST(request:Request){
 const ctx=await context();if(!ctx||ctx.user.id!==ctx.clinic.doctor_id)return NextResponse.json({error:'Only the workspace owner can manage Google Calendar'},{status:403});
 const body=await request.json().catch(()=>null),db=createServiceClient();
 try{
  if(body?.action==='disconnect'){if(body.confirmation!=='DISCONNECT GOOGLE')throw new Error('Explicit disconnect confirmation is required');return NextResponse.json(await disconnectGoogle(ctx.user.id));}
  return await withGoogleOperation(ctx.user.id,'configure',async()=>{
   const account=await connection(ctx.user.id),l=await lifecycle(ctx.user.id);if(!account)throw new Error('Connect Google Calendar first');assertConnectionScope(account,l,l.mode==='test',false);
   const token=await accessToken(ctx.user.id);if(!token)throw new Error('Connect Google Calendar first');
   if(body?.action==='create'){
    const attemptId=crypto.randomUUID(),session=l.mode==='test'?l.test_session:null;
    const tracked=await db.from('google_created_calendars').insert({id:attemptId,user_id:ctx.user.id,clinic_id:ctx.clinicId,account_sub:account.account_sub,test_session:session});if(tracked.error)throw new Error('Could not track calendar creation; no calendar created');
    try{
     const calendar=await googleRequest<{id:string}>(token,'calendars','POST',{summary:(session?'DentaFlow TEST — ':'')+ctx.clinic.name,timeZone:'Africa/Accra',description:'Created by DentaFlow. Creation reference: '+attemptId+(session?'. Test session: '+session:'')});
     const saved=await db.from('google_created_calendars').update({calendar_id:calendar.id,status:'created'}).eq('id',attemptId);if(saved.error)throw new Error('Google calendar created but tracking could not be confirmed. Inspect Google before retrying. Calendar ID: '+calendar.id);
     try{await googleRequest(token,`users/me/calendarList/${encodeURIComponent(calendar.id)}?colorRgbFormat=true`,'PATCH',{backgroundColor:ctx.clinic.color,foregroundColor:'#ffffff'});}catch{/* Cosmetic only; never recreate on a color failure. */}
     return NextResponse.json({ok:true,calendarId:calendar.id,notice:'Calendar created and tracked. Select it to save the mapping. Test cleanup never deletes calendars.'});
    }catch(e){await db.from('google_created_calendars').update({status:'uncertain'}).eq('id',attemptId);throw e;}
   }
   const parsed=z.object({calendarId:z.string().min(1).max(1024),busyCalendars:z.array(z.string().max(1024)).max(20)}).safeParse(body);if(!parsed.success)throw new Error('Choose a calendar');
   const calendars=await listCalendars(token);if(!calendars.some(c=>c.id===parsed.data.calendarId&&['owner','writer'].includes(c.accessRole)))throw new Error('Choose a calendar you can edit');
   if(parsed.data.busyCalendars.some(id=>!calendars.some(c=>c.id===id&&['owner','writer','reader'].includes(c.accessRole))))throw new Error('Busy calendars require event-read access');
   const {data:old}=await db.from('google_calendar_mappings').select('calendar_id,account_sub').eq('clinic_id',ctx.clinicId).maybeSingle();
   if(old&&old.account_sub===account.account_sub&&old.calendar_id!==parsed.data.calendarId){const {count,error}=await db.from('google_event_refs').select('appointment_id,appointments!inner(clinic_id)',{count:'exact',head:true}).eq('account_sub',account.account_sub).eq('appointments.clinic_id',ctx.clinicId);if(error||count)throw new Error('This account has linked events. Keep their mapping or clear test data first.');}
   const {error}=await db.from('google_calendar_mappings').upsert({clinic_id:ctx.clinicId,user_id:ctx.user.id,account_sub:account.account_sub,is_test:l.mode==='test',calendar_id:parsed.data.calendarId,busy_calendars:parsed.data.busyCalendars});if(error)throw new Error('Could not save calendar mapping');return NextResponse.json({ok:true});
  });
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Google unavailable'},{status:409});}
}
