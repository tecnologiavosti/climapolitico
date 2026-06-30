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

  const type = c.candidate_type ?? "official";
  const tier = c.confidence_tier;
  const score = c.confidence_score ? ` · ${Math.round(c.confidence_score)}` : "";
  const typeBadge = type === "official"
    ? { label: "🟢 Oficial TSE", className: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30" }
    : type === "pre_candidate"
    ? (c.is_eligible === false
        ? { label: "🔴 Inelegível", className: "bg-red-500/10 text-red-700 border-red-500/30" }
        : tier === "forte"
        ? { label: `🟢 Forte${score}`, className: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30" }
        : tier === "possivel"
        ? { label: `🟡 Possível${score}`, className: "bg-amber-500/10 text-amber-700 border-amber-500/30" }
        : tier === "fraco"
        ? { label: `🟠 Fraco${score}`, className: "bg-orange-500/10 text-orange-700 border-orange-500/30" }
        : { label: `🟡 Cotado${score}`, className: "bg-amber-500/10 text-amber-700 border-amber-500/30" })
    : { label: "🔵 Figura monitorada", className: "bg-blue-500/10 text-blue-700 border-blue-500/30" };

  return (
    <Card className="hover-lift transition-all flex flex-col">
      <CardContent className="pt-5 pb-4 flex-1 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <Badge variant="outline" className={`text-[10px] ${typeBadge.className}`} title={c.reason ?? undefined}>
            {typeBadge.label}
          </Badge>
        </div>
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
          {c.partido_sigla && (() => {
            const num = Number(c.numero_partido);
            const showNum = Number.isFinite(num) && num > 0;
            return (
              <Badge variant="secondary">
                {c.partido_sigla}{showNum ? ` ${num}` : ""}
              </Badge>
            );
          })()}
          {location && <Badge variant="outline">{location}</Badge>}
          {!location && c.regiao && <Badge variant="outline">{c.regiao}</Badge>}
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
