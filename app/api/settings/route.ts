import { NextResponse } from 'next/server';
import { authenticatedClinic } from '@/lib/auth';
import { clinicSettingsSchema } from '@/lib/clinic-settings';
export async function GET(){
 const ctx=await authenticatedClinic();if(!ctx)return NextResponse.json({error:'Unauthorized'},{status:401});
 const [clinic,settings,blocked]=await Promise.all([ctx.supabase.from('clinics').select('name').eq('id',ctx.clinicId).single(),ctx.supabase.from('clinic_settings').select('*').eq('clinic_id',ctx.clinicId).single(),ctx.supabase.from('blocked_dates').select('blocked_date').eq('clinic_id',ctx.clinicId)]);
 if(clinic.error||settings.error||blocked.error)return NextResponse.json({error:'Unable to load clinic settings'},{status:503});
 return NextResponse.json({clinicName:clinic.data.name,contactNumber:settings.data.contact_number||'',capacity:settings.data.daily_capacity,reminderDays:settings.data.reminder_days,blocked:blocked.data.map(d=>d.blocked_date),messagingEnabled:settings.data.messaging_enabled,provider:settings.data.messaging_provider,canEdit:['admin','dentist'].includes(ctx.role)});
}
export async function POST(request:Request){
 const ctx=await authenticatedClinic();if(!ctx)return NextResponse.json({error:'Unauthorized'},{status:401});
 if(!['admin','dentist'].includes(ctx.role))return NextResponse.json({error:'Only dentists and administrators can change settings'},{status:403});
 const body=await request.json().catch(()=>null),parsed=clinicSettingsSchema.safeParse(body?.settings);
 if(!parsed.success)return NextResponse.json({error:parsed.error.issues[0].message},{status:400});
 const {error}=await ctx.supabase.rpc('save_clinic_settings',{cid:ctx.clinicId,config:parsed.data,acknowledge:body.acknowledge===true});
 if(error)return NextResponse.json({error:error.message},{status:409});return NextResponse.json({ok:true});
}
