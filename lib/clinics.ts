import type { Appointment } from './types';
export type Schedule = { weekday:number; enabled:boolean; opens:string; closes:string };
export type Clinic = { id:string; name:string; kind:'ug'|'maritime'|'gilead'|'aura'; color:string; schedules:Schedule[]; doctorId?:string; rootId?:string; duration:number; followUpWeeks:number };
const day=(weekday:number,opens:string,closes:string):Schedule=>({weekday,opens,closes,enabled:true});
export const demoClinics:Clinic[]=[
 {id:'ug',kind:'ug',name:'UG Dental School',color:'#0f766e',schedules:[day(5,'08:00','17:00')],duration:30,followUpWeeks:4},
 {id:'maritime',kind:'maritime',name:'Maritime Regional Hospital',color:'#2563eb',schedules:[day(1,'09:00','13:00'),day(2,'10:00','17:00'),day(3,'10:00','13:00')],duration:30,followUpWeeks:4},
 {id:'gilead',kind:'gilead',name:'Gilead',color:'#9333ea',schedules:[day(6,'13:00','17:00')],duration:30,followUpWeeks:4},
 {id:'aura',kind:'aura',name:'Aura',color:'#ea580c',schedules:[day(1,'14:00','18:00')],duration:30,followUpWeeks:4}
];
export const minutes=(time:string)=>Number(time.slice(0,2))*60+Number(time.slice(3,5));
export const clockTime=(n:number)=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
export const overlaps=(a:number,b:number,c:number,d:number)=>a<d&&c<b;
export function workingDates(clinic:Clinic,blocked:string[]=[]){const result:string[]=[];for(let i=0;i<90&&result.length<12;i++){const d=new Date(Date.now()+i*86400000),date=d.toISOString().slice(0,10);if(!blocked.includes(date)&&clinic.schedules.some(s=>s.enabled&&s.weekday===d.getUTCDay()))result.push(date);}return result;}
export function fitsSchedule(clinic:Clinic,a:Appointment,blocked:string[]){const s=clinic.schedules.find(s=>s.enabled&&s.weekday===new Date(a.date+'T12:00:00Z').getUTCDay());return !!s&&!blocked.includes(a.date)&&(clinic.kind==='ug'||!!a.time&&minutes(a.time)>=minutes(s.opens)&&minutes(a.time)+(a.duration||30)<=minutes(s.closes));}
export function timeSlots(clinic:Clinic,date:string,duration:number,appointments:Appointment[],blocked:string[]=[],exclude?:string){
 const s=clinic.schedules.find(s=>s.enabled&&s.weekday===new Date(date+'T12:00:00Z').getUTCDay());
 if(!s||blocked.includes(date)||duration<30||duration>60)return [];
 const result:string[]=[];
 for(let n=minutes(s.opens);n+duration<=minutes(s.closes);n+=15){
  if(new Date(`${date}T${clockTime(n)}:00Z`).getTime()<Date.now())continue;
  if(!appointments.some(a=>a.id!==exclude&&a.date===date&&['pending_approval','awaiting_confirmation','confirmed','reschedule_requested','completed'].includes(a.status)&&(!a.time||overlaps(n,n+duration,minutes(a.time),minutes(a.time)+(a.duration||30)))))result.push(clockTime(n));
 }
 return result;
}
export const workspaceKey=(clinic:Clinic)=>clinic.kind==='ug'?'dentaflow-workspace-v2':`dentaflow-workspace-${clinic.id}`;
export const settingsKey=(clinic:Clinic)=>clinic.kind==='ug'?'dentaflow-settings-v1':`dentaflow-settings-${clinic.id}`;
