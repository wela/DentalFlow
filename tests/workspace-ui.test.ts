// @vitest-environment jsdom
import { createElement } from 'react';
import { render,screen,fireEvent,waitFor,cleanup } from '@testing-library/react';
import { beforeEach,afterEach,it,expect,vi } from 'vitest';
import { ClinicWorkspace } from '../components/clinic-workspace';
import type { Workspace } from '../lib/workflow';
vi.mock('../components/shell',()=>({Shell:({children}:{children:React.ReactNode})=>createElement('div',null,children),PageHeader:()=>null}));
const key='dentaflow-workspace-v2';
let fixture:Workspace;
beforeEach(()=>{
 vi.stubEnv('NEXT_PUBLIC_DEMO_MODE','true');
 fixture={patients:[{id:'p',name:'Ama Test',phone:'+233244123456',channel:'sms',consent:true,intervalWeeks:4,status:'active',registeredAt:'2026-01-01'}],appointments:[{id:'a',patientId:'p',date:'2020-01-03',status:'confirmed',type:'Visit'}],messages:[],history:[],capacity:8,blocked:[]};
 localStorage.setItem(key,JSON.stringify(fixture));
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_key:string,fn:()=>void)=>fn()}});
 HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','')};HTMLDialogElement.prototype.close=function(){this.removeAttribute('open')};
});
afterEach(()=>{cleanup();localStorage.clear();vi.unstubAllEnvs()});
it('shows past unfinished visits and completes one with a left swipe',async()=>{
 render(createElement(ClinicWorkspace,{view:'overview'}));
 const name=await screen.findByText('Ama Test');expect(screen.getByText('Needs rescheduling')).toBeTruthy();
 const row=name.closest('button')!.parentElement!;
 fireEvent.touchStart(row,{touches:[{clientX:220,clientY:40}]});fireEvent.touchEnd(row,{changedTouches:[{clientX:80,clientY:44}]});
  await waitFor(()=>expect(JSON.parse(localStorage.getItem(key)!).appointments[0].status).toBe('completed'));
 expect(JSON.parse(localStorage.getItem(key)!).appointments[0].completedAt).toBeTruthy();
});
it('edits a patient without rewriting previous visit records',async()=>{
 render(createElement(ClinicWorkspace,{view:'patients'}));fireEvent.click(await screen.findByText('Ama Test'));fireEvent.click(screen.getByRole('button',{name:'Edit patient'}));
 fireEvent.change(screen.getByLabelText('Phone'),{target:{value:'+233244999999'}});
 fireEvent.click(screen.getByRole('radio',{name:'6 weeks'}));
 fireEvent.submit(screen.getByRole('button',{name:'Save patient'}).closest('form')!);
 await waitFor(()=>expect(JSON.parse(localStorage.getItem(key)!).patients[0].phone).toBe('+233244999999'));
 expect(JSON.parse(localStorage.getItem(key)!).patients[0].intervalWeeks).toBe(6);
 expect(JSON.parse(localStorage.getItem(key)!).appointments).toEqual(fixture.appointments);
});
it('prepares the coming Friday on non-clinic days',async()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-28T09:00:00Z'));
 localStorage.setItem(key,JSON.stringify({...fixture,patients:[...fixture.patients,{...fixture.patients[0],id:'due',name:'Kofi Due',phone:'+233244000111'}],appointments:[{id:'a',patientId:'p',date:'2026-10-30',status:'awaiting_confirmation',type:'Visit'},{id:'old',patientId:'due',date:'2026-09-25',status:'completed',completedAt:'2026-09-25T10:00:00Z',type:'Visit'}]}));
 render(createElement(ClinicWorkspace,{view:'overview'}));
 expect(await screen.findByText('Getting ready for Friday 30 October')).toBeTruthy();
 expect(screen.getByRole('link',{name:/\+233244123456/}).getAttribute('href')).toBe('tel:+233244123456');
 fireEvent.click(screen.getByRole('button',{name:'Book Fri 30 Oct'}));
 await waitFor(()=>expect(JSON.parse(localStorage.getItem(key)!).appointments.some((a:{patientId:string;date:string})=>a.patientId==='due'&&a.date==='2026-10-30')).toBe(true));
 vi.useRealTimers();
});
it('reschedules with a right swipe and rebooks missed visits in one tap',async()=>{
 render(createElement(ClinicWorkspace,{view:'overview'}));
 const row=(await screen.findByText('Ama Test')).closest('button')!.parentElement!;
 fireEvent.touchStart(row,{touches:[{clientX:80,clientY:40}]});fireEvent.touchEnd(row,{changedTouches:[{clientX:220,clientY:44}]});
 expect(await screen.findByText('Choose another Friday')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Close dialog'}));
 fireEvent.click(screen.getByRole('button',{name:/^Book Fri/}));
 await waitFor(()=>expect(JSON.parse(localStorage.getItem(key)!).appointments[0].date>'2020-01-03').toBe(true));
 expect(JSON.parse(localStorage.getItem(key)!).appointments[0].status).toBe('awaiting_confirmation');
 expect(JSON.parse(localStorage.getItem(key)!).history.map((h:{action:string})=>h.action)).toEqual(['attendance not recorded','rescheduled from','reschedule']);
});
it('offers the next follow-up Friday after completion',async()=>{
 render(createElement(ClinicWorkspace,{view:'overview'}));
 fireEvent.click(await screen.findByRole('button',{name:'Was seen'}));
 expect(await screen.findByText('Book Ama Test’s next visit')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:/^In 4 weeks/}));
 await waitFor(()=>expect(JSON.parse(localStorage.getItem(key)!).appointments).toHaveLength(2));
 const next=JSON.parse(localStorage.getItem(key)!).appointments[1];
 expect(next.status).toBe('awaiting_confirmation');expect(Date.parse(next.date)-Date.now()).toBeGreaterThan(27*864e5);
 expect(screen.queryByText('Book Ama Test’s next visit')).toBeNull();
});
it('keeps a patient on the Overview after Not now until the next visit is booked',async()=>{
 render(createElement(ClinicWorkspace,{view:'overview'}));
 fireEvent.click(await screen.findByRole('button',{name:'Was seen'}));
 fireEvent.click(await screen.findByRole('button',{name:'Not now'}));
 expect(await screen.findByText(/next visit not booked/)).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Book next visit'}));
 const custom=screen.getByLabelText('Custom date');
 fireEvent.change(custom,{target:{value:'2099-01-01'}});expect(screen.getByText('The clinic is open on Fridays. Choose a Friday.')).toBeTruthy();
 fireEvent.change(custom,{target:{value:'2099-01-02'}});fireEvent.click(screen.getByRole('button',{name:'Book'}));
 await waitFor(()=>expect(JSON.parse(localStorage.getItem(key)!).appointments.some((a:{date:string})=>a.date==='2099-01-02')).toBe(true));
 expect(screen.queryByText(/next visit not booked/)).toBeNull();
});
it('frees the slot with Not now when rescheduling and lists the patient for later',async()=>{
 localStorage.setItem(key,JSON.stringify({...fixture,appointments:[{id:'a',patientId:'p',date:'2099-01-02',status:'awaiting_confirmation',type:'Visit'}]}));
 render(createElement(ClinicWorkspace,{view:'patients'}));fireEvent.click(await screen.findByText('Ama Test'));
 fireEvent.click(screen.getAllByRole('button',{name:'Reschedule'})[0]);
 fireEvent.click(screen.getByRole('button',{name:/^Not now/}));
 await waitFor(()=>expect(JSON.parse(localStorage.getItem(key)!).appointments[0].status).toBe('cancelled'));
 cleanup();render(createElement(ClinicWorkspace,{view:'overview'}));
 expect(await screen.findByText(/Was booked for .* next visit not booked/)).toBeTruthy();
});
it('records a missed visit as a no-show with Not now',async()=>{
 render(createElement(ClinicWorkspace,{view:'overview'}));
 fireEvent.click(await screen.findByRole('button',{name:'Other date'}));fireEvent.click(screen.getByRole('button',{name:/^Not now/}));
 await waitFor(()=>expect(JSON.parse(localStorage.getItem(key)!).appointments[0].status).toBe('no_show'));
 expect(await screen.findByText(/Missed .* next visit not booked/)).toBeTruthy();
 expect(JSON.parse(localStorage.getItem(key)!).messages).toHaveLength(0);
});
it('finishes a Friday: Seen completes, Didn’t come becomes a no-show to reschedule',async()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-30T16:00:00Z'));
 localStorage.setItem(key,JSON.stringify({...fixture,patients:[...fixture.patients,{...fixture.patients[0],id:'q',name:'Kojo Late',phone:'+233244000222'}],appointments:[{id:'a',patientId:'p',date:'2026-10-30',status:'awaiting_confirmation',type:'Visit'},{id:'b',patientId:'q',date:'2026-10-30',status:'awaiting_confirmation',type:'Visit'}]}));
 render(createElement(ClinicWorkspace,{view:'overview'}));
 expect(await screen.findByText('2 patients are not marked yet. Sort them out before you leave.')).toBeTruthy();
 fireEvent.click(screen.getAllByRole('button',{name:'Finish the day'})[0]);
 fireEvent.click(screen.getAllByRole('button',{name:'Didn’t come'})[1]);
 await waitFor(()=>expect(JSON.parse(localStorage.getItem(key)!).appointments[1].status).toBe('no_show'));
 fireEvent.click(screen.getByRole('button',{name:'Seen'}));
 await waitFor(()=>expect(JSON.parse(localStorage.getItem(key)!).appointments[0].status).toBe('completed'));
 expect(await screen.findByText('All patients are marked. Enjoy your evening.')).toBeTruthy();
 expect(screen.getByText(/Missed .* next visit not booked/)).toBeTruthy();
 vi.useRealTimers();
});
it('adds walk-ins: an existing patient or a new one typed with a local number',async()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-30T09:00:00Z'));
 localStorage.setItem(key,JSON.stringify({...fixture,appointments:[]}));
 render(createElement(ClinicWorkspace,{view:'overview'}));
 fireEvent.click(await screen.findByRole('button',{name:'+ Walk-in'}));
 fireEvent.change(screen.getByLabelText('Find patient'),{target:{value:'0244123456'}});
 fireEvent.click(screen.getByRole('button',{name:'Add to today'}));
 await waitFor(()=>expect(JSON.parse(localStorage.getItem(key)!).appointments[0]).toMatchObject({patientId:'p',date:'2026-10-30'}));
 fireEvent.click(await screen.findByRole('button',{name:'+ Walk-in'}));
 fireEvent.change(screen.getByLabelText('Full name'),{target:{value:'Yaw New'}});fireEvent.change(screen.getByLabelText('Phone'),{target:{value:'020 111 2222'}});
 fireEvent.submit(screen.getByRole('button',{name:'Register and add to today'}).closest('form')!);
 await waitFor(()=>expect(JSON.parse(localStorage.getItem(key)!).appointments).toHaveLength(2));
 const yaw=JSON.parse(localStorage.getItem(key)!).patients.find((p:{name:string})=>p.name==='Yaw New');
 expect(yaw.phone).toBe('+233201112222');expect(JSON.parse(localStorage.getItem(key)!).appointments[1]).toMatchObject({patientId:yaw.id,date:'2026-10-30'});
 vi.useRealTimers();
});
it('offers Fridays right after registering a patient',async()=>{
 render(createElement(ClinicWorkspace,{view:'patients'}));fireEvent.click(await screen.findByRole('button',{name:'Register patient'}));
 fireEvent.change(screen.getByLabelText('Full name'),{target:{value:'Efua New'}});fireEvent.change(screen.getByLabelText('Phone'),{target:{value:'0244555666'}});
 fireEvent.submit(screen.getByRole('button',{name:'Save patient'}).closest('form')!);
 expect(await screen.findByText('Schedule Efua New')).toBeTruthy();
});
