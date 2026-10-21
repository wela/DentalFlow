import { createServiceClient } from './supabase/server';
import { HttpSmsProvider, MockSmsProvider } from './notifications';
export async function deliverClaimed(job:{id:string;patient_id:string;clinic_id:string;appointment_id:string;kind:string;recipient:string;body:string;idempotency_key:string;simulated:boolean;attempt_count:number;max_attempts:number}) {
  const db=createServiceClient();
  const [{data:p},{data:c},{data:a}]=await Promise.all([db.from('patients').select('messaging_consent,opted_out_at,phone').eq('id',job.patient_id).single(),db.from('clinic_settings').select('messaging_enabled,messaging_provider').eq('clinic_id',job.clinic_id).single(),db.from('appointments').select('status').eq('id',job.appointment_id).maybeSingle()]);
  if(job.kind!=='cancel'&&a&&['cancelled','completed','no_show'].includes(a.status)){await db.from('notification_jobs').update({status:'cancelled'}).eq('id',job.id);return;}
  const live=!job.simulated&&process.env.NEXT_PUBLIC_DEMO_MODE==='false'&&process.env.MESSAGING_LIVE_ENABLED==='true'&&process.env.MESSAGING_PROVIDER==='http'&&c?.messaging_enabled&&c.messaging_provider==='http'&&p?.messaging_consent&&!p.opted_out_at;
  try {
    if(live&&(!process.env.SMS_API_URL||!process.env.SMS_API_KEY))throw new Error('SMS provider is not configured');
    const provider=live?new HttpSmsProvider(process.env.SMS_API_URL!,process.env.SMS_API_KEY!,process.env.SMS_SENDER_ID||'DentaFlow'):new MockSmsProvider();
    const result=await provider.send({to:p?.phone||job.recipient,body:job.body,idempotencyKey:job.idempotency_key});
    const {error}=await db.from('notification_attempts').insert({job_id:job.id,provider:provider.name,provider_message_id:result.providerId,status:result.status,response:{detail:result.detail}});
    if(error)throw error;
    const {error:updateError}=await db.from('notification_jobs').update({status:result.status==='failed'&&job.attempt_count<job.max_attempts?'pending':result.status,simulated:!live,last_error:result.detail||null,scheduled_for:new Date(Date.now()+3600000).toISOString()}).eq('id',job.id);
    if(updateError)throw updateError;
  } catch(e){await db.from('notification_jobs').update({status:job.attempt_count<job.max_attempts?'pending':'failed',scheduled_for:new Date(Date.now()+3600000).toISOString(),last_error:e instanceof Error?e.message:'Delivery failed'}).eq('id',job.id);}
}
export async function dispatchVisit(clinicId:string,appointmentId:string){
  const db=createServiceClient();
  const {data}=await db.from('notification_jobs').select('*').eq('clinic_id',clinicId).eq('appointment_id',appointmentId).eq('status','pending').lte('scheduled_for',new Date().toISOString());
  for(const job of data||[]){const {data:claimed}=await db.from('notification_jobs').update({status:'processing',attempt_count:job.attempt_count+1}).eq('id',job.id).eq('status','pending').select('*').maybeSingle();if(claimed)await deliverClaimed(claimed);}
}
