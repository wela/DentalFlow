import { z } from 'zod';
import type { Appointment } from './types';
import type { Workspace } from './workflow';
import { addDays,format,parseISO } from 'date-fns';
export const clinicSettingsSchema=z.object({
 clinicName:z.string().trim().min(2).max(100),contactNumber:z.string().regex(/^\+[1-9]\d{7,14}$/).or(z.literal('')),
 capacity:z.coerce.number().int().min(1).max(100),reminderDays:z.array(z.number().int().min(1).max(60)).max(10),
 blocked:z.array(z.string().date()).max(365),messagingEnabled:z.boolean(),provider:z.enum(['mock','http'])
});
export type SavedSettings=z.infer<typeof clinicSettingsSchema>;
export const defaultSettings:SavedSettings={clinicName:'DentaFlow Dental Clinic',contactNumber:'',capacity:8,reminderDays:[7,2,1],blocked:[],messagingEnabled:false,provider:'mock'};
export const demoSettingsKey='dentaflow-settings-v1';
export function settingsImpact(settings:SavedSettings,appointments:Appointment[]){
 const future=appointments.filter(a=>a.date>=new Date().toISOString().slice(0,10)&&['pending_approval','awaiting_confirmation','confirmed','reschedule_requested'].includes(a.status));
 const counts=new Map<string,number>();future.forEach(a=>counts.set(a.date,(counts.get(a.date)||0)+1));
 return {blockedVisits:future.filter(a=>settings.blocked.includes(a.date)).length,overCapacityDates:[...counts].filter(([,n])=>n>settings.capacity).map(([date,count])=>({date,count})),upcomingVisits:future.length};
}
export function applyDemoSettings(data:Workspace,settings:SavedSettings):Workspace{
 const next=structuredClone(data);next.settings=settings;next.capacity=settings.capacity;next.blocked=settings.blocked;
 next.messages.filter(m=>m.status==='pending'&&(m.kind==='reminder'||m.body.includes('reminder:'))).forEach(m=>m.status='cancelled');
 for(const a of next.appointments.filter(a=>['awaiting_confirmation','confirmed','reschedule_requested'].includes(a.status))){
  for(const days of [...new Set(settings.reminderDays)]){const due=format(addDays(parseISO(a.date),-days),'yyyy-MM-dd')+'T06:00:00.000Z';if(due>new Date().toISOString())next.messages.push({id:crypto.randomUUID(),patientId:a.patientId,appointmentId:a.id,body:`Reminder: your appointment at ${settings.clinicName} is on ${a.date}. ${settings.contactNumber}`,status:'pending',simulated:true,scheduledFor:due,kind:'reminder'});}
 }
 return next;
}
