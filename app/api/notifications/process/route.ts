import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { deliverClaimed } from '@/lib/delivery';
import { sendDailySummaries } from '@/lib/daily-summary';
async function processJobs(request:NextRequest){
 if(!process.env.CRON_SECRET||request.headers.get('authorization')!==`Bearer ${process.env.CRON_SECRET}`)return NextResponse.json({error:'Unauthorized'},{status:401});
 try{const db=createServiceClient(),start=Date.now();let processed=0;do{const {data,error}=await db.rpc('claim_notification_jobs',{p_limit:5});if(error)throw error;if(!data?.length)break;await Promise.all(data.map(deliverClaimed));processed+=data.length;}while(Date.now()-start<30000);let summaries=0;try{summaries=await sendDailySummaries(db);}catch{/* Patient messages matter more than the doctor's summary; never fail the run for it. */}return NextResponse.json({processed,summaries});}catch{return NextResponse.json({error:'Message processing unavailable'},{status:503});}
}
export const maxDuration=60;
export const GET=processJobs;
export const POST=processJobs;
