import { NextRequest,NextResponse } from 'next/server';
import { authenticatedClinic } from '@/lib/auth';
import { exchangeToken,seal,unseal } from '@/lib/google-calendar';
import { createServiceClient } from '@/lib/supabase/server';
export async function GET(request:NextRequest){
 const response=NextResponse.redirect(new URL('/settings?google=connected',request.url));response.cookies.delete('dentaflow-google-oauth');
 try{const ctx=await authenticatedClinic();if(!ctx)throw new Error('Unauthorized');const raw=request.cookies.get('dentaflow-google-oauth')?.value;if(!raw)throw new Error('OAuth session expired');const state=unseal<{state:string;verifier:string;userId:string;expires:number}>(raw);if(state.userId!==ctx.user.id||state.expires<Date.now()||state.state!==request.nextUrl.searchParams.get('state'))throw new Error('Invalid OAuth state');const code=request.nextUrl.searchParams.get('code');if(!code)throw new Error('Authorization was not granted');const tokens=await exchangeToken({code,grant_type:'authorization_code',code_verifier:state.verifier});if(!tokens.refresh_token)throw new Error('Google did not grant offline access. Disconnect and reconnect.');const {error}=await createServiceClient().from('google_connections').upsert({user_id:ctx.user.id,tokens:seal(tokens),updated_at:new Date().toISOString()});if(error)throw new Error('Could not store authorization');return response;
 }catch{const failed=NextResponse.redirect(new URL('/settings?google=failed',request.url));failed.cookies.delete('dentaflow-google-oauth');return failed;}
}
