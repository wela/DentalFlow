import type { Appointment } from '@/lib/types';
import { active,todayAccra } from '@/lib/workflow';
export function TodayQueue({appointments,renderVisit}:{appointments:Appointment[];renderVisit:(a:Appointment)=>React.ReactNode}){
 const today=appointments.filter(a=>a.date===todayAccra());
 const groups=[{title:'Expected',rows:today.filter(a=>active(a)&&!a.arrivedAt)},{title:'Arrived',rows:today.filter(a=>active(a)&&a.arrivedAt).sort((a,b)=>a.arrivedAt!.localeCompare(b.arrivedAt!))},{title:'Completed',rows:today.filter(a=>a.status==='completed')}];
 return <section className="card mb-6 overflow-hidden" aria-label="Today queue"><header className="bg-teal-50 p-5"><h2 className="text-2xl font-bold">Today’s queue</h2><p className="text-sm text-slate-600">{todayAccra()} · {groups.map(g=>`${g.rows.length} ${g.title.toLowerCase()}`).join(' · ')}</p></header><div className="grid divide-y divide-slate-100">{groups.map(g=><section key={g.title} aria-label={g.title}><h3 className="px-5 pt-4 font-semibold">{g.title} ({g.rows.length})</h3>{g.rows.length?g.rows.map(renderVisit):<p className="px-5 pb-4 pt-2 text-sm text-slate-500">No patients in this stage.</p>}</section>)}</div></section>;
}
