import { useState } from "react";
import { format } from "date-fns";
import { CalendarIcon, CheckCircle2, Info, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import type { CollectionConfig } from "@/types/traceability";

const SOCIAL_NETWORKS = [
  { id: "instagram", name: "Instagram", color: "bg-gradient-to-r from-purple-500 to-pink-500" },
  { id: "twitter", name: "Twitter/X", color: "bg-blue-500" },
  { id: "facebook", name: "Facebook", color: "bg-blue-600" },
  { id: "tiktok", name: "TikTok", color: "bg-black" },
  { id: "youtube", name: "YouTube", color: "bg-red-600" },
  { id: "linkedin", name: "LinkedIn", color: "bg-blue-700" },
  { id: "threads", name: "Threads", color: "bg-gray-800" },
  { id: "reddit", name: "Reddit", color: "bg-orange-600" },
];

const BRAZILIAN_STATES = [
  { code: "NACIONAL", name: "Nacional (Todos os Estados)" },
  { code: "AC", name: "Acre" },
  { code: "AL", name: "Alagoas" },
  { code: "AP", name: "Amapá" },
  { code: "AM", name: "Amazonas" },
  { code: "BA", name: "Bahia" },
  { code: "CE", name: "Ceará" },
  { code: "DF", name: "Distrito Federal" },
  { code: "ES", name: "Espírito Santo" },
  { code: "GO", name: "Goiás" },
  { code: "MA", name: "Maranhão" },
  { code: "MT", name: "Mato Grosso" },
  { code: "MS", name: "Mato Grosso do Sul" },
  { code: "MG", name: "Minas Gerais" },
  { code: "PA", name: "Pará" },
  { code: "PB", name: "Paraíba" },
  { code: "PR", name: "Paraná" },
  { code: "PE", name: "Pernambuco" },
  { code: "PI", name: "Piauí" },
  { code: "RJ", name: "Rio de Janeiro" },
  { code: "RN", name: "Rio Grande do Norte" },
  { code: "RS", name: "Rio Grande do Sul" },
  { code: "RO", name: "Rondônia" },
  { code: "RR", name: "Roraima" },
  { code: "SC", name: "Santa Catarina" },
  { code: "SP", name: "São Paulo" },
  { code: "SE", name: "Sergipe" },
  { code: "TO", name: "Tocantins" },
];

const REGIONS = [
  { id: "norte", name: "Norte", states: ["AC", "AP", "AM", "PA", "RO", "RR", "TO"] },
  { id: "nordeste", name: "Nordeste", states: ["AL", "BA", "CE", "MA", "PB", "PE", "PI", "RN", "SE"] },
  { id: "centro-oeste", name: "Centro-Oeste", states: ["DF", "GO", "MT", "MS"] },
  { id: "sudeste", name: "Sudeste", states: ["ES", "MG", "RJ", "SP"] },
  { id: "sul", name: "Sul", states: ["PR", "RS", "SC"] },
];

interface CollectionConfigComponentProps {
  candidateId?: string;
  onSave?: (config: CollectionConfig) => void;
}

export function CollectionConfigComponent({ candidateId, onSave }: CollectionConfigComponentProps) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  
  const [periodStart, setPeriodStart] = useState<Date>(new Date());
  const [periodEnd, setPeriodEnd] = useState<Date>(new Date());
  const [selectedNetworks, setSelectedNetworks] = useState<string[]>([]);
  const [selectedRegions, setSelectedRegions] = useState<string[]>([]);
  const [maxProfiles, setMaxProfiles] = useState<number>(100);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [frequency, setFrequency] = useState<'once' | 'daily' | 'weekly'>('once');

  const toggleNetwork = (networkId: string) => {
    setSelectedNetworks(prev =>
      prev.includes(networkId)
        ? prev.filter(id => id !== networkId)
        : [...prev, networkId]
    );
  };

  const toggleRegion = (regionStates: string[]) => {
    setSelectedRegions(prev => {
      // Check if all states from this region are already selected
      const allSelected = regionStates.every(state => prev.includes(state));
      
      if (allSelected) {
        // Remove all states from this region
        return prev.filter(state => !regionStates.includes(state));
      } else {
        // Add all states from this region
        const newStates = regionStates.filter(state => !prev.includes(state));
        return [...prev, ...newStates];
      }
    });
  };

  const toggleState = (stateCode: string) => {
    if (stateCode === "NACIONAL") {
      // Toggle all states
      if (selectedRegions.length === BRAZILIAN_STATES.length - 1) {
        setSelectedRegions([]);
      } else {
        setSelectedRegions(BRAZILIAN_STATES.filter(s => s.code !== "NACIONAL").map(s => s.code));
      }
    } else {
      setSelectedRegions(prev =>
        prev.includes(stateCode)
          ? prev.filter(code => code !== stateCode)
          : [...prev, stateCode]
      );
    }
  };

  const handleSave = async () => {
    if (selectedNetworks.length === 0) {
      toast({
        title: "Erro de Validação",
        description: "Selecione pelo menos uma rede social.",
        variant: "destructive",
      });
      return;
    }

    if (selectedRegions.length === 0) {
      toast({
        title: "Erro de Validação",
        description: "Selecione pelo menos um estado ou região.",
        variant: "destructive",
      });
      return;
    }

    if (periodStart > periodEnd) {
      toast({
        title: "Erro de Validação",
        description: "A data de início deve ser anterior à data de fim.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);

    try {
      const config: CollectionConfig = {
        periodStart,
        periodEnd,
        networks: selectedNetworks,
        regions: selectedRegions,
        maxProfilesPerNetwork: maxProfiles,
        verifiedOnly,
        frequency,
      };

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Usuário não autenticado");

      const { error } = await supabase
        .from("collection_configs")
        .insert({
          user_id: user.id,
          candidate_id: candidateId || null,
          config: config as any,
          status: "active",
        });

      if (error) throw error;

      toast({
        title: "Configuração Salva",
        description: "A configuração de coleta foi salva com sucesso.",
      });

      onSave?.(config);
    } catch (error) {
      console.error("Error saving config:", error);
      toast({
        title: "Erro",
        description: "Não foi possível salvar a configuração.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Period Selection */}
      <Card>
        <CardHeader>
          <CardTitle>Período de Coleta</CardTitle>
          <CardDescription>
            Defina o intervalo de datas para a coleta de dados
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Data de Início</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !periodStart && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {periodStart ? format(periodStart, "PPP") : "Selecione a data"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={periodStart}
                    onSelect={(date) => date && setPeriodStart(date)}
                    initialFocus
                    className="pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <Label>Data de Fim</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !periodEnd && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {periodEnd ? format(periodEnd, "PPP") : "Selecione a data"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={periodEnd}
                    onSelect={(date) => date && setPeriodEnd(date)}
                    initialFocus
                    className="pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Social Networks */}
      <Card>
        <CardHeader>
          <CardTitle>Redes Sociais</CardTitle>
          <CardDescription>
            Selecione as plataformas para análise
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {SOCIAL_NETWORKS.map((network) => (
              <Button
                key={network.id}
                variant={selectedNetworks.includes(network.id) ? "default" : "outline"}
                onClick={() => toggleNetwork(network.id)}
                className="h-auto py-3 flex flex-col items-center gap-2"
              >
                <div className={cn("w-8 h-8 rounded-full", network.color)} />
                <span className="text-xs">{network.name}</span>
                {selectedNetworks.includes(network.id) && (
                  <CheckCircle2 className="h-4 w-4" />
                )}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Geographic Selection */}
      <Card>
        <CardHeader>
          <CardTitle>Recorte Geográfico</CardTitle>
          <CardDescription>
            Selecione regiões ou estados específicos
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <Label>Seleção Rápida por Região</Label>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              {REGIONS.map((region) => {
                const allSelected = region.states.every(state => 
                  selectedRegions.includes(state)
                );
                return (
                  <Button
                    key={region.id}
                    variant={allSelected ? "default" : "outline"}
                    size="sm"
                    onClick={() => toggleRegion(region.states)}
                  >
                    {region.name}
                  </Button>
                );
              })}
            </div>
          </div>

          <div className="space-y-3">
            <Label>Estados</Label>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 max-h-64 overflow-y-auto p-4 border rounded-lg">
              {BRAZILIAN_STATES.map((state) => (
                <div key={state.code} className="flex items-center space-x-2">
                  <Checkbox
                    id={state.code}
                    checked={
                      state.code === "NACIONAL"
                        ? selectedRegions.length === BRAZILIAN_STATES.length - 1
                        : selectedRegions.includes(state.code)
                    }
                    onCheckedChange={() => toggleState(state.code)}
                  />
                  <Label
                    htmlFor={state.code}
                    className="text-sm cursor-pointer"
                  >
                    {state.code === "NACIONAL" ? state.name : `${state.code} - ${state.name}`}
                  </Label>
                </div>
              ))}
            </div>
          </div>

          {selectedRegions.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {selectedRegions.map((code) => (
                <Badge key={code} variant="secondary">
                  {code}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Collection Parameters */}
      <Card>
        <CardHeader>
          <CardTitle>Parâmetros de Coleta</CardTitle>
          <CardDescription>
            Configure limites e filtros para a coleta
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Perfis por Rede Social</Label>
              <Badge variant="outline">{maxProfiles}</Badge>
            </div>
            <Slider
              value={[maxProfiles]}
              onValueChange={(value) => setMaxProfiles(value[0])}
              min={10}
              max={1000}
              step={10}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">
              Número máximo de perfis únicos a serem analisados por plataforma
            </p>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="verified"
              checked={verifiedOnly}
              onCheckedChange={(checked) => setVerifiedOnly(checked as boolean)}
            />
            <Label htmlFor="verified" className="cursor-pointer">
              Incluir apenas perfis verificados
            </Label>
          </div>

          <div className="space-y-3">
            <Label>Frequência de Coleta</Label>
            <RadioGroup value={frequency} onValueChange={(value) => setFrequency(value as any)}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="once" id="once" />
                <Label htmlFor="once" className="cursor-pointer">
                  Única (executar uma vez)
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="daily" id="daily" />
                <Label htmlFor="daily" className="cursor-pointer">
                  Diária (atualização automática)
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="weekly" id="weekly" />
                <Label htmlFor="weekly" className="cursor-pointer">
                  Semanal (atualização semanal)
                </Label>
              </div>
            </RadioGroup>
          </div>
        </CardContent>
      </Card>

      {/* Info Card */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="pt-6">
          <div className="flex gap-4">
            <Info className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
            <div className="space-y-2 text-sm">
              <p className="font-medium">Sobre a Coleta de Dados</p>
              <p className="text-muted-foreground">
                A configuração permite definir os parâmetros para análise de redes sociais. 
                Os dados serão coletados respeitando os limites de API de cada plataforma e 
                as políticas de uso.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <div className="flex justify-end gap-3">
        <Button variant="outline" disabled={isLoading}>
          Cancelar
        </Button>
        <Button onClick={handleSave} disabled={isLoading}>
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Salvando...
            </>
          ) : (
            "Salvar Configuração"
          )}
        </Button>
      </div>
    </div>
  );
}
