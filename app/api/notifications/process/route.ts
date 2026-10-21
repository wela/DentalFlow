import { NextRequest, NextResponse } from "next/server";
import { HttpSmsProvider, MockSmsProvider, type MessagingProvider } from "@/lib/notifications";
import { createServiceClient } from "@/lib/supabase/server";

function authorized(request: NextRequest) {
  return Boolean(process.env.CRON_SECRET) && request.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;
}

function provider(): MessagingProvider {
  if (process.env.MESSAGING_PROVIDER === "http" && process.env.MESSAGING_LIVE_ENABLED === "true") {
    if (!process.env.SMS_API_URL || !process.env.SMS_API_KEY) throw new Error("Live SMS credentials are incomplete");
    return new HttpSmsProvider(process.env.SMS_API_URL, process.env.SMS_API_KEY, process.env.SMS_SENDER_ID ?? "DentaFlow");
  }
  return new MockSmsProvider();
}

async function processJobs(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const supabase = createServiceClient();
    const messaging = provider();
    const { data: jobs, error } = await supabase.rpc("claim_notification_jobs", { p_limit: 25 });
    if (error) throw error;
    let sent = 0, failed = 0;
    for (const job of jobs ?? []) {
      try {
        const result = await messaging.send({ to: job.recipient, body: job.body, idempotencyKey: job.idempotency_key });
        await supabase.from("notification_attempts").insert({ job_id: job.id, provider: messaging.name, provider_message_id: result.providerId, status: result.status, response: { detail: result.detail } });
        const jobStatus = result.status === "failed" && job.attempt_count < job.max_attempts ? "pending" : result.status;
        await supabase.from("notification_jobs").update({ status: jobStatus, last_error: result.detail ?? null }).eq("id", job.id);
        if (result.status === "failed") failed++; else sent++;
      } catch (jobError) {
        failed++;
        await supabase.from("notification_jobs").update({ status: job.attempt_count < job.max_attempts ? "pending" : "failed", last_error: jobError instanceof Error ? jobError.message : "Unknown provider error" }).eq("id", job.id);
      }
    }
    return NextResponse.json({ provider: messaging.name, processed: (jobs ?? []).length, sent, failed });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Processing failed" }, { status: 503 });
  }
}

export const POST = processJobs;
export const GET = processJobs;
