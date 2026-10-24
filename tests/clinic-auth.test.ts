import { it,expect,vi,beforeEach } from 'vitest';
const state=vi.hoisted(()=>({header:null as string|null,cookie:undefined as string|undefined,user:true}));
vi.mock('next/headers',()=>({headers:async()=>({get:()=>state.header}),cookies:async()=>({get:()=>state.cookie?{value:state.cookie}:undefined})}));
vi.mock('../lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:async()=>({data:{user:state.user?{id:'doctor'}:null}})},from:()=>{let clinic:string|undefined;const q={select:()=>q,eq:(field:string,value:string)=>{if(field==='clinic_id')clinic=value;return q},order:()=>q,limit:()=>q,maybeSingle:async()=>({data:!clinic||['ug','maritime'].includes(clinic)?{clinic_id:clinic||'ug',role:'dentist'}:null})};return q;}})}));
import { authenticatedClinic } from '../lib/auth';
beforeEach(()=>{state.header=null;state.cookie=undefined;state.user=true});
it('uses the visible-tab clinic instead of a cookie changed by another tab',async()=>{state.header='maritime';state.cookie='ug';expect((await authenticatedClinic())?.clinicId).toBe('maritime')});
it('rejects an explicit clinic without membership rather than silently choosing another',async()=>{state.header='unrelated';state.cookie='ug';expect(await authenticatedClinic()).toBeNull()});
it('recovers a stale selection cookie and rejects unauthenticated requests',async()=>{state.cookie='removed-clinic';expect((await authenticatedClinic())?.clinicId).toBe('ug');state.user=false;expect(await authenticatedClinic()).toBeNull()});
