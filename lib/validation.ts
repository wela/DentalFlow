import { z } from "zod";

// Staff type local numbers (024 412 3456); store them in international format.
export function ghanaPhone(value: string) {
  const digits = value.replace(/[\s()-]/g, "");
  return /^0\d{9}$/.test(digits) ? `+233${digits.slice(1)}` : digits;
}

export const patientSchema = z.object({
  name: z.string().trim().min(2, "Enter the patient's full name"),
  phone: z.preprocess(v => typeof v === "string" ? ghanaPhone(v) : v, z.string().regex(/^\+[1-9]\d{7,14}$/, "Enter a phone number such as 024 412 3456 or +233244123456")),
  email: z.string().email().optional().or(z.literal("")),
  channel: z.enum(["sms", "whatsapp", "email"]),
  consent: z.boolean(),
  intervalWeeks: z.coerce.number().int().min(1).max(52)
});

export const appointmentSchema = z.object({ patientId: z.string().min(1), date: z.string().date(), time: z.string().optional(), type: z.string().min(1), status: z.enum(["draft", "pending_approval", "awaiting_confirmation", "confirmed"]) });
