import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { X } from "lucide-react";

interface InsightFiltersProps {
  selectedType: string | null;
  setSelectedType: (value: string | null) => void;
  selectedPriority: string | null;
  setSelectedPriority: (value: string | null) => void;
  selectedCandidate: string | null;
  setSelectedCandidate: (value: string | null) => void;
  showDismissed: boolean;
  setShowDismissed: (value: boolean) => void;
  candidates: Array<{ id: string; full_name: string }>;
}

export const InsightFilters = ({
  selectedType,
  setSelectedType,
  selectedPriority,
  setSelectedPriority,
  selectedCandidate,
  setSelectedCandidate,
  showDismissed,
  setShowDismissed,
  candidates
}: InsightFiltersProps) => {
  const hasActiveFilters = selectedType || selectedPriority || selectedCandidate;

  const clearFilters = () => {
    setSelectedType(null);
    setSelectedPriority(null);
    setSelectedCandidate(null);
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[200px]">
            <Label>Tipo de Insight</Label>
            <Select value={selectedType || ''} onValueChange={(value) => setSelectedType(value || null)}>
              <SelectTrigger>
                <SelectValue placeholder="Todos os tipos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Todos os tipos</SelectItem>
                <SelectItem value="crisis">Crise</SelectItem>
                <SelectItem value="opportunity">Oportunidade</SelectItem>
                <SelectItem value="trend">Tendência</SelectItem>
                <SelectItem value="recommendation">Recomendação</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex-1 min-w-[200px]">
            <Label>Prioridade</Label>
            <Select value={selectedPriority || ''} onValueChange={(value) => setSelectedPriority(value || null)}>
              <SelectTrigger>
                <SelectValue placeholder="Todas as prioridades" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Todas as prioridades</SelectItem>
                <SelectItem value="high">Alta</SelectItem>
                <SelectItem value="medium">Média</SelectItem>
                <SelectItem value="low">Baixa</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex-1 min-w-[200px]">
            <Label>Candidato</Label>
            <Select value={selectedCandidate || ''} onValueChange={(value) => setSelectedCandidate(value || null)}>
              <SelectTrigger>
                <SelectValue placeholder="Todos os candidatos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Todos os candidatos</SelectItem>
                {candidates.map((candidate) => (
                  <SelectItem key={candidate.id} value={candidate.id}>
                    {candidate.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <Switch
              id="show-dismissed"
              checked={showDismissed}
              onCheckedChange={setShowDismissed}
            />
            <Label htmlFor="show-dismissed" className="cursor-pointer">
              Mostrar descartados
            </Label>
          </div>

          {hasActiveFilters && (
            <Button variant="outline" onClick={clearFilters} size="sm">
              <X className="h-4 w-4 mr-2" />
              Limpar Filtros
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
};