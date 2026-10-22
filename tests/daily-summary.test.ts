import { it, expect, vi } from 'vitest';
import { dailySummaryText, sendDailySummaries } from '../lib/daily-summary';
it('writes a short Friday summary for the doctor',()=>{
 expect(dailySummaryText({date:'2026-10-30',booked:14,capacity:16,missed:1})).toBe('DentaFlow: Good morning. Today, Friday 30 October: 14 patients booked, 2 free slots. 1 patient from earlier Fridays still needs a new date.');
 expect(dailySummaryText({date:'2026-10-30',booked:1,capacity:1,missed:0})).toBe('DentaFlow: Good morning. Today, Friday 30 October: 1 patient booked, 0 free slots.');
});
it('sends nothing outside Fridays or without live SMS',async()=>{
 const db={from:vi.fn()};
 expect(await sendDailySummaries(db as never,new Date('2026-10-29T06:00:00Z'))).toBe(0);
 expect(await sendDailySummaries(db as never,new Date('2026-10-30T06:00:00Z'))).toBe(0);
 expect(db.from).not.toHaveBeenCalled();
});
