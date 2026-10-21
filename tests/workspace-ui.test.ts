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
it('shows past unfinished visits and requires confirmation after a swipe',async()=>{
 render(createElement(ClinicWorkspace,{view:'overview'}));
 const name=await screen.findByText('Ama Test');expect(screen.getByText('Past visits awaiting an outcome')).toBeTruthy();
 const row=name.closest('button')!.parentElement!;
 fireEvent.touchStart(row,{touches:[{clientX:220,clientY:40}]});fireEvent.touchEnd(row,{changedTouches:[{clientX:80,clientY:44}]});
 expect(JSON.parse(localStorage.getItem(key)!).appointments[0].status).toBe('confirmed');
 fireEvent.click(await screen.findByRole('button',{name:'Confirm completion'}));
 await waitFor(()=>expect(JSON.parse(localStorage.getItem(key)!).appointments[0].status).toBe('completed'));
 expect(JSON.parse(localStorage.getItem(key)!).appointments[0].completedAt).toBeTruthy();
});
it('edits a patient without rewriting previous visit records',async()=>{
 render(createElement(ClinicWorkspace,{view:'patients'}));fireEvent.click(await screen.findByText('Ama Test'));fireEvent.click(screen.getByRole('button',{name:'Edit patient'}));
 fireEvent.change(screen.getByLabelText('Phone'),{target:{value:'+233244999999'}});
 fireEvent.change(screen.getByLabelText('Follow-up interval (weeks)'),{target:{value:'6'}});
 fireEvent.submit(screen.getByRole('button',{name:'Save patient'}).closest('form')!);
 await waitFor(()=>expect(JSON.parse(localStorage.getItem(key)!).patients[0].phone).toBe('+233244999999'));
 expect(JSON.parse(localStorage.getItem(key)!).appointments).toEqual(fixture.appointments);
});
