export function nextDailyRun(now=new Date()){
 const next=new Date(now);next.setUTCHours(6,0,0,0);if(next<=now)next.setUTCDate(next.getUTCDate()+1);return next.toISOString();
}
