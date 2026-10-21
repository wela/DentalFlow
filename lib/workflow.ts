import { addDays, addWeeks, format, getDay, parseISO } from 'date-fns';
import type { Appointment, Patient } from './types';
export type Message = { id:string; patientId:string; appointmentId:string; body:string; status:string; simulated:boolean; scheduledFor:string };
export type VisitEvent = { id:string; appointmentId:string; patientId:string; date:string; action:string; at:string };
export type Workspace = { patients:Patient[]; appointments:Appointment[]; messages:Message[]; history:VisitEvent[]; capacity:number; blocked:string[] };
export const active = (a:Appointment) => ['pending_approval','awaiting_confirmation','confirmed','reschedule_requested'].includes(a.status);
export const todayAccra = () => new Date().toISOString().slice(0,10);
export function availableFridays(data:Workspace, start=todayAccra(), exclude?:string) {
  const dates:string[]=[];
  for(let n=0;n<365&&dates.length<12;n++){
    const day=addDays(parseISO(start),n), date=format(day,'yyyy-MM-dd');
    if(getDay(day)===5&&!data.blocked.includes(date)&&data.appointments.filter(a=>a.id!==exclude&&a.date===date&&active(a)).length<data.capacity)dates.push(date);
  }
  return dates;
}
export function followUps(data:Workspace) {
  return data.patients.filter(p=>p.status==='active'&&!data.appointments.some(a=>a.patientId===p.id&&active(a))).flatMap(patient=>{
    const last=data.appointments.filter(a=>a.patientId===patient.id&&a.status==='completed').sort((a,b)=>(b.completedAt||b.date).localeCompare(a.completedAt||a.date))[0];
    if(!last)return [];
    const target=format(addWeeks(parseISO((last.completedAt||last.date).slice(0,10)),patient.intervalWeeks),'yyyy-MM-dd');
    return [{patient,target,suggested:availableFridays(data,target<todayAccra()?todayAccra():target)[0]}];
  });
}
export function assertBooking(data:Workspace,patientId:string,date:string,exclude?:string){
  if(!data.patients.some(p=>p.id===patientId))throw new Error('Patient not found');
  if(data.appointments.some(a=>a.id!==exclude&&a.patientId===patientId&&active(a)))throw new Error('This patient already has an active appointment. Reschedule that visit instead.');
  if(date<todayAccra()||getDay(parseISO(date))!==5||data.blocked.includes(date))throw new Error('Choose an available Friday');
  if(data.appointments.filter(a=>a.id!==exclude&&a.date===date&&active(a)).length>=data.capacity)throw new Error('This Friday is full');
}
export function isCompletionSwipe(start:{x:number;y:number},end:{x:number;y:number}){return start.x-end.x>80&&Math.abs(start.y-end.y)<45;}
export function demoChange(data:Workspace,action:string,id:string,date?:string):Workspace {
  const next=structuredClone(data), at=new Date().toISOString();
  let a=next.appointments.find(a=>a.id===id);
  if(action==='add'){
    assertBooking(next,id,date!);
    a={id:crypto.randomUUID(),patientId:id,date:date!,status:'awaiting_confirmation',type:'Follow-up'};
    next.appointments.push(a);
  }
  if(!a)throw new Error('Appointment not found');
  if(action!=='sms'&&action!=='add'&&!active(a))throw new Error('This visit is already closed');
  if(action==='reschedule'){assertBooking(next,a.patientId,date!,a.id);next.history.push({id:crypto.randomUUID(),appointmentId:a.id,patientId:a.patientId,date:a.date,action:'rescheduled from',at});a.date=date!;a.time=undefined;a.status='awaiting_confirmation';}
  if(action==='complete'){a.status='completed';a.completedAt=at;}
  if(action==='cancel')a.status='cancelled';
  if(action!=='sms')next.messages.filter(m=>m.appointmentId===a.id&&m.status==='pending').forEach(m=>m.status='cancelled');
  const p=next.patients.find(p=>p.id===a.patientId)!;
  const key=`${a.id}:${action}:${a.date}`;
  if(action!=='complete'&&!next.messages.some(m=>m.id===key))next.messages.push({id:key,patientId:p.id,appointmentId:a.id,body:`Hello ${p.name}, your dental appointment ${action==='cancel'?'has been cancelled':`is scheduled for ${a.date}`}. Please contact the clinic with any questions.`,status:'delivered',simulated:true,scheduledFor:at});
  if(['add','reschedule'].includes(action))for(const days of [7,2,1]){const due=addDays(parseISO(a.date),-days).toISOString();if(due>at)next.messages.push({id:crypto.randomUUID(),patientId:p.id,appointmentId:a.id,body:`Hello ${p.name}, reminder: your dental appointment is on ${a.date}.`,status:'pending',simulated:true,scheduledFor:due});}
  next.history.push({id:crypto.randomUUID(),appointmentId:a.id,patientId:a.patientId,date:a.date,action,at});
  return next;
}
