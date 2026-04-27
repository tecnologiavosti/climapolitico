import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * Retorna true apenas se o perfil do usuário logado tiver `show_tooltips = true`.
 * Usado para exibir tooltips explicativos somente para a conta de demonstração.
 */
export function useTooltipsEnabled(): boolean {
  const { user } = useAuth();
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let active = true;
    if (!user) {
      setEnabled(false);
      return;
    }
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("show_tooltips")
        .eq("id", user.id)
        .maybeSingle();
      if (active) setEnabled(Boolean((data as any)?.show_tooltips));
    })();
    return () => {
      active = false;
    };
  }, [user]);

  return enabled;
}
