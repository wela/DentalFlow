import { addDays, addWeeks, format, getDay, parseISO } from 'date-fns';
import type { Appointment, Patient } from './types';
import type { SavedSettings } from './clinic-settings';
export type Message = { id:string; patientId:string; appointmentId:string; body:string; status:string; simulated:boolean; scheduledFor:string; error?:string; kind?:string };
export type VisitEvent = { id:string; appointmentId:string; patientId:string; date:string; action:string; at:string };
export type Workspace = { patients:Patient[]; appointments:Appointment[]; messages:Message[]; history:VisitEvent[]; capacity:number; blocked:string[]; settings?:SavedSettings };
export const active = (a:Appointment) => ['pending_approval','awaiting_confirmation','confirmed','reschedule_requested'].includes(a.status);
// Appointment SMS only inform patients, so every open visit is simply "booked".
export const statusLabel=(a:Appointment)=>active(a)?'booked':a.status.replaceAll('_',' ');
// Dates as patients read them in SMS, e.g. "Friday 30 October".
export const smsDate=(date:string)=>format(parseISO(date),'EEEE d MMMM');
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
// Patients put off with "Not now" (after completing or instead of rescheduling) and not booked since.
export function notBooked(data:Workspace) {
  return data.patients.filter(p=>p.status==='active'&&!data.appointments.some(a=>a.patientId===p.id&&active(a))).flatMap(patient=>{
    const last=data.history.filter(h=>h.patientId===patient.id&&h.action!=='sms').sort((a,b)=>a.at.localeCompare(b.at)).at(-1);
    const visit=last?.action==='next visit not booked'&&data.appointments.find(a=>a.id===last.appointmentId);
    return visit?[{patient,visit}]:[];
  });
}
export function assertBooking(data:Workspace,patientId:string,date:string,exclude?:string){
  if(!data.patients.some(p=>p.id===patientId))throw new Error('Patient not found');
  if(data.appointments.some(a=>a.id!==exclude&&a.patientId===patientId&&active(a)))throw new Error('This patient already has an active appointment. Reschedule that visit instead.');
  if(date<todayAccra()||getDay(parseISO(date))!==5||data.blocked.includes(date))throw new Error('Choose an available Friday');
  if(data.appointments.filter(a=>a.id!==exclude&&a.date===date&&active(a)).length>=data.capacity)throw new Error('This Friday is full');
}
export function isCompletionSwipe(start:{x:number;y:number},end:{x:number;y:number}){return start.x-end.x>80&&Math.abs(start.y-end.y)<45;}
export function isRescheduleSwipe(start:{x:number;y:number},end:{x:number;y:number}){return end.x-start.x>80&&Math.abs(start.y-end.y)<45;}
function queueDemoReminders(data:Workspace,a:Appointment){
 const p=data.patients.find(p=>p.id===a.patientId)!;
 for(const days of data.settings?.reminderDays||[7,2,1]){const due=format(addDays(parseISO(a.date),-days),'yyyy-MM-dd')+'T06:00:00.000Z';if(due>new Date().toISOString())data.messages.push({id:crypto.randomUUID(),patientId:p.id,appointmentId:a.id,body:`Hello ${p.name}, reminder: your dental appointment at ${data.settings?.clinicName||'DentaFlow'} is on ${smsDate(a.date)}. ${data.settings?.contactNumber||''}`,status:'pending',simulated:true,scheduledFor:due,kind:'reminder'});}
}
export function demoChange(data:Workspace,action:string,id:string,date?:string):Workspace {
  const next=structuredClone(data), at=new Date().toISOString();
  if(action==='retry'){
    const m=next.messages.find(m=>m.id===id&&m.status==='failed');if(!m)throw new Error('Only failed messages can be retried');
    m.status='delivered';m.simulated=true;m.error=undefined;return next;
  }
  let a=next.appointments.find(a=>a.id===id);
  if(action==='defer'){
    if(!a)throw new Error('Appointment not found');
    if(active(a)){
      next.messages.filter(m=>m.appointmentId===a!.id&&m.status==='pending').forEach(m=>m.status='cancelled');
      if(a.date<=todayAccra()){a.status='no_show';next.history.push({id:crypto.randomUUID(),appointmentId:a.id,patientId:a.patientId,date:a.date,action:'no show',at});}
      else{a.status='cancelled';const p=next.patients.find(p=>p.id===a!.patientId)!;next.messages.push({id:`${a.id}:cancel:${a.date}`,patientId:p.id,appointmentId:a.id,body:`Hello ${p.name}, your dental appointment has been cancelled. Please contact the clinic with any questions.`,status:'delivered',simulated:true,scheduledFor:at});next.history.push({id:crypto.randomUUID(),appointmentId:a.id,patientId:a.patientId,date:a.date,action:'cancel',at});}
    }else if(a.status!=='completed')throw new Error('This visit is already closed');
    next.history.push({id:crypto.randomUUID(),appointmentId:a.id,patientId:a.patientId,date:a.date,action:'next visit not booked',at});return next;
  }
  if(action==='add'){
    assertBooking(next,id,date!);
    a={id:crypto.randomUUID(),patientId:id,date:date!,status:'awaiting_confirmation',type:'Follow-up'};
    next.appointments.push(a);
  }
  if(!a)throw new Error('Appointment not found');
  if(action==='arrive'){if(!active(a)||a.date!==todayAccra())throw new Error('Check-in is available for today’s active visits');a.arrivedAt=at;next.history.push({id:crypto.randomUUID(),appointmentId:a.id,patientId:a.patientId,date:a.date,action:'arrived',at});return next;}
  if(action==='undo'){
    if(a.status!=='completed'||!a.completedAt||Date.now()-Date.parse(a.completedAt)>300000)throw new Error('Undo is available for five minutes after completion');
    if(next.appointments.some(other=>other.id!==a!.id&&other.patientId===a!.patientId&&active(other))||next.appointments.filter(other=>other.date===a!.date&&active(other)).length>=next.capacity)throw new Error('Cannot restore this visit: another booking or capacity conflict needs review');
    a.status=a.previousStatus||'confirmed';a.completedAt=undefined;queueDemoReminders(next,a);next.history.push({id:crypto.randomUUID(),appointmentId:a.id,patientId:a.patientId,date:a.date,action:'completion undone',at});return next;
  }
  if(action!=='sms'&&action!=='add'&&!active(a))throw new Error('This visit is already closed');
  if(action==='reschedule'){assertBooking(next,a.patientId,date!,a.id);if(a.date<todayAccra())next.history.push({id:crypto.randomUUID(),appointmentId:a.id,patientId:a.patientId,date:a.date,action:'no show',at});next.history.push({id:crypto.randomUUID(),appointmentId:a.id,patientId:a.patientId,date:a.date,action:'rescheduled from',at});a.date=date!;a.time=undefined;a.arrivedAt=undefined;a.status='awaiting_confirmation';}
  if(action==='complete'){a.previousStatus=a.status;a.status='completed';a.completedAt=at;}
  if(action==='cancel')a.status='cancelled';
  if(action!=='sms')next.messages.filter(m=>m.appointmentId===a.id&&m.status==='pending').forEach(m=>m.status='cancelled');
  const p=next.patients.find(p=>p.id===a.patientId)!;
  const key=`${a.id}:${action}:${a.date}`;
  if(action!=='complete'&&!next.messages.some(m=>m.id===key))next.messages.push({id:key,patientId:p.id,appointmentId:a.id,body:`Hello ${p.name}, your dental appointment ${action==='cancel'?'has been cancelled':`is on ${smsDate(a.date)}`}. Please contact the clinic with any questions.`,status:'delivered',simulated:true,scheduledFor:at});
  if(['add','reschedule'].includes(action))queueDemoReminders(next,a);
  next.history.push({id:crypto.randomUUID(),appointmentId:a.id,patientId:a.patientId,date:a.date,action,at});
  return next;
}
