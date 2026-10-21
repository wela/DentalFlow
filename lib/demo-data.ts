import { addDays, format, nextFriday, subWeeks } from "date-fns";
import type { Appointment, ClinicSettings, Patient } from "./types";

const today = new Date();
const friday = today.getDay() === 5 ? today : nextFriday(today);
const d = (offset: number) => format(addDays(friday, offset * 7), "yyyy-MM-dd");

export const settings: ClinicSettings = { clinicName: "DentaFlow Dental Clinic", timezone: "Africa/Accra", workingDays: [5], dailyCapacity: 8, defaultIntervalWeeks: 4, reminderDays: [7, 2, 1], messagingEnabled: false, smsPrice: 0.08 };

export const patients: Patient[] = [
  { id: "p1", name: "Ama Mensah", phone: "+233244123456", email: "ama@example.com", channel: "sms", consent: true, intervalWeeks: 4, status: "active", registeredAt: "2026-05-12" },
  { id: "p2", name: "Kwame Asante", phone: "+233205887421", channel: "sms", consent: true, intervalWeeks: 6, status: "active", registeredAt: "2026-06-03" },
  { id: "p3", name: "Efua Owusu", phone: "+233501229876", channel: "whatsapp", consent: true, intervalWeeks: 4, status: "active", registeredAt: "2026-06-18" },
  { id: "p4", name: "Kojo Boateng", phone: "+233277660122", channel: "sms", consent: false, intervalWeeks: 6, status: "active", registeredAt: "2026-07-02" },
  { id: "p5", name: "Akosua Frimpong", phone: "+233541723850", channel: "sms", consent: true, intervalWeeks: 4, status: "active", registeredAt: "2026-07-22" },
  { id: "p6", name: "Kofi Addo", phone: "+233242019330", channel: "sms", consent: true, intervalWeeks: 4, status: "active", registeredAt: "2026-08-09" },
  { id: "p7", name: "Adwoa Sarpong", phone: "+233551104802", channel: "sms", consent: true, intervalWeeks: 6, status: "active", registeredAt: "2026-08-14" },
  { id: "p8", name: "Yaw Ofori", phone: "+233209913444", channel: "sms", consent: true, intervalWeeks: 4, status: "active", registeredAt: "2026-08-21" }
];

export const appointments: Appointment[] = [
  { id: "a1", patientId: "p1", date: d(0), time: "09:00", status: "confirmed", type: "Follow-up", duration: 30 },
  { id: "a2", patientId: "p2", date: d(0), time: "09:30", status: "awaiting_confirmation", type: "Review", duration: 30 },
  { id: "a3", patientId: "p3", date: d(0), time: "10:00", status: "confirmed", type: "Follow-up", duration: 30 },
  { id: "a4", patientId: "p4", date: d(0), status: "reschedule_requested", type: "Consultation" },
  { id: "a5", patientId: "p5", date: d(0), status: "confirmed", type: "Follow-up" },
  { id: "a6", patientId: "p6", date: d(1), status: "awaiting_confirmation", type: "Follow-up" },
  { id: "a7", patientId: "p7", date: d(1), status: "confirmed", type: "Review" },
  { id: "a8", patientId: "p8", date: d(2), status: "confirmed", type: "Follow-up" },
  { id: "a9", patientId: "p3", date: format(subWeeks(friday, 1), "yyyy-MM-dd"), status: "no_show", type: "Review" },
  { id: "a10", patientId: "p1", date: format(subWeeks(friday, 5), "yyyy-MM-dd"), status: "completed", type: "Treatment", intervalWeeks: 4 }
];

export const mockMessages = [
  { id: "m1", patient: "Ama Mensah", type: "Confirmation", status: "delivered", at: "Today, 9:42 AM", body: "Hello Ama, your dental appointment is scheduled for Friday. Please confirm using your secure link. Thank you." },
  { id: "m2", patient: "Kwame Asante", type: "2-day confirmation", status: "sent", at: "Today, 10:15 AM", body: "Hello Kwame, please confirm your dental appointment scheduled for Friday using your secure link." },
  { id: "m3", patient: "Efua Owusu", type: "Reminder", status: "failed", at: "Yesterday, 4:20 PM", body: "Hello Efua, this is a reminder of your dental appointment on Friday." }
];
