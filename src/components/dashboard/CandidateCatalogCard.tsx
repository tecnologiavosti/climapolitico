import { memo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Check, Plus, Loader2, Twitter, Instagram, Facebook, Youtube, Globe, Award } from "lucide-react";
import type { PoliticianRow } from "@/hooks/useCatalogSearch";

const NETWORK_ICONS: Record<string, any> = {
  twitter: Twitter, x: Twitter,
  instagram: Instagram, facebook: Facebook,
  youtube: Youtube, tiktok: Globe,
};

const POSITION_LABEL: Record<string, string> = {
  presidente: "Presidente",
  vice_presidente: "Vice-presidente",
  governador: "Governador",
  vice_governador: "Vice-governador",
  senador: "Senador",
  deputado_federal: "Deputado Federal",
  deputado_estadual: "Deputado Estadual",
  deputado_distrital: "Deputado Distrital",
  prefeito: "Prefeito",
  vice_prefeito: "Vice-prefeito",
  vereador: "Vereador",
  ministro: "Ministro de Estado",
  presidente_partido: "Presidente de Partido",
  pre_candidato: "Pré-candidato 2026",
};

interface Props {
  candidate: PoliticianRow;
  alreadyAdded: boolean;
  isAdding: boolean;
  onAdd: (c: PoliticianRow) => void;
}

function CandidateCatalogCardBase({ candidate: c, alreadyAdded, isAdding, onAdd }: Props) {
  const initials = c.nome.split(" ").slice(0, 2).map(s => s[0]).join("").toUpperCase();
  const cargo = c.cargo ? (POSITION_LABEL[c.cargo] ?? c.cargo) : null;
  const location = [c.municipio, c.estado].filter(Boolean).join(" • ");
  const networks = c.redes_sociais ? Object.keys(c.redes_sociais) : [];

  return (
    <Card className="hover-lift transition-all flex flex-col">
      <CardContent className="pt-5 pb-4 flex-1 flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <Avatar className="h-14 w-14 border">
            {c.foto_url && <AvatarImage src={c.foto_url} alt={c.nome} />}
            <AvatarFallback className="bg-primary/10 text-primary font-semibold">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold leading-tight truncate">{c.nome_urna || c.nome}</h3>
            {c.nome_urna && c.nome_urna !== c.nome && (
              <p className="text-[11px] text-muted-foreground truncate">{c.nome}</p>
            )}
            {cargo && <p className="text-xs text-muted-foreground mt-0.5">{cargo}</p>}
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {c.partido_sigla && (
            <Badge variant="secondary">
              {c.partido_sigla}{c.numero_partido ? ` ${c.numero_partido}` : ""}
            </Badge>
          )}
          {location && <Badge variant="outline">{location}</Badge>}
          {!location && c.regiao && <Badge variant="outline">{c.regiao}</Badge>}
          {(() => {
            const cat = c.categoria ?? (c.eleito ? "eleito" : null);
            if (cat === "eleito") return (
              <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white">
                <Award className="h-3 w-3 mr-1" /> Eleito
              </Badge>
            );
            if (cat === "ex_candidato") return (
              <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-400">
                Ex-candidato
              </Badge>
            );
            if (cat === "pre_candidato") return (
              <Badge variant="outline" className="border-sky-500 text-sky-700 dark:text-sky-400">
                Pré-candidato
              </Badge>
            );
            if (cat === "lideranca_local") return (
              <Badge variant="outline" className="border-purple-500 text-purple-700 dark:text-purple-400">
                Liderança local
              </Badge>
            );
            return null;
          })()}
        </div>

        {networks.length > 0 && (
          <div className="flex gap-1.5 mt-auto">
            {networks.map((n) => {
              const Icon = NETWORK_ICONS[n.toLowerCase()] ?? Globe;
              return (
                <span key={n} className="h-6 w-6 rounded-full bg-muted flex items-center justify-center" title={n}>
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
