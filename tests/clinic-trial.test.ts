// @vitest-environment jsdom
import { createElement } from 'react';
import { render,screen,fireEvent,waitFor,cleanup } from '@testing-library/react';
import { beforeEach,afterEach,it,expect,vi } from 'vitest';
import { ClinicWorkspace } from '../components/clinic-workspace';
import SettingsPage from '../app/settings/page';
vi.mock('../components/shell',()=>({Shell:({children}:{children:React.ReactNode})=>createElement('div',null,children),PageHeader:()=>null}));
const key='dentaflow-workspace-v2';
const state=()=>JSON.parse(localStorage.getItem(key)!);
beforeEach(()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-30T09:00:00Z'));vi.stubEnv('NEXT_PUBLIC_DEMO_MODE','true');localStorage.clear();
 localStorage.setItem(key,JSON.stringify({patients:[{id:'waiting',name:'Waiting Patient',phone:'+233244123456',channel:'sms',consent:true,intervalWeeks:4,status:'active',registeredAt:'2026-01-01'}],appointments:[],messages:[],history:[],capacity:1,blocked:[]}));
 localStorage.setItem('dentaflow-settings-v1',JSON.stringify({clinicName:'Trial Clinic',contactNumber:'',capacity:1,blocked:[],reminderDays:[7,2,1],provider:'mock',messagingEnabled:false}));
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_key:string,fn:()=>void)=>fn()}});
 HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','')};HTMLDialogElement.prototype.close=function(){this.removeAttribute('open')};
});
afterEach(()=>{cleanup();localStorage.clear();vi.useRealTimers();vi.unstubAllEnvs()});
it('runs registration, full Friday, completion, undo, reschedule and cancellation through the UI',async()=>{
 render(createElement(ClinicWorkspace,{view:'patients'}));fireEvent.click(await screen.findByRole('button',{name:'Register patient'}));
 fireEvent.change(screen.getByLabelText('Full name'),{target:{value:'Trial Patient'}});fireEvent.change(screen.getByLabelText('Phone'),{target:{value:'+233244987654'}});
 fireEvent.submit(screen.getByRole('button',{name:'Save patient'}).closest('form')!);await waitFor(()=>expect(state().patients.length).toBe(2));cleanup();
 render(createElement(ClinicWorkspace,{view:'calendar'}));fireEvent.change(await screen.findByLabelText('Find patient to add'),{target:{value:'trial'}});fireEvent.click(screen.getByRole('button',{name:'Add'}));await waitFor(()=>expect(state().appointments.length).toBe(1));
 fireEvent.change(screen.getByLabelText('Find patient to add'),{target:{value:'waiting'}});fireEvent.click(screen.getByRole('button',{name:'Add'}));expect(await screen.findByText('This Friday is full')).toBeTruthy();expect(state().appointments.length).toBe(1);cleanup();
 render(createElement(ClinicWorkspace,{view:'overview'}));fireEvent.click(await screen.findByRole('button',{name:'Complete'}));await waitFor(()=>expect(state().appointments[0].status).toBe('completed'));
 fireEvent.click(screen.getByRole('button',{name:'Undo completion'}));await waitFor(()=>expect(state().appointments[0].status).toBe('awaiting_confirmation'));
 fireEvent.click(screen.getByRole('button',{name:'Reschedule'}));fireEvent.click(await screen.findByRole('button',{name:/Fri, 6 Nov 2026/}));await waitFor(()=>expect(state().appointments[0].date).toBe('2026-11-06'));cleanup();
 render(createElement(ClinicWorkspace,{view:'calendar'}));fireEvent.click(await screen.findByRole('button',{name:'6 Nov'}));fireEvent.click(await screen.findByText('Trial Patient'));fireEvent.click(screen.getByRole('button',{name:'Cancel appointment'}));fireEvent.click(screen.getByRole('button',{name:'Confirm cancellation'}));await waitFor(()=>expect(state().appointments[0].status).toBe('cancelled'));
 expect(state().messages.every((m:{simulated:boolean})=>m.simulated)).toBe(true);expect(state().messages.filter((m:{status:string})=>m.status==='pending')).toHaveLength(0);
 expect(state().history.map((h:{action:string})=>h.action)).toContain('completion undone');
});
it('reviews settings impact before changing capacity and regenerating reminders',async()=>{
 const d=state();d.appointments=[{id:'a',patientId:'waiting',date:'2026-11-06',status:'confirmed',type:'Visit'}];localStorage.setItem(key,JSON.stringify(d));
 render(createElement(SettingsPage));await screen.findByRole('button',{name:'Review changes'});
 fireEvent.click(screen.getByRole('button',{name:'6 Nov'}));fireEvent.click(screen.getByRole('checkbox',{name:'1 week before'}));
 fireEvent.click(screen.getByRole('button',{name:'Review changes'}));expect(screen.getByText('1 bookings fall on unavailable dates.')).toBeTruthy();expect((screen.getByRole('button',{name:'Save settings'}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(screen.getByRole('checkbox',{name:/I will review affected bookings/}));fireEvent.click(screen.getByRole('button',{name:'Save settings'}));await waitFor(()=>expect(state().blocked).toEqual(['2026-11-06']));expect(state().appointments).toEqual(d.appointments);expect(state().messages).toHaveLength(2);
});
