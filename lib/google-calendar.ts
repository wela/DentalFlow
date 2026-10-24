import { createCipheriv,createDecipheriv,randomBytes,createHash } from 'node:crypto';
import { createServiceClient } from './supabase/server';
import { connection,lifecycle,assertConnectionScope,withGoogleOperation } from './google-lifecycle';

export type Tokens={access_token:string;refresh_token?:string;expires_at:number};
export const googleScopes='openid email '+['calendar.events','calendar.calendarlist','calendar.calendars'].map(s=>`https://www.googleapis.com/auth/${s}`).join(' ');
function encryptionKey(){const key=Buffer.from(process.env.GOOGLE_TOKEN_ENCRYPTION_KEY||'','base64');if(key.length!==32)throw new Error('Google token encryption is not configured');return key;}
export function seal(value:unknown){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryptionKey(),iv);const encrypted=Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64url');}
export function unseal<T>(value:string):T{const b=Buffer.from(value,'base64url'),decipher=createDecipheriv('aes-256-gcm',encryptionKey(),b.subarray(0,12));decipher.setAuthTag(b.subarray(12,28));return JSON.parse(Buffer.concat([decipher.update(b.subarray(28)),decipher.final()]).toString());}
export function oauthConfig(){const client_id=process.env.GOOGLE_CLIENT_ID,client_secret=process.env.GOOGLE_CLIENT_SECRET,redirect_uri=process.env.GOOGLE_REDIRECT_URI;if(!client_id||!client_secret||!redirect_uri)throw new Error('Configure Google OAuth environment variables first');encryptionKey();return {client_id,client_secret,redirect_uri};}
export async function exchangeToken(params:Record<string,string>):Promise<Tokens>{
 const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...oauthConfig(),...params}),signal:AbortSignal.timeout(5000)});
 const result=await response.json();if(!response.ok||!result.access_token)throw new Error('Google authorization expired or was refused. Reconnect Google Calendar.');
 return {access_token:result.access_token,refresh_token:result.refresh_token,expires_at:Date.now()+Number(result.expires_in||3600)*1000};
}
export async function accessToken(userId:string){
 const db=createServiceClient(),{data,error}=await db.from('google_connections').select('tokens,connection_id').eq('user_id',userId).maybeSingle();
 if(error)throw new Error('Cannot load Google connection');if(!data)return null;
 let tokens=unseal<Tokens>(data.tokens);
 if(tokens.expires_at<Date.now()+60000){if(!tokens.refresh_token)throw new Error('Reconnect Google Calendar');const fresh=await exchangeToken({grant_type:'refresh_token',refresh_token:tokens.refresh_token});tokens={...fresh,refresh_token:fresh.refresh_token||tokens.refresh_token};const saved=await db.from('google_connections').update({tokens:seal(tokens),updated_at:new Date().toISOString()}).eq('user_id',userId).eq('connection_id',data.connection_id).select('connection_id').maybeSingle();if(saved.error||!saved.data)throw new Error('Cannot save refreshed Google authorization');}
 return tokens.access_token;
}
export class GoogleError extends Error{constructor(public status:number){super(`Google Calendar request failed (${status}). Retry or reconnect in Settings.`);}}
export async function googleRequest<T=Record<string,unknown>>(token:string,path:string,method='GET',body?:unknown):Promise<T>{
 const response=await fetch(`https://www.googleapis.com/calendar/v3/${path}`,{method,headers:{Authorization:`Bearer ${token}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(5000),cache:'no-store'});
 if(!response.ok)throw new GoogleError(response.status);return response.status===204?{} as T:await response.json();
}
export type GoogleCalendar={id:string;summary:string;accessRole:string;backgroundColor?:string;primary?:boolean};
export async function listCalendars(token:string){const items:GoogleCalendar[]=[];let page='';do{const r: {items?:GoogleCalendar[];nextPageToken?:string}=await googleRequest(token,`users/me/calendarList?maxResults=250${page?'&pageToken='+encodeURIComponent(page):''}`);items.push(...r.items||[]);page=r.nextPageToken||'';}while(page);return items;}
export const googleEventId=(id:string)=>'df'+createHash('sha256').update(id).digest('hex');
export function eventPayload(a:{id:string;appointment_date:string;appointment_time?:string|null;duration_minutes?:number|null;test_session?:string|null},name:string,color?:string){
 const timed=!!a.appointment_time,start=timed?new Date(`${a.appointment_date}T${a.appointment_time!.slice(0,5)}:00Z`):new Date(`${a.appointment_date}T00:00:00Z`);
 const end=new Date(start.getTime()+(timed?(a.duration_minutes||30)*60000:86400000));
 return {summary:`${name}'s Appointment`,visibility:'private',...(color?{colorId:color}:{}),start:timed?{dateTime:start.toISOString(),timeZone:'Africa/Accra'}:{date:a.appointment_date},end:timed?{dateTime:end.toISOString(),timeZone:'Africa/Accra'}:{date:end.toISOString().slice(0,10)},extendedProperties:{private:{dentaflowAppointment:a.id,...(a.test_session?{dentaflowTestSession:a.test_session}:{})}},description:'',transparency:timed?'opaque':'transparent'};
}
type GoogleEvent={id:string;status?:string;transparency?:string;start?:{date?:string;dateTime?:string};end?:{date?:string;dateTime?:string};extendedProperties?:{private?:{dentaflowAppointment?:string}}};
export type BusyPeriod={start:string;end:string};
async function googleBusyUnlocked(clinicId:string,date:string,exclude?:string):Promise<{connected:boolean;busy:BusyPeriod[]}>{
 const db=createServiceClient(),{data:c}=await db.from('clinics').select('doctor_id,workspace_root').eq('id',clinicId).single();if(!c?.doctor_id)return {connected:false,busy:[]};
 const account=await connection(c.doctor_id),mode=await lifecycle(c.doctor_id);if(!account)return {connected:false,busy:[]};assertConnectionScope(account,mode,mode.mode==='test');
 const token=await accessToken(c.doctor_id);if(!token)return {connected:false,busy:[]};
 const {data:mappings,error}=await db.from('google_calendar_mappings').select('calendar_id,busy_calendars').eq('user_id',c.doctor_id).eq('account_sub',account.account_sub).eq('is_test',account.is_test);if(error)throw new Error('Cannot load availability calendars');
 const ids=[...new Set(['primary',...(mappings||[]).flatMap(m=>[m.calendar_id,...m.busy_calendars])])];
 const busy:BusyPeriod[]=[];const started=Date.now();
 for(const id of ids){let page='';do{
  if(Date.now()-started>10000)throw new Error('Google availability timed out. Review manually before saving.');
  const query=new URLSearchParams({timeMin:date+'T00:00:00Z',timeMax:new Date(Date.parse(date+'T00:00:00Z')+86400000).toISOString(),singleEvents:'true',maxResults:'2500',...(page?{pageToken:page}:{})});
  const r:{items?:GoogleEvent[];nextPageToken?:string}=await googleRequest(token,`calendars/${encodeURIComponent(id)}/events?${query}`);
  for(const e of r.items||[]){if(e.status==='cancelled'||e.transparency==='transparent'||(exclude&&e.id===googleEventId(exclude)&&e.extendedProperties?.private?.dentaflowAppointment===exclude))continue;if(e.start&&e.end)busy.push({start:e.start.dateTime||e.start.date+'T00:00:00Z',end:e.end.dateTime||e.end.date+'T00:00:00Z'});}
  page=r.nextPageToken||'';
 }while(page);}
 return {connected:true,busy};
}
export function hasBusyConflict(busy:BusyPeriod[],date:string,time:string,duration:number){const start=Date.parse(`${date}T${time.slice(0,5)}:00Z`),end=start+duration*60000;return busy.some(b=>start<Date.parse(b.end)&&Date.parse(b.start)<end);}

// Deterministic event IDs, ownership markers and a database lease make retries safe.
async function syncAppointmentUnlocked(clinicId:string,id:string){
 const db=createServiceClient();let lease:string|undefined;
 try{
  const {data:initial}=await db.from('appointments').select('id,is_test,test_session').eq('id',id).eq('clinic_id',clinicId).single();if(!initial)throw new Error('Appointment not found');
  const {data:mapping}=await db.from('google_calendar_mappings').select('*').eq('clinic_id',clinicId).maybeSingle();
  if(!mapping){await db.from('appointments').update({sync_status:'disconnected',sync_error:'Select a Google calendar in Settings'}).eq('id',id);return 'disconnected';}
  const account=await connection(mapping.user_id),mode=await lifecycle(mapping.user_id);if(!account)throw new Error('Google Calendar is disconnected');assertConnectionScope(account,mode,initial.is_test===true);
  if(mapping.account_sub!==account.account_sub||mapping.is_test!==initial.is_test)throw new Error('Select a calendar for the currently connected account and workspace mode');
  const token=await accessToken(mapping.user_id);if(!token)throw new Error('Google Calendar is disconnected');
  const {error:refError}=await db.from('google_event_refs').upsert({appointment_id:id,calendar_id:mapping.calendar_id,event_id:googleEventId(id),account_sub:account.account_sub,test_session:initial.test_session||null},{onConflict:'appointment_id',ignoreDuplicates:true});if(refError)throw new Error('Cannot store calendar reference');
  lease=crypto.randomUUID();const {data:ref,error:lockError}=await db.from('google_event_refs').update({lock_token:lease,locked_until:new Date(Date.now()+120000).toISOString()}).eq('appointment_id',id).or(`locked_until.is.null,locked_until.lt.${new Date().toISOString()}`).select('*').maybeSingle();if(lockError)throw new Error('Cannot lock calendar synchronization');if(!ref)return 'pending';
  if(ref.account_sub!==account.account_sub||ref.test_session!==(initial.test_session||null)||ref.test_deleted_at)throw new Error('This event is bound to a different account/session or was cleared; it will not be reused');
  const {data:a,error}=await db.from('appointments').select('*,patients(full_name),clinics(kind)').eq('id',id).eq('clinic_id',clinicId).single();if(error||!a)throw new Error('Appointment not found');
  await googleRequest(token,`calendars/${encodeURIComponent(ref.calendar_id)}`);
  const path=`calendars/${encodeURIComponent(ref.calendar_id)}/events`,eventPath=`${path}/${ref.event_id}`;
  let existing:GoogleEvent|null=null;try{existing=await googleRequest<GoogleEvent>(token,eventPath);}catch(e){if(!(e instanceof GoogleError)||![404,410].includes(e.status))throw e;}
  if(existing&&existing.status!=='cancelled'&&existing.extendedProperties?.private?.dentaflowAppointment!==id)throw new Error('Calendar event ownership mismatch; no event changed');
  if(a.status==='cancelled'||a.status==='no_show'){
   if(existing&&existing.status!=='cancelled')await googleRequest(token,eventPath,'DELETE');
  }else{
   const color:Record<string,string>={ug:'7',maritime:'9',gilead:'3',aura:'6'};
   const payload=eventPayload(a,a.patients.full_name,color[a.clinics.kind]);
   if(existing?.status==='cancelled')throw new Error('This event was deleted in Google Calendar. Review before restoring it.');
   if(existing)await googleRequest(token,eventPath,'PATCH',payload);
   else{try{await googleRequest(token,path,'POST',{id:ref.event_id,...payload});}catch(e){if(!(e instanceof GoogleError)||e.status!==409)throw e;const found=await googleRequest<GoogleEvent>(token,eventPath);if(found.extendedProperties?.private?.dentaflowAppointment!==id)throw new Error('Calendar event ownership mismatch');await googleRequest(token,eventPath,'PATCH',payload);}}
  }
  const saved=await db.from('appointments').update({sync_status:'synced',sync_error:null}).eq('id',id).eq('sync_revision',a.sync_revision).select('id').maybeSingle();if(saved.error)throw new Error('Calendar confirmation could not be saved');return saved.data?'synced':'pending';
 }catch(e){const message=e instanceof Error?e.message:'Calendar sync failed';await db.from('appointments').update({sync_status:'failed',sync_error:message}).eq('id',id).eq('clinic_id',clinicId);return 'failed';}
 finally{if(lease)await db.from('google_event_refs').update({locked_until:null,lock_token:null}).eq('appointment_id',id).eq('lock_token',lease);}
}

export async function googleIdentity(token:string):Promise<{sub:string;email:string}>{
 const response=await fetch('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(5000),cache:'no-store'});
 const result=await response.json();if(!response.ok||typeof result.sub!=='string'||typeof result.email!=='string'||result.email_verified!==true)throw new Error('Google account identity could not be verified');return {sub:result.sub,email:result.email};
}
async function doctorForClinic(clinicId:string){const {data,error}=await createServiceClient().from('clinics').select('doctor_id').eq('id',clinicId).single();if(error)throw new Error('Cannot resolve clinic owner');return data?.doctor_id as string|undefined;}
export async function googleBusy(clinicId:string,date:string,exclude?:string){const uid=await doctorForClinic(clinicId);if(!uid)return {connected:false,busy:[]};return withGoogleOperation(uid,'availability',()=>googleBusyUnlocked(clinicId,date,exclude));}
export async function syncAppointment(clinicId:string,id:string){try{const uid=await doctorForClinic(clinicId);if(!uid)return 'disconnected';return await withGoogleOperation(uid,'sync',()=>syncAppointmentUnlocked(clinicId,id));}catch(e){await createServiceClient().from('appointments').update({sync_status:'pending',sync_error:e instanceof Error?e.message:'Google operation unavailable'}).eq('id',id).eq('clinic_id',clinicId);return 'pending';}}
