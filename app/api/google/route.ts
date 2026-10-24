import { NextResponse } from 'next/server';
import { authenticatedClinic } from '@/lib/auth';
import { accessToken,googleRequest,listCalendars,unseal,type Tokens } from '@/lib/google-calendar';
import { createServiceClient } from '@/lib/supabase/server';
import { z } from 'zod';
export const maxDuration=60;
async function context(){const ctx=await authenticatedClinic();if(!ctx)return null;const {data:c}=await ctx.supabase.from('clinics').select('*').eq('id',ctx.clinicId).single();return c?{...ctx,clinic:c}:null;}
export async function GET(){const ctx=await context();if(!ctx)return NextResponse.json({error:'Unauthorized'},{status:401});try{const token=ctx.clinic.doctor_id?await accessToken(ctx.clinic.doctor_id):null;const {data:mapping}=await createServiceClient().from('google_calendar_mappings').select('calendar_id,busy_calendars').eq('clinic_id',ctx.clinicId).maybeSingle();return NextResponse.json({connected:!!token,canManage:ctx.user.id===ctx.clinic.doctor_id,mapping,calendars:token&&ctx.user.id===ctx.clinic.doctor_id?await listCalendars(token):[]});}catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Google unavailable'},{status:503});}}
export async function POST(request:Request){
 const ctx=await context();if(!ctx||ctx.user.id!==ctx.clinic.doctor_id)return NextResponse.json({error:'Only the workspace doctor can manage Google Calendar'},{status:403});
 const body=await request.json().catch(()=>null),db=createServiceClient();
 try{
  if(body?.action==='disconnect'){
   const {data}=await db.from('google_connections').select('tokens').eq('user_id',ctx.user.id).maybeSingle();if(data){const tokens=unseal<Tokens>(data.tokens);const result=await fetch('https://oauth2.googleapis.com/revoke',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:tokens.refresh_token||tokens.access_token}),signal:AbortSignal.timeout(10000)});if(!result.ok&&result.status!==400)throw new Error('Google revocation failed; retry disconnect');}
   const {error}=await db.from('google_connections').delete().eq('user_id',ctx.user.id);if(error)throw new Error('Could not remove connection');return NextResponse.json({ok:true});
  }
  const token=await accessToken(ctx.user.id);if(!token)throw new Error('Connect Google Calendar first');
  if(body?.action==='create'){
   const calendar=await googleRequest<{id:string}>(token,'calendars','POST',{summary:ctx.clinic.name,timeZone:'Africa/Accra'});
   // Color is cosmetic; a failure must not trigger automatic calendar recreation.
   try{await googleRequest(token,`users/me/calendarList/${encodeURIComponent(calendar.id)}?colorRgbFormat=true`,'PATCH',{backgroundColor:ctx.clinic.color,foregroundColor:'#ffffff'});}catch{/* Google may use its nearest supported palette color. */}
   return NextResponse.json({ok:true,calendarId:calendar.id,notice:'Calendar created. Select it below to save the mapping.'});
  }
  const parsed=z.object({calendarId:z.string().min(1).max(1024),busyCalendars:z.array(z.string().max(1024)).max(20)}).safeParse(body);if(!parsed.success)throw new Error('Choose a calendar');
  const calendars=await listCalendars(token);if(!calendars.some(c=>c.id===parsed.data.calendarId&&['owner','writer'].includes(c.accessRole)))throw new Error('Choose a calendar you can edit');
  if(parsed.data.busyCalendars.some(id=>!calendars.some(c=>c.id===id&&['owner','writer','reader'].includes(c.accessRole))))throw new Error('Busy calendars require event-read access');
  const {data:old}=await db.from('google_calendar_mappings').select('calendar_id').eq('clinic_id',ctx.clinicId).maybeSingle();
  if(old&&old.calendar_id!==parsed.data.calendarId){const {count}=await db.from('google_event_refs').select('appointment_id,appointments!inner(clinic_id)',{count:'exact',head:true}).eq('appointments.clinic_id',ctx.clinicId);if(count)throw new Error('This clinic already has linked events. Keep its mapping to avoid orphaned or duplicate events.');}
  const {error}=await db.from('google_calendar_mappings').upsert({clinic_id:ctx.clinicId,user_id:ctx.user.id,calendar_id:parsed.data.calendarId,busy_calendars:parsed.data.busyCalendars});if(error)throw new Error('Could not save calendar mapping');return NextResponse.json({ok:true});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Google unavailable'},{status:409});}
}
