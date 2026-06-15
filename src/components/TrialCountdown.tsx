import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { getDaysLeft } from "@/lib/trial";

export function TrialCountdown() {
  const { user } = useAuth();
  const [daysLeft, setDaysLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!user) return;
    const update = () => setDaysLeft(getDaysLeft(user.id));
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, [user]);

  if (!user || daysLeft === null) return null;

  const expired = daysLeft === 0;

  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
        expired
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : "border-primary/30 bg-primary/10 text-primary"
      }`}
      title={expired ? "Teste gratuito expirado" : "Tempo restante do teste gratuito"}
    >
      <Clock className="h-3 w-3" />
      {expired ? "Teste expirado" : `${daysLeft} ${daysLeft === 1 ? "dia restante" : "dias restantes"}`}
    </div>
  );
}
