import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * MetricIcon — ícone padrão dos cards de métrica.
 * Usa a classe global `.metric-icon-wrapper` (definida em index.css)
 * para garantir tamanho consistente em desktop (40px) e mobile (28px).
 *
 * Por padrão é posicionado absolutamente no canto superior direito.
 * Passe `absolute={false}` para uso inline (dentro de um flex row).
 */
export function MetricIcon({
  icon: Icon,
  absolute = true,
  className,
}: {
  icon: LucideIcon;
  absolute?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "metric-icon-wrapper",
        absolute && "absolute top-3 right-3",
        className,
      )}
    >
      <Icon />
    </div>
  );
}
