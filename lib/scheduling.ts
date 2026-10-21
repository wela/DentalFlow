import { addWeeks, format, getDay, parseISO } from "date-fns";
import type { Appointment } from "./types";

export const ACTIVE_STATUSES = ["pending_approval", "awaiting_confirmation", "confirmed", "reschedule_requested"] as const;

export type SchedulingInput = {
  lastCompletedDate: string;
  intervalWeeks: number;
  workingDays: number[];
  capacity: number;
  appointments: Appointment[];
  blockedDates?: string[];
  windowDays?: number;
};

export type Suggestion = { date: string; booked: number; capacity: number; available: number; offsetDays: number; reason: string };

export function recommendedDate(lastCompletedDate: string, intervalWeeks: number) {
  return format(addWeeks(parseISO(lastCompletedDate), intervalWeeks), "yyyy-MM-dd");
}

export function activeBookingsOn(date: string, appointments: Appointment[]) {
  return appointments.filter(a => a.date === date && ACTIVE_STATUSES.includes(a.status as typeof ACTIVE_STATUSES[number])).length;
}

export function suggestDates(input: SchedulingInput, limit = 4): Suggestion[] {
  const target = parseISO(recommendedDate(input.lastCompletedDate, input.intervalWeeks));
  const blocked = new Set(input.blockedDates ?? []);
  const windowDays = input.windowDays ?? 14;
  const results: Suggestion[] = [];
  for (let offset = 0; offset <= windowDays && results.length < limit; offset++) {
    for (const direction of offset === 0 ? [0] : [offset, -offset]) {
      const candidate = new Date(target);
      candidate.setDate(candidate.getDate() + direction);
      const date = format(candidate, "yyyy-MM-dd");
      if (!input.workingDays.includes(getDay(candidate)) || blocked.has(date)) continue;
      const booked = activeBookingsOn(date, input.appointments);
      if (booked >= input.capacity) continue;
      results.push({ date, booked, capacity: input.capacity, available: input.capacity - booked, offsetDays: direction, reason: direction === 0 ? "Exact recommended follow-up date with capacity available." : `${Math.abs(direction)} day${Math.abs(direction) === 1 ? "" : "s"} ${direction > 0 ? "after" : "before"} the clinical target; capacity is available.` });
      if (results.length >= limit) break;
    }
  }
  return results.sort((a, b) => Math.abs(a.offsetDays) - Math.abs(b.offsetDays) || b.offsetDays - a.offsetDays);
}

const transitions: Record<string, string[]> = {
  draft: ["pending_approval", "cancelled"], pending_approval: ["awaiting_confirmation", "cancelled"],
  awaiting_confirmation: ["confirmed", "reschedule_requested", "cancelled"], confirmed: ["completed", "no_show", "reschedule_requested", "cancelled"],
  reschedule_requested: ["awaiting_confirmation", "cancelled"], cancelled: [], completed: [], no_show: ["pending_approval"]
};
export const canTransition = (from: string, to: string) => transitions[from]?.includes(to) ?? false;
