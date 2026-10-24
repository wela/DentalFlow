// @vitest-environment jsdom
import { beforeEach,afterEach,it,expect,vi } from 'vitest';
import { render,screen,fireEvent,waitFor,cleanup,within } from '@testing-library/react';
import { ClinicProvider,useClinic } from '../components/clinic-context';
import { ClinicWorkspace } from '../components/clinic-workspace';
vi.mock('../components/shell',()=>({Shell:({children}:{children:React.ReactNode})=><div>{children}</div>,PageHeader:()=>null}));
function Harness(){const {clinics,select}=useClinic();return <><nav>{clinics.map(c=><button key={c.id} onClick={()=>void select(c.id)}>Switch {c.name}</button>)}<button onClick={()=>void select('all')}>All Clinics</button></nav><ClinicWorkspace view="patients"/></>}
beforeEach(()=>{vi.stubEnv('NEXT_PUBLIC_DEMO_MODE','true');vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-24T08:00:00Z'));localStorage.clear();Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_key:string,fn:()=>void)=>fn()}});HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','')};HTMLDialogElement.prototype.close=function(){this.removeAttribute('open')};});
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllEnvs();localStorage.clear()});
it('switches clinic-specific patients, books a timed visit, edits a patient and preserves separation',async()=>{
 render(<ClinicProvider><Harness/></ClinicProvider>);
 fireEvent.click(await screen.findByRole('button',{name:'Switch Maritime Regional Hospital'}));
 fireEvent.click(await screen.findByRole('button',{name:'Register patient'}));fireEvent.change(screen.getByLabelText('Full name'),{target:{value:'Maritime Demo'}});fireEvent.change(screen.getByLabelText('Phone'),{target:{value:'+233244123456'}});fireEvent.submit(screen.getByRole('button',{name:'Save patient'}).closest('form')!);
 await waitFor(()=>expect(JSON.parse(localStorage.getItem('dentaflow-workspace-maritime')!).patients).toHaveLength(1));
 fireEvent.click(screen.getByRole('button',{name:'Book appointment'}));const dialog=screen.getByRole('dialog',{name:'Book appointment'});const patient=JSON.parse(localStorage.getItem('dentaflow-workspace-maritime')!).patients[0];fireEvent.change(within(dialog).getByLabelText('Patient'),{target:{value:patient.id}});fireEvent.click(await within(dialog).findByRole('button',{name:'10:00'}));fireEvent.submit(within(dialog).getByRole('button',{name:'Save appointment'}).closest('form')!);
 await waitFor(()=>expect(JSON.parse(localStorage.getItem('dentaflow-workspace-maritime')!).appointments[0]).toMatchObject({time:'10:00',duration:30,date:'2026-10-26'}));
 fireEvent.click(screen.getByRole('button',{name:/Maritime Demo.*233/}));fireEvent.click(screen.getByRole('button',{name:'Edit patient'}));fireEvent.change(screen.getByLabelText('Full name'),{target:{value:'Maritime Edited'}});fireEvent.submit(screen.getByRole('button',{name:'Save patient'}).closest('form')!);await screen.findByText('Maritime Edited');
 fireEvent.click(screen.getByRole('button',{name:'Switch Aura'}));await screen.findByRole('button',{name:'Register patient'});expect(screen.queryByText('Maritime Edited')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Switch Maritime Regional Hospital'}));expect(await screen.findByText('Maritime Edited')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'All Clinics'}));expect(await screen.findByText('Today and upcoming')).toBeTruthy();expect(screen.queryByRole('button',{name:'Register patient'})).toBeNull();expect(await screen.findByText('Maritime Edited')).toBeTruthy();
});
