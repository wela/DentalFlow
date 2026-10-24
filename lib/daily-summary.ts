import { format, parseISO } from 'date-fns';
import { HttpSmsProvider } from './notifications';
import type { createServiceClient } from './supabase/server';

const open=['pending_approval','awaiting_confirmation','confirmed','reschedule_requested'];
const plural=(n:number,word:string)=>`${n} ${word}${n===1?'':'s'}`;

export function dailySummaryText({date,booked,capacity,missed}:{date:string;booked:number;capacity:number;missed:number}){
  return `DentaFlow: Good morning. Today, ${format(parseISO(date),'EEEE d MMMM')}: ${plural(booked,'patient')} booked, ${plural(Math.max(0,capacity-booked),'free slot')}.${missed?` ${plural(missed,'patient')} from earlier Fridays still ${missed===1?'needs':'need'} a new date.`:''}`;
}

// Friday 06:00 (the daily cron): text each clinic's contact number a summary of the day. Live SMS only.
export async function sendDailySummaries(db:ReturnType<typeof createServiceClient>,now=new Date()){
  const today=now.toISOString().slice(0,10);
  if(now.getUTCDay()!==5||process.env.NEXT_PUBLIC_DEMO_MODE!=='false'||process.env.MESSAGING_LIVE_ENABLED!=='true'||process.env.MESSAGING_PROVIDER!=='http'||!process.env.SMS_API_URL||!process.env.SMS_API_KEY)return 0;
  const {data:clinics}=await db.from('clinic_settings').select('clinic_id,contact_number,daily_capacity,clinics!inner(kind)').eq('clinics.kind','ug').eq('messaging_enabled',true).eq('messaging_provider','http').not('contact_number','is',null);
  const provider=new HttpSmsProvider(process.env.SMS_API_URL,process.env.SMS_API_KEY,process.env.SMS_SENDER_ID||'DentaFlow');
  let sent=0;
  for(const clinic of clinics||[]){
    if(!clinic.contact_number)continue;
    const [{count:booked},{count:missed}]=await Promise.all([
      db.from('appointments').select('id',{count:'exact',head:true}).eq('clinic_id',clinic.clinic_id).eq('is_test',false).eq('appointment_date',today).in('status',open),
      db.from('appointments').select('id',{count:'exact',head:true}).eq('clinic_id',clinic.clinic_id).eq('is_test',false).lt('appointment_date',today).in('status',open)
    ]);
    const result=await provider.send({to:clinic.contact_number,body:dailySummaryText({date:today,booked:booked||0,capacity:clinic.daily_capacity,missed:missed||0}),idempotencyKey:`summary:${clinic.clinic_id}:${today}`});
    if(result.status!=='failed')sent++;
  }
  return sent;
}
