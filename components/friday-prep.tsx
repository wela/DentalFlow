import { format, parseISO } from 'date-fns';
import { Phone } from 'lucide-react';
import type { Appointment, Patient } from '@/lib/types';
import { active, followUps, notBooked, todayAccra, type Workspace } from '@/lib/workflow';

const short=(date:string)=>format(parseISO(date),'EEE d MMM');

// Shown on non-clinic days: what still needs doing before the coming Friday.
export function FridayPrep({data,friday,busy,openVisit,book,chooseDate}:{data:Workspace;friday:string;busy:boolean;openVisit:(a:Appointment)=>void;book:(patientId:string,date:string)=>void;chooseDate:(p:Patient)=>void}){
 const visits=data.appointments.filter(a=>a.date===friday&&active(a));
 const free=data.blocked.includes(friday)?0:Math.max(0,data.capacity-visits.length);
 const waiting=notBooked(data).map(w=>w.patient.id), due=followUps(data).filter(r=>r.target<=friday&&!waiting.includes(r.patient.id)).sort((a,b)=>a.target.localeCompare(b.target));
 const patient=(id:string)=>data.patients.find(p=>p.id===id);
 const stats=[['Booked',`${visits.length} / ${data.capacity}`],['Free slots',free],['Due for follow-up',due.length]] as const;
 return <>
  <section className="card mb-6 overflow-hidden" aria-label="Friday preparation"><header className="bg-teal-50 p-5"><h2 className="text-2xl font-bold">Getting ready for {format(parseISO(friday),'EEEE d MMMM')}</h2>{data.blocked.includes(friday)&&<p className="text-sm text-rose-700">This Friday is closed in Settings.</p>}</header>
   <dl className="grid grid-cols-3 divide-x divide-slate-100">{stats.map(([name,value])=><div key={name} className="p-5"><dt className="text-sm text-slate-500">{name}</dt><dd className="text-2xl font-bold">{value}</dd></div>)}</dl></section>
  <section className="card mb-5 p-5"><h2 className="text-xl font-bold">Booked for {short(friday)}</h2><p className="mb-3 text-sm text-slate-500">Each patient was sent an SMS with the date.</p>
   {visits.map(a=>{const p=patient(a.patientId);return <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 border-t py-3"><button className="text-left" onClick={()=>openVisit(a)}><b className="block text-teal-700 underline decoration-teal-200 underline-offset-4">{p?.name||'Patient'}</b><span className="text-sm text-slate-500">Tap to complete or reschedule</span></button>{p&&<a className="btn-secondary" href={`tel:${p.phone}`}><Phone size={16}/> {p.phone}</a>}</div>})}
   {!visits.length&&<p className="text-sm text-slate-500">No one is booked for {short(friday)} yet.</p>}</section>
  <section className="card mb-5 p-5"><h2 className="text-xl font-bold">Fill empty slots</h2><p className="mb-3 text-sm text-slate-500">{free?`${free} free ${free===1?'slot':'slots'} on ${short(friday)}. These patients are due for a follow-up by then.`:`${short(friday)} is full. Book these patients on a later Friday.`}</p>
   {due.map(r=><div key={r.patient.id} className="flex flex-wrap items-center justify-between gap-3 border-t py-3"><div><b>{r.patient.name}</b><p className="text-sm text-slate-500">Due {short(r.target)}{r.target<todayAccra()?' · overdue':''}</p></div><div className="flex flex-wrap gap-2">{free>0&&<button className="btn-primary" disabled={busy} onClick={()=>book(r.patient.id,friday)}>Book {short(friday)}</button>}<button className="btn-secondary" onClick={()=>chooseDate(r.patient)}>Other date</button></div></div>)}
   {!due.length&&<p className="text-sm text-slate-500">No follow-ups are due by {short(friday)}.</p>}</section>
 </>;
}
