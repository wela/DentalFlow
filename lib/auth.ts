import { createClient } from "@/lib/supabase/server";

export async function authenticatedClinic() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: membership } = await supabase.from("clinic_memberships").select("clinic_id,role").eq("user_id", user.id).limit(1).maybeSingle();
  if (!membership) return null;
  return { supabase, user, clinicId: membership.clinic_id as string, role: membership.role as string };
}
