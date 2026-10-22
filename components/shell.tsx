"use client";
import { Bell, CalendarDays, LayoutDashboard, Menu, Settings, Users, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const nav = [
  ["/", "Overview", LayoutDashboard], ["/calendar", "Calendar", CalendarDays], ["/patients", "Patients", Users],
  ["/settings", "Settings", Settings]
] as const;

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname(); const [open, setOpen] = useState(false);
  const sidebar = <aside className="flex h-full w-64 flex-col bg-[#123f40] px-4 py-6 text-white">
    <Link href="/" className="mb-9 flex items-center gap-3 px-2"><span className="grid h-10 w-10 place-items-center rounded-xl bg-white/15 text-2xl">✦</span><span><b className="block text-xl tracking-tight">DentaFlow</b><small className="text-teal-100">Clinic workspace</small></span></Link>
    <nav className="space-y-1">{nav.map(([href, label, Icon]) => <Link key={href} href={href} onClick={() => setOpen(false)} className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium ${path === href ? "bg-white text-[#123f40]" : "text-teal-50 hover:bg-white/10"}`}><Icon size={18}/>{label}</Link>)}</nav>
    <div className="mt-auto rounded-xl bg-white/10 p-3 text-xs text-teal-50">{process.env.NEXT_PUBLIC_DEMO_MODE!=='false'?<><b className="mb-1 block text-white">Demo mode</b>Messages are simulated. No real messages are sent.</>:<b>Clinic workspace · Africa/Accra</b>}</div>
  </aside>;
  return <div className="min-h-screen lg:flex"><div className="fixed inset-y-0 left-0 z-40 hidden lg:block">{sidebar}</div>{open && <div className="fixed inset-0 z-50 bg-black/30 lg:hidden" onClick={() => setOpen(false)}><div className="h-full w-64" onClick={e => e.stopPropagation()}>{sidebar}<button aria-label="Close menu" className="absolute left-[270px] top-4 rounded-full bg-white p-2 text-ink" onClick={() => setOpen(false)}><X size={18}/></button></div></div>}
    <main className="min-w-0 flex-1 lg:ml-64"><header className="sticky top-0 z-30 flex h-18 items-center justify-between border-b border-slate-200 bg-white/90 px-4 py-4 backdrop-blur md:px-8"><button className="rounded-lg p-2 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu/></button><div className="hidden sm:block"><p className="text-sm text-slate-500">Welcome back</p><b>DentaFlow clinic</b></div><div className="flex items-center gap-3"><Link href="/" className="rounded-xl border border-slate-200 p-2.5" aria-label="Attention required"><Bell size={19}/></Link><div className="grid h-10 w-10 place-items-center rounded-xl bg-teal-100 font-bold text-teal-700">DF</div></div></header><div className="p-4 md:p-8">{children}</div></main></div>;
}

export function PageHeader({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) { return <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><h1 className="text-2xl font-bold tracking-tight md:text-3xl">{title}</h1><p className="mt-1 text-sm text-slate-500">{description}</p></div>{action}</div> }
