import { createServiceClient } from './supabase/server';
import { accessToken,googleRequest,GoogleError,unseal,type Tokens } from './google-calendar';
import { connection,lifecycle,ownerClinicIds,withGoogleOperation,type Connection,type Lifecycle } from './google-lifecycle';

export async function testInventory(uid:string){const db=createServiceClient(),ids=await ownerClinicIds(uid);const [p,a,refs,calendars]=await Promise.all([
 db.from('patients').select('id',{count:'exact',head:true}).in('clinic_id',ids).eq('is_test',true),
 db.from('appointments').select('id',{count:'exact',head:true}).in('clinic_id',ids).eq('is_test',true),
 db.from('google_event_refs').select('appointment_id,test_deleted_at,cleanup_error,account_sub,calendar_id,test_session,appointments!inner(clinic_id,is_test)').in('appointments.clinic_id',ids).eq('appointments.is_test',true),
 db.from('google_created_calendars').select('id,calendar_id,status,test_session').eq('user_id',uid).not('test_session','is',null)
 ]);if([p,a,refs,calendars].some(r=>r.error))throw new Error('Cannot verify the test-data inventory');return {patients:p.count||0,appointments:a.count||0,events:refs.data||[],calendars:calendars.data||[]};}
export function handoverChecklist(l:Lifecycle,c:Connection|null,inventory:{patients:number;appointments:number;events:unknown[]}){return {testDataCleared:!!l.test_cleared_at&&!inventory.patients&&!inventory.appointments&&!inventory.events.length,developerDisconnected:!!l.developer_disconnected_at&&(!c||c.account_sub!==l.test_account_sub),doctorConnected:!!c?.account_sub&&!c.is_test&&c.account_sub!==l.test_account_sub&&!!l.production_confirmed_at};}

// Account revocation is best-effort; local token deletion is mandatory, including on timeout.
export async function disconnectGoogle(uid:string){return withGoogleOperation(uid,'disconnect',async()=>{const db=createServiceClient(),c=await connection(uid);let warning:string|null=null;
 if(c){try{const t=unseal<Tokens>(c.tokens);const r=await fetch('https://oauth2.googleapis.com/revoke',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:t.refresh_token||t.access_token}),signal:AbortSignal.timeout(5000)});if(!r.ok&&r.status!==400)throw new Error('Revocation refused');}catch{warning='Stored tokens were removed, but Google revocation could not be confirmed. Remove DentaFlow access in your Google Account permissions.';}
  const {error}=await db.from('google_connections').delete().eq('user_id',uid).eq('connection_id',c.connection_id);if(error)throw new Error('Stored token removal failed. Disconnect is not complete.');}
 const {error:mapError}=await db.from('google_calendar_mappings').delete().eq('user_id',uid);if(mapError)throw new Error('Tokens removed, but calendar mapping reset failed. Retry disconnect.');
 const l=await lifecycle(uid);warning=c?warning:l.revocation_warning;const {error}=await db.from('workspace_lifecycle').update({revocation_warning:warning,production_confirmed_at:null,...(c?.is_test||l.mode==='test'?{developer_disconnected_at:new Date().toISOString()}:{})}).eq('user_id',uid);if(error)throw new Error('Tokens removed; could not record disconnection. Refresh and retry.');return {notice:warning||'Google account disconnected and stored tokens removed. No events or calendars were deleted.'};
 });}

export async function changeWorkspaceMode(uid:string,action:'start_test'|'production',confirmation:string){return withGoogleOperation(uid,'mode',async()=>{const db=createServiceClient(),l=await lifecycle(uid),c=await connection(uid),inv=await testInventory(uid);if(c)throw new Error('Disconnect the current Google account before changing workspace mode');
 if(action==='start_test'){if(confirmation!=='START TEST MODE')throw new Error('Type START TEST MODE to confirm');if(inv.patients||inv.appointments||inv.events.length)throw new Error('Clear the previous test data first');const {error}=await db.from('workspace_lifecycle').update({mode:'test',test_session:crypto.randomUUID(),cleanup_active:false,test_cleared_at:null,test_account_sub:null,developer_disconnected_at:null,production_confirmed_at:null}).eq('user_id',uid);if(error)throw new Error('Could not enable Test Mode');}
 else{if(confirmation!=='SWITCH TO PRODUCTION')throw new Error('Type SWITCH TO PRODUCTION to confirm');if(l.mode!=='test'||!l.test_cleared_at||!l.developer_disconnected_at||inv.patients||inv.appointments||inv.events.length)throw new Error('Clear Test Data and Disconnect must both finish first');const {error}=await db.from('workspace_lifecycle').update({mode:'production',cleanup_active:false,production_confirmed_at:null}).eq('user_id',uid);if(error)throw new Error('Could not switch to production');}
 return {ok:true};});}

export async function confirmHandover(uid:string,email:string){return withGoogleOperation(uid,'handover',async()=>{const l=await lifecycle(uid),c=await connection(uid),inv=await testInventory(uid);if(l.mode!=='production'||!c?.account_sub||c.is_test||c.account_sub===l.test_account_sub||email!==c.account_email||inv.patients||inv.appointments||inv.events.length)throw new Error('Verify the doctor’s Google account and clear all test data first');if(l.test_session&&(!l.test_cleared_at||!l.developer_disconnected_at))throw new Error('Test cleanup and developer disconnection are incomplete');const {error}=await createServiceClient().from('workspace_lifecycle').update({production_confirmed_at:new Date().toISOString()}).eq('user_id',uid);if(error)throw new Error('Could not record handover');return {ok:true};});}

export type TestEventReference={appointment_id:string;calendar_id:string;event_id:string;account_sub:string|null;test_session:string|null;test_deleted_at?:string|null};
export async function deleteOwnedTestEvent(token:string,c:Connection,session:string,ref:TestEventReference){
 if(!c.is_test||!c.account_sub||ref.account_sub!==c.account_sub||ref.test_session!==session)throw new Error('Test event belongs to a different or unverified Google account/session. Reconnect its original test account.');
 // A missing/inaccessible calendar is NOT evidence that the event was deleted.
 await googleRequest(token,`calendars/${encodeURIComponent(ref.calendar_id)}`);
 const path=`calendars/${encodeURIComponent(ref.calendar_id)}/events/${encodeURIComponent(ref.event_id)}`;
 let event:{status?:string;extendedProperties?:{private?:{dentaflowAppointment?:string;dentaflowTestSession?:string}}};
 try{event=await googleRequest(token,path);}catch(e){if(e instanceof GoogleError&&[404,410].includes(e.status))return;throw e;}
 if(event.status==='cancelled')return;
 if(event.extendedProperties?.private?.dentaflowAppointment!==ref.appointment_id||event.extendedProperties?.private?.dentaflowTestSession!==session)throw new Error('Google event ownership/test marker does not match. Nothing deleted.');
 await googleRequest(token,path,'DELETE');
}
export async function clearTestData(uid:string,session:string,confirmation:string){
 if(confirmation!=='CLEAR TEST DATA')throw new Error('Type CLEAR TEST DATA to explicitly confirm');
 return withGoogleOperation(uid,'cleanup',async()=>{const db=createServiceClient(),l=await lifecycle(uid);if(l.mode!=='test'||!l.test_session||l.test_session!==session)throw new Error('Test session changed. Refresh the cleanup preview');
 const {error:startError}=await db.from('workspace_lifecycle').update({cleanup_active:true}).eq('user_id',uid).eq('test_session',session);if(startError)throw new Error('Could not lock test data for cleanup');
 const ids=await ownerClinicIds(uid),{data:refs,error}=await db.from('google_event_refs').select('*,appointments!inner(clinic_id,is_test,test_session)').in('appointments.clinic_id',ids).eq('appointments.is_test',true).eq('appointments.test_session',session).is('test_deleted_at',null).limit(3);if(error)throw new Error('Cannot load tracked test events; local data retained');
 const failures:{appointmentId:string;error:string}[]=[];let deleted=0;
 if(refs?.length){const c=await connection(uid);let token:string|null=null;try{if(c)token=await accessToken(uid);}catch{/* Retain references and return a reconnect error below. */}
  for(const ref of refs){try{if(!c||!token)throw new Error('Reconnect the original test Google account to clear its events');await deleteOwnedTestEvent(token,c,session,ref);const saved=await db.from('google_event_refs').update({test_deleted_at:new Date().toISOString(),cleanup_error:null}).eq('appointment_id',ref.appointment_id).eq('test_session',session);if(saved.error)throw new Error('Google deletion succeeded but local confirmation failed. Retry safely.');deleted++;}catch(e){const message=e instanceof Error?e.message:'Google deletion failed';failures.push({appointmentId:ref.appointment_id,error:message});await db.from('google_event_refs').update({cleanup_error:message}).eq('appointment_id',ref.appointment_id);}}
 }
 const inventory=await testInventory(uid),remaining=inventory.events.filter(e=>!e.test_deleted_at).length;
 if(remaining||failures.length)return {complete:false,deleted,remaining,failures,notice:'Local test data and references retained until every tracked Google event is confirmed removed. Continue cleanup to retry/process the next batch.'};
 const {error:finish}=await db.rpc('finish_test_cleanup',{uid,sid:session});if(finish)throw new Error(finish.message);
 return {complete:true,deleted,remaining:0,failures:[],notice:'Test patients, appointments, messages and associated history cleared. Clinic settings and all Google calendars retained. Disconnect is a separate action.'};
 });
}
