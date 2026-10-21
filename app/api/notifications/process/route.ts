import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { deliverClaimed } from '@/lib/delivery';
async function processJobs(request:NextRequest){
 if(!process.env.CRON_SECRET||request.headers.get('authorization')!==`Bearer ${process.env.CRON_SECRET}`)return NextResponse.json({error:'Unauthorized'},{status:401});
 try{const db=createServiceClient();const {data,error}=await db.rpc('claim_notification_jobs',{p_limit:100});if(error)throw error;for(const job of data||[])await deliverClaimed(job);return NextResponse.json({processed:data?.length||0});}catch{return NextResponse.json({error:'Message processing unavailable'},{status:503});}
}
export const GET=processJobs;
export const POST=processJobs;
