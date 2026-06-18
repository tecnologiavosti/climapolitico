import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

export const useAdminAudit = () => {
  const { user } = useAuth();
  const log = async (
    action: string,
    target_type?: string,
    target_id?: string,
    metadata: Record<string, any> = {}
  ) => {
    if (!user) return;
    try {
      await supabase.from("admin_audit_logs").insert({
        admin_id: user.id,
        admin_email: user.email ?? null,
        action,
        target_type: target_type ?? null,
        target_id: target_id ?? null,
        metadata,
        user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      });
    } catch (e) {
      console.warn("[audit] failed to log", action, e);
    }
  };
  return { log };
};
