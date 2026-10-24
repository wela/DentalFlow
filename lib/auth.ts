import { createClient } from "@/lib/supabase/server";
import { cookies,headers } from 'next/headers';

export async function authenticatedClinic() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const explicit=(await headers()).get('x-clinic-id');
  const selected=explicit||(await cookies()).get('dentaflow-clinic')?.value;
  let query=supabase.from("clinic_memberships").select("clinic_id,role").eq("user_id", user.id);
  if(selected)query=query.eq('clinic_id',selected);
  let { data: membership } = await query.order('created_at').limit(1).maybeSingle();
  if(!membership&&selected&&!explicit){const fallback=await supabase.from('clinic_memberships').select('clinic_id,role').eq('user_id',user.id).order('created_at').limit(1).maybeSingle();membership=fallback.data;}
  if (!membership) return null;
  return { supabase, user, clinicId: membership.clinic_id as string, role: membership.role as string };
}
