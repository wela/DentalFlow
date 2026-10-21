import { describe, expect, it } from "vitest";
import { activeBookingsOn, canTransition, recommendedDate, suggestDates } from "../lib/scheduling";
import type { Appointment } from "../lib/types";
const ap=(id:string,date:string,status:Appointment["status"]="confirmed",patientId="p1"):Appointment=>({id,date,status,patientId,type:"Follow-up"});
describe("scheduling engine",()=>{
 it("calculates four-week follow-up",()=>expect(recommendedDate("2026-10-02",4)).toBe("2026-10-30"));
 it("calculates six-week follow-up",()=>expect(recommendedDate("2026-10-02",6)).toBe("2026-11-13"));
 it("suggests Friday only",()=>expect(suggestDates({lastCompletedDate:"2026-10-01",intervalWeeks:4,workingDays:[5],capacity:8,appointments:[]})[0].date).toBe("2026-10-30"));
 it("skips blocked target date",()=>expect(suggestDates({lastCompletedDate:"2026-10-02",intervalWeeks:4,workingDays:[5],capacity:8,appointments:[],blockedDates:["2026-10-30"]})[0].date).toBe("2026-11-06"));
 it("skips a full date",()=>{const items=Array.from({length:8},(_,i)=>ap(String(i),"2026-10-30","confirmed",`p${i}`));expect(suggestDates({lastCompletedDate:"2026-10-02",intervalWeeks:4,workingDays:[5],capacity:8,appointments:items})[0].date).toBe("2026-11-06")});
 it("releases cancelled capacity",()=>expect(activeBookingsOn("2026-10-30",[ap("1","2026-10-30","confirmed"),ap("2","2026-10-30","cancelled")])).toBe(1));
 it("enforces valid transitions",()=>{expect(canTransition("confirmed","completed")).toBe(true);expect(canTransition("completed","confirmed")).toBe(false)});
});
