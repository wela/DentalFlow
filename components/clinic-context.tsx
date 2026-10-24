'use client';
import { createContext,useContext,useEffect,useState,useCallback } from 'react';
import { demoClinics,type Clinic } from '@/lib/clinics';
type Context={mode:'production'|'test';clinics:Clinic[];clinic:Clinic;selected:string;ready:boolean;error:string;select:(id:string)=>Promise<void>;refresh:()=>Promise<void>};
const fallback:Context={mode:'production',clinics:demoClinics,clinic:demoClinics[0],selected:'ug',ready:true,error:'',select:async()=>{},refresh:async()=>{}};
const ClinicContext=createContext<Context>(fallback);
export const useClinic=()=>useContext(ClinicContext);
// Bind every request to the visible clinic, even if another browser tab changes the cookie.
export function useClinicRequest(){const {clinic,mode}=useClinic();return useCallback((url:string,init?:RequestInit)=>fetch(url,{...init,headers:{...init?.headers,'x-clinic-id':clinic.id,'x-workspace-mode':mode}}),[clinic.id,mode]);}
export function ClinicProvider({children}:{children:React.ReactNode}){
 const [mode,setMode]=useState<'production'|'test'>('production');
 const demo=process.env.NEXT_PUBLIC_DEMO_MODE!=='false', [clinics,setClinics]=useState<Clinic[]>(demo?demoClinics:[]),[selected,setSelected]=useState('ug'),[ready,setReady]=useState(false),[error,setError]=useState('');
 const refresh=useCallback(async()=>{if(demo){setClinics(JSON.parse(localStorage.getItem('dentaflow-clinics')||'null')||demoClinics);setSelected(localStorage.getItem('dentaflow-selected')||'ug');}else{const r=await fetch('/api/clinics');const b=await r.json();if(!r.ok)throw new Error(b.error);setClinics(b.clinics);setSelected(b.selected);setMode(b.mode||'production');}setReady(true);},[demo]);
 useEffect(()=>{void refresh().catch(e=>{setError(e.message);setReady(true)});},[refresh]); // Initialization only; switching remounts clinic-scoped screens.
 async function select(id:string){setError('');try{if(id!=='all'&&!clinics.some(c=>c.id===id))return;if(demo){localStorage.setItem('dentaflow-selected',id);}else if(id!=='all'){const r=await fetch('/api/clinics',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'select',id})});if(!r.ok)throw new Error('Could not switch clinics');}setSelected(id);}catch(e){setError(e instanceof Error?e.message:'Could not switch clinic');}}
 const clinic=clinics.find(c=>c.id===selected)||clinics[0]||demoClinics[0];
 return <ClinicContext.Provider value={{mode,clinics,clinic,selected,ready,error,select,refresh}}><div key={selected+mode} style={{'--clinic-color':clinic.color} as React.CSSProperties}>{children}</div></ClinicContext.Provider>;
}
