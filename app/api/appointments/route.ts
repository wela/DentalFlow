import { NextResponse } from "next/server";
import { authenticatedClinic } from "@/lib/auth";
import { POST as workspaceAction } from "../workspace/route";

export async function GET() {
  const context=await authenticatedClinic();
  if(!context)return NextResponse.json({error:"Unauthorized"},{status:401});
  const {data,error}=await context.supabase.from("appointments").select("id,patient_id,appointment_date,appointment_time,status,duration_minutes,appointment_types(name)").eq("clinic_id",context.clinicId).order("appointment_date");
  if(error)return NextResponse.json({error:error.message},{status:400});
  return NextResponse.json((data??[]).map(a=>({id:a.id,patientId:a.patient_id,date:a.appointment_date,time:a.appointment_time?.slice(0,5),status:a.status,duration:a.duration_minutes,type:(Array.isArray(a.appointment_types)?a.appointment_types[0]:a.appointment_types)?.name??"Appointment"})));
}

// Keep the legacy endpoint, but use the same checked booking path and Google synchronization.
export async function POST(request:Request){
 const input=await request.json().catch(()=>null);
 return workspaceAction(new Request(request.url,{method:'POST',headers:request.headers,body:JSON.stringify({action:'add',id:input?.patientId,date:input?.date,time:input?.time||undefined,duration:input?.time?input?.duration||30:undefined})}));
}
