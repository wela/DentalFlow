import { NextResponse } from "next/server";
import { authenticatedClinic } from "@/lib/auth";
import { appointmentSchema } from "@/lib/validation";

export async function GET() {
  const context=await authenticatedClinic();
  if(!context)return NextResponse.json({error:"Unauthorized"},{status:401});
  const {data,error}=await context.supabase.from("appointments").select("id,patient_id,appointment_date,appointment_time,status,duration_minutes,appointment_types(name)").eq("clinic_id",context.clinicId).order("appointment_date");
  if(error)return NextResponse.json({error:error.message},{status:400});
  return NextResponse.json((data??[]).map(a=>({id:a.id,patientId:a.patient_id,date:a.appointment_date,time:a.appointment_time?.slice(0,5),status:a.status,duration:a.duration_minutes,type:(Array.isArray(a.appointment_types)?a.appointment_types[0]:a.appointment_types)?.name??"Appointment"})));
}

export async function POST(request:Request){
  const context=await authenticatedClinic();
  if(!context)return NextResponse.json({error:"Unauthorized"},{status:401});
  const parsed=appointmentSchema.safeParse(await request.json().catch(()=>null));
  if(!parsed.success)return NextResponse.json({error:parsed.error.issues[0].message},{status:400});
  const input=parsed.data;
  const {data:type}=await context.supabase.from("appointment_types").select("id").eq("clinic_id",context.clinicId).eq("name",input.type).eq("active",true).maybeSingle();
  if(!type)return NextResponse.json({error:"Appointment type is unavailable"},{status:400});
  const {data:id,error}=await context.supabase.rpc("book_appointment",{p_clinic:context.clinicId,p_patient:input.patientId,p_date:input.date,p_time:input.time||null,p_type:type.id,p_status:input.status});
  if(error)return NextResponse.json({error:error.message},{status:409});
  return NextResponse.json({id,...input},{status:201});
}
