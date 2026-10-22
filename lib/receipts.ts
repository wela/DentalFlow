import { createHmac,timingSafeEqual } from 'node:crypto';
export function verifyReceipt(body:string,timestamp:string|null,signature:string|null,secret:string|undefined,now=Date.now()){
 if(!secret||!timestamp||!signature||!/^\d+$/.test(timestamp)||!/^([a-f0-9]{64})$/i.test(signature))return false;
 if(Math.abs(now-Number(timestamp)*1000)>300000)return false;
 const expected=createHmac('sha256',secret).update(`${timestamp}.${body}`).digest();
 return timingSafeEqual(expected,Buffer.from(signature,'hex'));
}
