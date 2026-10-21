import { describe,expect,it } from "vitest";
import { confirmationMessage,idempotencyKey,MockSmsProvider } from "../lib/notifications";
describe("notifications",()=>{it("omits appointment time when absent",()=>expect(confirmationMessage("Ama","30 Oct","link")).not.toContain(" at "));it("creates stable idempotency keys",()=>expect(idempotencyKey("a","confirmation")).toBe(idempotencyKey("a","confirmation")));it("mock never calls a live gateway",async()=>expect((await new MockSmsProvider().send({to:"+233000000000",body:"test",idempotencyKey:"1"})).status).toBe("delivered"))});
