import { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface ChartDebugFrameProps {
  label?: string;
  className?: string;
  children: ReactNode;
}

/**
 * Wrapper que garante dimensões responsivas adequadas para gráficos Recharts.
 * (Antes era usado para debug visual; agora apenas reserva espaço.)
 */
export function ChartDebugFrame({ className, children }: ChartDebugFrameProps) {
  return (
    <div
      className={cn(
        "relative w-full min-w-0 min-h-[250px] h-[300px] md:h-[400px] lg:h-[400px]",
        className,
      )}
    >
      {children}
    </div>
  );
}
