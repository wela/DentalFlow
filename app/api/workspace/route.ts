import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticatedClinic } from '@/lib/auth';
import { patientSchema } from '@/lib/validation';
import { dispatchVisit } from '@/lib/delivery';
export async function GET(){
  const ctx=await authenticatedClinic();if(!ctx)return NextResponse.json({error:'Unauthorized'},{status:401});
  const db=ctx.supabase,cid=ctx.clinicId;
  const results=await Promise.all([db.from('patients').select('*').eq('clinic_id',cid),db.from('appointments').select('*').eq('clinic_id',cid),db.from('notification_jobs').select('*').eq('clinic_id',cid).order('created_at',{ascending:false}).limit(500),db.from('appointment_status_history').select('*,appointments!inner(patient_id,clinic_id)').eq('appointments.clinic_id',cid).order('created_at',{ascending:false}),db.from('clinic_settings').select('*').eq('clinic_id',cid).single(),db.from('blocked_dates').select('blocked_date').eq('clinic_id',cid)]);
  if(results.some(r=>r.error))return NextResponse.json({error:'Unable to load clinic. Check that database migrations and clinic settings are configured.'},{status:503});
  const [p,a,m,h,c,b]=results;
  const {data:clinic}=await db.from('clinics').select('name').eq('id',cid).single();
  return NextResponse.json({patients:(p.data||[]).map(p=>({id:p.id,name:p.full_name,phone:p.phone,email:p.email||'',channel:p.preferred_channel,consent:p.messaging_consent,intervalWeeks:p.default_follow_up_weeks,status:p.status,registeredAt:p.created_at,notes:p.administrative_notes})),appointments:(a.data||[]).map(a=>({id:a.id,patientId:a.patient_id,date:a.appointment_date,time:a.appointment_time,status:a.status,type:'Visit',completedAt:a.completed_at,arrivedAt:a.arrived_at,previousStatus:a.completion_previous_status})),messages:(m.data||[]).map(m=>({id:m.id,patientId:m.patient_id,appointmentId:m.appointment_id,body:m.body,status:m.status,simulated:m.simulated,scheduledFor:m.scheduled_for,error:m.last_error,kind:m.kind})),history:(h.data||[]).map(h=>({id:h.id,appointmentId:h.appointment_id,patientId:h.appointments.patient_id,date:h.old_date||h.new_date||'',action:h.reason||h.to_status,at:h.created_at})),settings:{clinicName:clinic?.name||'DentaFlow',contactNumber:c.data.contact_number||'',capacity:c.data.daily_capacity,reminderDays:c.data.reminder_days,blocked:(b.data||[]).map(b=>b.blocked_date),provider:c.data.messaging_provider,messagingEnabled:c.data.messaging_enabled},capacity:c.data.daily_capacity,blocked:(b.data||[]).map(b=>b.blocked_date)});
}
export async function POST(request:Request){
  const ctx=await authenticatedClinic();if(!ctx)return NextResponse.json({error:'Unauthorized'},{status:401});
  const input=await request.json().catch(()=>null);
  if(input?.action==='patient'){
    const parsed=patientSchema.safeParse(input.patient);if(!parsed.success)return NextResponse.json({error:parsed.error.issues[0].message},{status:400});
    const p=parsed.data,row={clinic_id:ctx.clinicId,full_name:p.name,phone:p.phone,email:p.email||null,preferred_channel:p.channel,messaging_consent:p.consent,default_follow_up_weeks:p.intervalWeeks};
    const result=input.id?await ctx.supabase.from('patients').update(row).eq('id',input.id).eq('clinic_id',ctx.clinicId):await ctx.supabase.from('patients').insert(row);
    if(result.error)return NextResponse.json({error:result.error.message},{status:409});return NextResponse.json({ok:true});
  }
  const parsed=z.object({action:z.enum(['add','complete','cancel','reschedule','sms','arrive','undo','retry']),id:z.string().uuid(),date:z.string().date().optional()}).safeParse(input);
  if(!parsed.success)return NextResponse.json({error:'Invalid appointment action'},{status:400});
  const {action,id,date}=parsed.data;
  if(['add','reschedule'].includes(action)&&!date)return NextResponse.json({error:'Choose a Friday'},{status:400});
  const {data,error}=await ctx.supabase.rpc('clinic_day_action',{p_clinic:ctx.clinicId,p_action:action,p_id:id,p_date:date||null});
  if(error)return NextResponse.json({error:error.message},{status:409});
  try{await dispatchVisit(ctx.clinicId,data);}catch{return NextResponse.json({ok:true,notice:'Appointment saved. Message queued for the next delivery run.'});}
  return NextResponse.json({ok:true});
}
