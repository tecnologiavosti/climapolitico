import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Crown } from "lucide-react";

export function VipBadge({ collapsed }: { collapsed?: boolean }) {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ["subscription-tier", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("subscriptions")
        .select("tier,status")
        .eq("user_id", user!.id)
        .maybeSingle();
      return data;
    },
  });

  if (data?.tier !== "vip") return null;

  return (
    <div
      className={`mx-2 my-2 flex items-center gap-2 rounded-md border border-amber-400/60 bg-gradient-to-r from-amber-500/20 to-yellow-500/20 px-3 py-2 text-amber-500 shadow-[0_0_20px_rgba(251,191,36,0.25)]`}
      title="Plano VIP — Acesso total sem limites"
    >
      <Crown className="h-4 w-4 shrink-0" />
      {!collapsed && <span className="text-sm font-semibold tracking-wide">VIP</span>}
    </div>
  );
}
