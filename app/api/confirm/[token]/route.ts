import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { hashPatientToken } from "@/lib/tokens";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const supabase = createServiceClient();
    const tokenHash = hashPatientToken(token);
    const { data: confirmation } = await supabase.from("patient_confirmation_tokens").select("appointment_id,expires_at,used_at").eq("token_hash", tokenHash).maybeSingle();
    if (!confirmation || confirmation.used_at || new Date(confirmation.expires_at) <= new Date()) return NextResponse.json({ error: "Invalid, expired, or already used link" }, { status: 410 });
    const { data: appointment } = await supabase.from("appointments").select("appointment_date,appointment_time,status,patients(full_name),clinics(name)").eq("id", confirmation.appointment_id).maybeSingle();
    if (!appointment) return NextResponse.json({ error: "Appointment not found" }, { status: 404 });
    const patient = Array.isArray(appointment.patients) ? appointment.patients[0] : appointment.patients;
    const clinic = Array.isArray(appointment.clinics) ? appointment.clinics[0] : appointment.clinics;
    return NextResponse.json({ clinicName: clinic?.name, patientName: patient?.full_name, date: appointment.appointment_date, time: appointment.appointment_time, status: appointment.status });
  } catch {
    return NextResponse.json({ error: "Confirmation service is unavailable" }, { status: 503 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const body = await request.json().catch(() => ({})) as { action?: string };
  if (!['confirm','reschedule'].includes(body.action ?? "")) return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  try {
    const supabase = createServiceClient();
    const tokenHash = hashPatientToken(token);
    const { data: confirmation, error } = await supabase.from("patient_confirmation_tokens").select("id,appointment_id,expires_at,used_at").eq("token_hash", tokenHash).is("used_at", null).maybeSingle();
    if (error || !confirmation) return NextResponse.json({ error: "Invalid or already used link" }, { status: 404 });
    if (new Date(confirmation.expires_at) <= new Date()) return NextResponse.json({ error: "This link has expired" }, { status: 410 });
    const nextStatus = body.action === "confirm" ? "confirmed" : "reschedule_requested";
    const { error: updateError } = await supabase.rpc("respond_to_appointment", { p_token_hash: tokenHash, p_status: nextStatus });
    if (updateError) return NextResponse.json({ error: "Unable to update appointment" }, { status: 409 });
    return NextResponse.json({ status: nextStatus });
  } catch {
    return NextResponse.json({ error: "Confirmation service is unavailable" }, { status: 503 });
  }
}
