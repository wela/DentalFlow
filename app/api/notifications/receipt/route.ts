import { NextRequest,NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyReceipt } from '@/lib/receipts';
import { createServiceClient } from '@/lib/supabase/server';
export async function POST(request:NextRequest){
 const body=await request.text();if(body.length>16384)return NextResponse.json({error:'Payload too large'},{status:413});
 if(!verifyReceipt(body,request.headers.get('x-delivery-timestamp'),request.headers.get('x-delivery-signature'),process.env.SMS_WEBHOOK_SECRET))return NextResponse.json({error:'Invalid signature'},{status:401});
 let json;try{json=JSON.parse(body)}catch{return NextResponse.json({error:'Invalid JSON'},{status:400})}
 const parsed=z.object({eventId:z.string().min(1).max(200),providerMessageId:z.string().min(1).max(200),status:z.enum(['delivered','failed'])}).safeParse(json);
 if(!parsed.success)return NextResponse.json({error:'Invalid receipt'},{status:400});
 try{const {error}=await createServiceClient().rpc('record_delivery_receipt',{eid:parsed.data.eventId,provider_id:parsed.data.providerMessageId,result:parsed.data.status});if(error)throw error;return NextResponse.json({ok:true});}catch{return NextResponse.json({error:'Receipt not yet recorded; retry later'},{status:503});}
}
