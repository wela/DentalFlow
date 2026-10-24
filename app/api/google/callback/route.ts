import { NextRequest,NextResponse } from 'next/server';
import { authenticatedClinic } from '@/lib/auth';
import { exchangeToken,googleIdentity,seal,unseal } from '@/lib/google-calendar';
import { connection,lifecycle,withGoogleOperation } from '@/lib/google-lifecycle';
import { createServiceClient } from '@/lib/supabase/server';
export async function GET(request:NextRequest){
 try{
  const ctx=await authenticatedClinic();if(!ctx)throw new Error('Unauthorized');
  const raw=request.cookies.get('dentaflow-google-oauth')?.value;if(!raw)throw new Error('OAuth session expired');
  const state=unseal<{state:string;verifier:string;userId:string;clinicId:string;mode:string;session:string|null;expires:number}>(raw);
  if(state.userId!==ctx.user.id||state.expires<Date.now()||state.state!==request.nextUrl.searchParams.get('state'))throw new Error('Invalid OAuth state');
  const {data:clinic}=await ctx.supabase.from('clinics').select('doctor_id').eq('id',state.clinicId).single();if(clinic?.doctor_id!==ctx.user.id)throw new Error('Unauthorized workspace');
  const code=request.nextUrl.searchParams.get('code');if(!code)throw new Error('Authorization was not granted');
  await withGoogleOperation(ctx.user.id,'connect',async()=>{
   const l=await lifecycle(ctx.user.id);if(l.mode!==state.mode||l.test_session!==state.session)throw new Error('Workspace mode changed');
   if(await connection(ctx.user.id))throw new Error('Disconnect the previous account first');
   const tokens=await exchangeToken({code,grant_type:'authorization_code',code_verifier:state.verifier});
   if(!tokens.refresh_token)throw new Error('Offline access was not granted');
   const identity=await googleIdentity(tokens.access_token),isTest=l.mode==='test';
   if(isTest&&l.test_cleared_at)throw new Error('Test cleanup is complete; switch to production');
   if(isTest&&l.test_account_sub&&identity.sub!==l.test_account_sub)throw new Error('Reconnect the original test account until cleanup completes');
   if(!isTest&&l.test_account_sub===identity.sub)throw new Error('The developer test account cannot be used in production');
   const db=createServiceClient();
   const {error}=await db.from('google_connections').insert({user_id:ctx.user.id,connection_id:crypto.randomUUID(),account_sub:identity.sub,account_email:identity.email,is_test:isTest,tokens:seal(tokens),updated_at:new Date().toISOString()});if(error)throw new Error('Could not store authorization');
   const saved=await db.from('workspace_lifecycle').update({...(isTest?{test_account_sub:identity.sub,developer_disconnected_at:null}:{}),production_confirmed_at:null,revocation_warning:null}).eq('user_id',ctx.user.id);
   if(saved.error){await db.from('google_connections').delete().eq('user_id',ctx.user.id);throw new Error('Could not record account identity');}
  });
  const response=NextResponse.redirect(new URL('/settings?google=connected',request.url));response.cookies.delete('dentaflow-google-oauth');return response;
 }catch{
  const response=NextResponse.redirect(new URL('/settings?google=failed',request.url));response.cookies.delete('dentaflow-google-oauth');return response;
 }
}
