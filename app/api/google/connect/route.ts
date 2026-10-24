import { NextResponse } from 'next/server';
import { authenticatedClinic } from '@/lib/auth';
import { googleScopes,oauthConfig,seal } from '@/lib/google-calendar';
import { connection,lifecycle } from '@/lib/google-lifecycle';
import { randomBytes,createHash } from 'node:crypto';
export async function GET(){
 const ctx=await authenticatedClinic();if(!ctx)return NextResponse.json({error:'Unauthorized'},{status:401});
 const {data:c}=await ctx.supabase.from('clinics').select('doctor_id').eq('id',ctx.clinicId).single();if(c?.doctor_id!==ctx.user.id)return NextResponse.json({error:'The workspace owner must connect Google. Complete workspace setup first.'},{status:403});
 try{
  if(await connection(ctx.user.id))throw new Error('Disconnect the current Google account before connecting another');
  const l=await lifecycle(ctx.user.id);if(l.mode==='test'&&l.test_cleared_at)throw new Error('Switch to production or start a new test session before connecting');
  const config=oauthConfig(),state=randomBytes(32).toString('base64url'),verifier=randomBytes(32).toString('base64url'),url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search=new URLSearchParams({client_id:config.client_id,redirect_uri:config.redirect_uri,response_type:'code',scope:googleScopes,access_type:'offline',prompt:'consent select_account',state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}).toString();
  const response=NextResponse.redirect(url);response.cookies.set('dentaflow-google-oauth',seal({state,verifier,userId:ctx.user.id,clinicId:ctx.clinicId,mode:l.mode,session:l.test_session,expires:Date.now()+600000}),{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/api/google',maxAge:600});return response;
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Google setup unavailable'},{status:409});}
}
