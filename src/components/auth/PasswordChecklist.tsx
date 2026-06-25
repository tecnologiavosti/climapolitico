import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

export const passwordRules = [
  { id: "len", label: "mínimo 8 caracteres", test: (p: string) => p.length >= 8 },
  { id: "upper", label: "1 letra maiúscula", test: (p: string) => /[A-Z]/.test(p) },
  { id: "lower", label: "1 letra minúscula", test: (p: string) => /[a-z]/.test(p) },
  { id: "num", label: "1 número", test: (p: string) => /\d/.test(p) },
  { id: "special", label: "1 caractere especial", test: (p: string) => /[^A-Za-z0-9]/.test(p) },
] as const;

export const isPasswordValid = (p: string) => passwordRules.every((r) => r.test(p));

export const PasswordChecklist = ({ password }: { password: string }) => {
  if (!password) return null;
  return (
    <ul className="space-y-1 rounded-md border bg-muted/30 p-3 text-xs animate-fade-in">
      {passwordRules.map((r) => {
        const ok = r.test(password);
        return (
          <li
            key={r.id}
            className={cn(
              "flex items-center gap-2 transition-colors",
              ok ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"
            )}
          >
            {ok ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
            <span>{r.label}</span>
          </li>
        );
      })}
    </ul>
  );
};
