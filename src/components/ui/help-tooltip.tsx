import { ReactNode } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTooltipsEnabled } from "@/hooks/useTooltipsEnabled";

interface HelpTooltipProps {
  /** Texto humanizado, máximo 2 linhas, em português. */
  text: string;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  /** Use quando o filho não aceita ref (ex: ícone solto). Envolve em <span>. */
  asChild?: boolean;
}

/**
 * Tooltip explicativo que SÓ aparece para usuários com `show_tooltips = true`.
 * Para os demais, renderiza apenas os children — sem alterar layout ou comportamento.
 */
export function HelpTooltip({
  text,
  children,
  side = "top",
  asChild = true,
}: HelpTooltipProps) {
  const enabled = useTooltipsEnabled();

  if (!enabled) return <>{children}</>;

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild={asChild}>
          {asChild ? children : <span className="inline-flex">{children}</span>}
        </TooltipTrigger>
        <TooltipContent side={side} className="max-w-xs text-xs leading-snug">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
