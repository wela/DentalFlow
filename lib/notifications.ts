import { createHash, randomUUID } from "crypto";

export type Message = { to: string; body: string; idempotencyKey: string };
export type DeliveryResult = { providerId: string; status: "sent" | "delivered" | "failed"; detail?: string };
export interface MessagingProvider { readonly name: string; send(message: Message): Promise<DeliveryResult>; }

export class MockSmsProvider implements MessagingProvider {
  readonly name = "mock";
  async send(message: Message): Promise<DeliveryResult> {
    return { providerId: `mock_${randomUUID()}`, status: "delivered", detail: `Simulated only; nothing sent to ${message.to}` };
  }
}

export class HttpSmsProvider implements MessagingProvider {
  readonly name = "http";
  constructor(private endpoint: string, private apiKey: string, private senderId: string) {}
  async send(message: Message): Promise<DeliveryResult> {
    if (process.env.MESSAGING_LIVE_ENABLED !== "true") throw new Error("Live messaging is disabled");
    const response = await fetch(this.endpoint, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` }, body: JSON.stringify({ to: message.to, message: message.body, senderId: this.senderId, idempotencyKey: message.idempotencyKey }) });
    if (!response.ok) return { providerId: "", status: "failed", detail: `Provider returned ${response.status}` };
    const data = await response.json() as { id?: string };
    return { providerId: data.id ?? message.idempotencyKey, status: "sent" };
  }
}

export const idempotencyKey = (...parts: string[]) => createHash("sha256").update(parts.join(":"), "utf8").digest("hex");
export const confirmationMessage = (name: string, date: string, link: string, time?: string) => `Hello ${name}, your dental appointment is scheduled for ${date}${time ? ` at ${time}` : ""}. Please confirm using ${link}. Thank you.`;
