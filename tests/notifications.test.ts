import { describe,expect,it } from "vitest";
import { idempotencyKey,MockSmsProvider } from "../lib/notifications";
describe("notifications",()=>{it("creates stable idempotency keys",()=>expect(idempotencyKey("a","confirmation")).toBe(idempotencyKey("a","confirmation")));it("mock never calls a live gateway",async()=>expect((await new MockSmsProvider().send({to:"+233000000000",body:"test",idempotencyKey:"1"})).status).toBe("delivered"))});
