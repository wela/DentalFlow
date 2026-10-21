import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
const hits=new Map<string,{count:number;reset:number}>();
export async function middleware(req:NextRequest){
  // Cron authenticates with CRON_SECRET in the route, not a browser session.
  if(req.nextUrl.pathname==='/api/notifications/process')return NextResponse.next();
  if(req.nextUrl.pathname.startsWith("/api/")){const key=req.headers.get("x-forwarded-for")??"local";const now=Date.now(),current=hits.get(key);if(!current||current.reset<now)hits.set(key,{count:1,reset:now+60_000});else if(++current.count>60)return NextResponse.json({error:"Too many requests"},{status:429})}
  if(process.env.NEXT_PUBLIC_DEMO_MODE!=="false"||!process.env.NEXT_PUBLIC_SUPABASE_URL||!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)return NextResponse.next();
  let response=NextResponse.next({request:req});
  const supabase=createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{cookies:{getAll:()=>req.cookies.getAll(),setAll(values:{name:string;value:string;options:CookieOptions}[]){values.forEach(({name,value})=>req.cookies.set(name,value));response=NextResponse.next({request:req});values.forEach(({name,value,options})=>response.cookies.set(name,value,options))}}});
  const {data:{user}}=await supabase.auth.getUser();
  const publicPath=req.nextUrl.pathname.startsWith("/login")||req.nextUrl.pathname.startsWith("/auth/")||req.nextUrl.pathname.startsWith("/confirm/")||req.nextUrl.pathname.startsWith("/api/confirm/");
  if(!user&&!publicPath)return NextResponse.redirect(new URL("/login",req.url));
  if(user&&req.nextUrl.pathname==="/login")return NextResponse.redirect(new URL("/",req.url));
  return response;
}
export const config={matcher:["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"]};
