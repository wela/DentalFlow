import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticatedClinic } from '@/lib/auth';
import { patientSchema } from '@/lib/validation';
import { dispatchVisit } from '@/lib/delivery';
import { googleBusy,hasBusyConflict,syncAppointment } from '@/lib/google-calendar';
export const maxDuration=60;
export async function GET(){
  const ctx=await authenticatedClinic();if(!ctx)return NextResponse.json({error:'Unauthorized'},{status:401});
  const db=ctx.supabase,cid=ctx.clinicId;
  const results=await Promise.all([db.from('patients').select('*').eq('clinic_id',cid),db.from('appointments').select('*').eq('clinic_id',cid),db.from('notification_jobs').select('*').eq('clinic_id',cid).order('created_at',{ascending:false}).limit(500),db.from('appointment_status_history').select('*,appointments!inner(patient_id,clinic_id)').eq('appointments.clinic_id',cid).order('created_at',{ascending:false}),db.from('clinic_settings').select('*').eq('clinic_id',cid).single(),db.from('blocked_dates').select('blocked_date').eq('clinic_id',cid)]);
  if(results.some(r=>r.error))return NextResponse.json({error:'Unable to load clinic. Check that database migrations and clinic settings are configured.'},{status:503});
  const [p,a,m,h,c,b]=results;
  const {data:clinic}=await db.from('clinics').select('name').eq('id',cid).single();
  return NextResponse.json({patients:(p.data||[]).map(p=>({id:p.id,name:p.full_name,phone:p.phone,email:p.email||'',channel:p.preferred_channel,consent:p.messaging_consent,intervalWeeks:p.default_follow_up_weeks,status:p.status,registeredAt:p.created_at,notes:p.administrative_notes})),appointments:(a.data||[]).map(a=>({id:a.id,patientId:a.patient_id,date:a.appointment_date,time:a.appointment_time,status:a.status,type:'Visit',completedAt:a.completed_at,arrivedAt:a.arrived_at,previousStatus:a.completion_previous_status,duration:a.duration_minutes,clinicId:a.clinic_id,syncStatus:a.sync_status,syncError:a.sync_error})),messages:(m.data||[]).map(m=>({id:m.id,patientId:m.patient_id,appointmentId:m.appointment_id,body:m.body,status:m.status,simulated:m.simulated,scheduledFor:m.scheduled_for,error:m.last_error,kind:m.kind})),history:(h.data||[]).map(h=>({id:h.id,appointmentId:h.appointment_id,patientId:h.appointments.patient_id,date:(h.reason==='reschedule'?h.new_date:h.old_date||h.new_date)||'',action:h.reason||h.to_status,at:h.created_at,oldTime:h.old_time,newTime:h.new_time})),settings:{clinicName:clinic?.name||'DentaFlow',contactNumber:c.data.contact_number||'',capacity:c.data.daily_capacity,reminderDays:c.data.reminder_days,blocked:(b.data||[]).map(b=>b.blocked_date),provider:c.data.messaging_provider,messagingEnabled:c.data.messaging_enabled},capacity:c.data.daily_capacity,blocked:(b.data||[]).map(b=>b.blocked_date)});
}
export async function POST(request:Request){
  const ctx=await authenticatedClinic();if(!ctx)return NextResponse.json({error:'Unauthorized'},{status:401});
  const input=await request.json().catch(()=>null);
  if(input?.action==='patient'){
    const parsed=patientSchema.safeParse(input.patient);if(!parsed.success)return NextResponse.json({error:parsed.error.issues[0].message},{status:400});
    const p=parsed.data,row={clinic_id:ctx.clinicId,full_name:p.name,phone:p.phone,email:p.email||null,preferred_channel:p.channel,messaging_consent:p.consent,default_follow_up_weeks:p.intervalWeeks};
    const result=input.id?await ctx.supabase.from('patients').update(row).eq('id',input.id).eq('clinic_id',ctx.clinicId).select('id').single():await ctx.supabase.from('patients').insert(row).select('id').single();
    if(result.error)return NextResponse.json({error:result.error.message},{status:409});return NextResponse.json({ok:true,id:result.data.id});
  }
  const parsed=z.object({action:z.enum(['add','complete','cancel','reschedule','sms','arrive','undo','retry','defer','sync']),id:z.string().uuid(),date:z.string().date().optional(),time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),duration:z.number().int().min(30).max(60).optional(),allowUnavailable:z.boolean().optional()}).safeParse(input);
  if(!parsed.success)return NextResponse.json({error:'Invalid appointment action'},{status:400});
  const {action,id,date,time,duration}=parsed.data;
  if(action==='sync'){const {data:a}=await ctx.supabase.from('appointments').select('id').eq('id',id).eq('clinic_id',ctx.clinicId).single();if(!a)return NextResponse.json({error:'Appointment not found'},{status:404});return NextResponse.json({ok:true,sync:await syncAppointment(ctx.clinicId,id)});}
  if(['add','reschedule'].includes(action)&&!date)return NextResponse.json({error:'Choose a date'},{status:400});
  let unavailable=false;
  if(['add','reschedule'].includes(action)&&time&&duration){
   try{const busy=await googleBusy(ctx.clinicId,date!,action==='reschedule'?id:undefined);if(hasBusyConflict(busy.busy,date!,time,duration))return NextResponse.json({error:'Google Calendar has a conflicting event. Choose another time.'},{status:409});}
   catch{if(!parsed.data.allowUnavailable)return NextResponse.json({error:'Google availability is unavailable. Review your Google calendar, then explicitly save with synchronization pending.',googleUnavailable:true},{status:503});unavailable=true;}
  }
  if(action==='defer'){const {data,error}=await ctx.supabase.rpc('defer_follow_up',{p_clinic:ctx.clinicId,p_id:id});if(error)return NextResponse.json({error:error.message},{status:409});try{await dispatchVisit(ctx.clinicId,data);}catch{/* A cancellation notice stays queued for the next delivery run. */}return NextResponse.json({ok:true});}
  const {data,error}=await ctx.supabase.rpc('multi_clinic_visit',{p_clinic:ctx.clinicId,p_action:action,p_id:id,p_date:date||null,p_time:time||null,p_duration:duration||null});
  if(error)return NextResponse.json({error:error.message},{status:409});
  const sync=unavailable?'pending':await syncAppointment(ctx.clinicId,data);
  try{await dispatchVisit(ctx.clinicId,data);}catch{return NextResponse.json({ok:true,sync,notice:'Appointment saved. Message queued for the next delivery run.'});}
  return NextResponse.json({ok:true,sync,notice:sync==='synced'?'Appointment saved and Google Calendar synchronized.':'Appointment saved. Google Calendar: '+sync+'.'});
}
