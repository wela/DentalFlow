import { NextResponse } from 'next/server';
import { authenticatedClinic } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { googleBusy,hasBusyConflict } from '@/lib/google-calendar';
import { timeSlots,type Clinic } from '@/lib/clinics';
import { z } from 'zod';
export const maxDuration=60;
export async function GET(request:Request){
 const ctx=await authenticatedClinic();if(!ctx)return NextResponse.json({error:'Unauthorized'},{status:401});
 const query=Object.fromEntries(new URL(request.url).searchParams),parsed=z.object({date:z.string().date(),duration:z.coerce.number().int().min(30).max(60),exclude:z.string().uuid().optional()}).safeParse(query);if(!parsed.success)return NextResponse.json({error:'Invalid date or duration'},{status:400});
 const {date,duration,exclude}=parsed.data,{data:c}=await ctx.supabase.from('clinics').select('*,working_schedules(*)').eq('id',ctx.clinicId).single();if(!c)return NextResponse.json({error:'Clinic unavailable'},{status:404});
 const {data:isTest,error:modeError}=await ctx.supabase.rpc('workspace_is_test',{cid:ctx.clinicId});if(modeError)return NextResponse.json({error:'Workspace mode unavailable'},{status:503});
 const db=createServiceClient(),{data:clinics}=await db.from('clinics').select('id').eq('workspace_root',c.workspace_root||c.id);
 const [{data:appointments,error},{data:blocked}]=await Promise.all([db.from('appointments').select('id,appointment_date,appointment_time,duration_minutes,status').in('clinic_id',(clinics||[]).map(c=>c.id)).eq('appointment_date',date).eq('is_test',isTest===true),ctx.supabase.from('blocked_dates').select('blocked_date').eq('clinic_id',ctx.clinicId)]);
 if(error)return NextResponse.json({error:'Availability could not be checked'},{status:503});
 let slots=timeSlots({...c,schedules:c.working_schedules} as Clinic,date,duration,(appointments||[]).map(a=>({id:a.id,patientId:'',type:'Visit',date:a.appointment_date,time:a.appointment_time,duration:a.duration_minutes,status:a.status})),(blocked||[]).map(d=>d.blocked_date),exclude);
 let google='disconnected';try{const result=await googleBusy(ctx.clinicId,date,exclude);google=result.connected?'checked':'disconnected';slots=slots.filter(t=>!hasBusyConflict(result.busy,date,t,duration));}catch{google='unavailable';}
 return NextResponse.json({slots,google});
}
