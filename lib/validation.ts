import { z } from "zod";

export const patientSchema = z.object({
  name: z.string().trim().min(2, "Enter the patient's full name"),
  phone: z.string().regex(/^\+[1-9]\d{7,14}$/, "Use international format, for example +233244123456"),
  email: z.string().email().optional().or(z.literal("")),
  channel: z.enum(["sms", "whatsapp", "email"]),
  consent: z.boolean(),
  intervalWeeks: z.coerce.number().int().min(1).max(52)
});

export const appointmentSchema = z.object({ patientId: z.string().min(1), date: z.string().date(), time: z.string().optional(), type: z.string().min(1), status: z.enum(["draft", "pending_approval", "awaiting_confirmation", "confirmed"]) });
