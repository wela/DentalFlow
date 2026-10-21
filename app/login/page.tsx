import { redirect } from "next/navigation";
import { isDemoMode, isSupabaseConfigured } from "@/lib/supabase/config";
import { signIn } from "./actions";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (isDemoMode()) redirect("/");
  const { error } = await searchParams;
  const configured = isSupabaseConfigured();
  return <main className="grid min-h-screen place-items-center bg-teal-50 p-4"><section className="card w-full max-w-md p-7">
    <div className="mb-7 text-center"><span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-teal-600 text-2xl text-white">✦</span><h1 className="text-2xl font-bold">Sign in to DentaFlow</h1><p className="mt-1 text-sm text-slate-500">Secure clinic staff access</p></div>
    {!configured && <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Supabase environment variables have not been configured.</p>}
    {error && <p role="alert" className="mb-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
    <form action={signIn} className="space-y-4"><label><span className="mb-1 block text-sm font-medium">Email address</span><input className="input" name="email" type="email" autoComplete="email" required/></label><label><span className="mb-1 block text-sm font-medium">Password</span><input className="input" name="password" type="password" autoComplete="current-password" required/></label><button className="btn-primary w-full" disabled={!configured}>Sign in securely</button></form>
    <p className="mt-5 text-center text-xs text-slate-400">Patient records are restricted to authorized clinic staff.</p>
  </section></main>;
}
