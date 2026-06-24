import { memo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Check, Plus, Loader2, Twitter, Instagram, Facebook, Youtube, Globe } from "lucide-react";
import type { CatalogRow } from "@/hooks/useCatalogSearch";

const NETWORK_ICONS: Record<string, any> = {
  twitter: Twitter,
  x: Twitter,
  instagram: Instagram,
  facebook: Facebook,
  youtube: Youtube,
  tiktok: Globe,
};

const POSITION_LABEL: Record<string, string> = {
  presidente: "Presidente",
  vice_presidente: "Vice-presidente",
  ministro: "Ministro",
  governador: "Governador",
  vice_governador: "Vice-governador",
  senador: "Senador",
  deputado_federal: "Deputado Federal",
  deputado_estadual: "Deputado Estadual",
  deputado_distrital: "Deputado Distrital",
  prefeito: "Prefeito",
  vice_prefeito: "Vice-prefeito",
  vereador: "Vereador",
  presidente_partido: "Presidente de Partido",
  ex_candidato: "Ex-candidato",
};

interface Props {
  candidate: CatalogRow;
  alreadyAdded: boolean;
  isAdding: boolean;
  onAdd: (c: CatalogRow) => void;
}

function CandidateCatalogCardBase({ candidate: c, alreadyAdded, isAdding, onAdd }: Props) {
  const initials = c.full_name.split(" ").slice(0, 2).map(s => s[0]).join("").toUpperCase();
  const cargo = c.cargo ? (POSITION_LABEL[c.cargo] ?? c.cargo) : null;
  const location = [c.city, c.state].filter(Boolean).join(" • ");
  const networks = c.monitorable_networks ?? [];

  return (
    <Card className="hover-lift transition-all flex flex-col">
      <CardContent className="pt-5 pb-4 flex-1 flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <Avatar className="h-14 w-14 border">
            {c.photo_url && <AvatarImage src={c.photo_url} alt={c.full_name} />}
            <AvatarFallback className="bg-primary/10 text-primary font-semibold">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold leading-tight truncate">{c.full_name}</h3>
            {cargo && <p className="text-xs text-muted-foreground mt-0.5">{cargo}</p>}
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {c.party && (
            <Badge variant="secondary">
              {c.party}{c.party_number ? ` ${c.party_number}` : ""}
            </Badge>
          )}
          {location && <Badge variant="outline">{location}</Badge>}
          {!location && c.region && <Badge variant="outline">{c.region}</Badge>}
        </div>

        {c.description && (
          <p className="text-xs text-muted-foreground line-clamp-2">{c.description}</p>
        )}

        {networks.length > 0 && (
          <div className="flex gap-1.5 mt-auto">
            {networks.map((n) => {
              const Icon = NETWORK_ICONS[n.toLowerCase()] ?? Globe;
              return (
                <span
                  key={n}
                  className="h-6 w-6 rounded-full bg-muted flex items-center justify-center"
                  title={n}
                >
                  <Icon className="h-3.5 w-3.5" />
                </span>
              );
            })}
          </div>
        )}

        <Button
          className="w-full mt-2"
          size="sm"
          variant={alreadyAdded ? "outline" : "default"}
          disabled={alreadyAdded || isAdding}
          onClick={() => onAdd(c)}
        >
          {isAdding ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> :
           alreadyAdded ? <Check className="h-4 w-4 mr-2" /> :
           <Plus className="h-4 w-4 mr-2" />}
          {alreadyAdded ? "Já adicionado" : "Adicionar"}
        </Button>
      </CardContent>
    </Card>
  );
}

export const CandidateCatalogCard = memo(CandidateCatalogCardBase);
