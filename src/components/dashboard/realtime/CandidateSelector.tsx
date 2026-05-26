import { useState } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";

interface Candidate {
  id: string;
  full_name: string;
}

interface Props {
  candidates: Candidate[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}

const initials = (name: string) =>
  name.split(/\s+/).slice(0, 2).map(s => s[0]?.toUpperCase() ?? "").join("");

const colorFromName = (name: string) => {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return `hsl(${h}, 70%, 45%)`;
};

export const CandidateSelector = ({ candidates, value, onChange, disabled }: Props) => {
  const [open, setOpen] = useState(false);
  const selected = candidates.find(c => c.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full sm:w-[280px] justify-between h-11 bg-card/60 border-border/70 hover:bg-muted/40"
        >
          {selected ? (
            <div className="flex items-center gap-2 min-w-0">
              <div
                className="h-7 w-7 rounded-full shrink-0 flex items-center justify-center text-[11px] font-semibold text-white"
                style={{ background: colorFromName(selected.full_name) }}
              >
                {initials(selected.full_name)}
              </div>
              <span className="truncate text-sm font-medium">{selected.full_name}</span>
            </div>
          ) : (
            <span className="text-muted-foreground text-sm">Selecione um candidato</span>
          )}
          <ChevronsUpDown className="h-4 w-4 text-muted-foreground shrink-0 opacity-70" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <div className="flex items-center border-b border-border/60 px-2">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <CommandInput placeholder="Buscar candidato..." className="border-0 focus:ring-0" />
          </div>
          <CommandList>
            <CommandEmpty>Nenhum candidato encontrado.</CommandEmpty>
            <CommandGroup>
              {candidates.map(c => (
                <CommandItem
                  key={c.id}
                  value={c.full_name}
                  onSelect={() => { onChange(c.id); setOpen(false); }}
                  className="gap-2"
                >
                  <div
                    className="h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-semibold text-white"
                    style={{ background: colorFromName(c.full_name) }}
                  >
                    {initials(c.full_name)}
                  </div>
                  <span className="flex-1 truncate text-sm">{c.full_name}</span>
                  <Check className={cn("h-4 w-4", value === c.id ? "opacity-100 text-primary" : "opacity-0")} />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};
