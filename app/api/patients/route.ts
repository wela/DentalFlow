import { NextResponse } from "next/server";
import { authenticatedClinic } from "@/lib/auth";
import { patientSchema } from "@/lib/validation";

export async function GET() {
  const context = await authenticatedClinic();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await context.supabase.from("patients").select("id,full_name,phone,email,preferred_channel,messaging_consent,default_follow_up_weeks,status,administrative_notes,created_at").eq("clinic_id", context.clinicId).order("full_name");
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json((data ?? []).map(p => ({ id:p.id,name:p.full_name,phone:p.phone,email:p.email,channel:p.preferred_channel,consent:p.messaging_consent,intervalWeeks:p.default_follow_up_weeks,status:p.status,notes:p.administrative_notes,registeredAt:p.created_at.slice(0,10) })));
}

export async function POST(request: Request) {
  const context = await authenticatedClinic();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const mode=request.headers.get('x-workspace-mode');if(!['test','production'].includes(mode||''))return NextResponse.json({error:'Refresh the workspace to confirm its mode'},{status:409});
  const parsed = patientSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const input=parsed.data;
  const { data, error } = await context.supabase.from("patients").insert({clinic_id:context.clinicId,is_test:mode==='test',full_name:input.name,phone:input.phone,email:input.email||null,preferred_channel:input.channel,messaging_consent:input.consent,default_follow_up_weeks:input.intervalWeeks}).select("id,created_at").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 409 });
  return NextResponse.json({id:data.id,...input,status:"active",registeredAt:data.created_at.slice(0,10)},{status:201});
}
