import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface InfoTipProps {
  text: string;
  className?: string;
  iconClassName?: string;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
}

/**
 * Ícone ⓘ que abre um popover explicativo.
 * Funciona em desktop (hover/click) e mobile (tap) sem dependências adicionais.
 */
export function InfoTip({
  text,
  className,
  iconClassName,
  side = "top",
  align = "center",
}: InfoTipProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Mais informações"
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "inline-flex items-center justify-center rounded-full text-muted-foreground/70 hover:text-primary transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
            className,
          )}
        >
          <Info className={cn("h-3.5 w-3.5", iconClassName)} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        className="max-w-xs text-xs leading-relaxed p-3 z-50"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="whitespace-pre-line">{text}</span>
      </PopoverContent>
    </Popover>
  );
}
