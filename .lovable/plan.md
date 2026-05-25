## Plano — Melhorias Comparação Histórica IA + Reações por Post + Limpeza

### 1) Expandir "Comparação Histórica IA"

**Edge function `historical-comparison`** — ampliar o JSON estruturado enviado à IA e a resposta:
- Adicionar agregações novas no pré-processamento:
  - `narrativeShift` (tema dominante início vs fim)
  - `timeline[]` — eventos detectados mês a mês (picos de menções, mudanças bruscas de sentimento, eventos políticos da tabela `political_events` que caírem no período)
  - `regionalShift[]` (UF: delta de menções e sentimento entre início e fim)
  - `demographicShift` (quando houver `gender_distribution`/`age_distribution` em `candidate_analyses`)
  - `emotionalShift` (indignação / aprovação / rejeição / polarização — derivado de sentiment + variação)
  - `eventsImpact[]` (eventos de `political_events` + picos detectados, com delta de menções/sentimento ±7 dias)
  - `sentimentTimeline[]` (série diária/semanal positivo/neutro/negativo)
- Prompt da IA ampliado para gerar:
  - `narrativeShift.summary` ("debate migrou de X para Y")
  - `timelineInsights[]`
  - `regionalInsights[]`
  - `demographicInsights[]`
  - `emotionalInsights[]`
  - resumo final político
- Fallback local (`buildLocalAnalysis`) também passa a preencher esses campos a partir das agregações puras.

**Frontend `HistoricalComparison.tsx`** — novos blocos:
- "Mudança narrativa" (antes → depois com seta)
- "Linha temporal de acontecimentos" (lista vertical com mês/evento/impacto)
- "Mapa temporal de sentimento" (gráfico de área empilhada Recharts pos/neu/neg)
- "Mudanças regionais" (tabela/lista UF + delta + badge)
- "Mudanças demográficas" (cards quando houver dados, senão omite)
- "Mudanças emocionais" (barras horizontais)
- "Eventos que alteraram percepção" (cards com delta antes/depois)
- Mantém narrativa final IA já existente

### 2) Remover aba "Entrevistas e Eventos" (Political Events)

- Apagar `src/pages/dashboard/PoliticalEvents.tsx`
- Remover rota em `src/pages/Dashboard.tsx`
- Remover item do `src/components/AppSidebar.tsx` e `MobileBottomNav.tsx` (se existir)
- **Não** apagar a tabela `political_events` nem as edge functions (`detect-candidate-events`, `auto-detect-events`) — continuam alimentando a timeline da Comparação Histórica IA e Picos de Menções.

### 3) Reações por Post — performance e simplificação

**`src/components/dashboard/ReactionsPerPost.tsx`** — refatorar:
- Remover toda renderização de comentários / replies / textos de comentários
- Buscar **apenas dados agregados** via uma nova edge function `reactions-aggregate` (ou consulta agregada client-side limitada a posts, não a comments)
- KPIs: posts coletados, curtidas, compartilhamentos, interações totais, sentimento geral
- Gráficos: pizza sentimento, linha evolução temporal, barras engajamento por rede, heatmap dias×horas, barras empilhadas sentimento×rede
- Top 5 posts (rede, sentimento, engajamento, reações) — lazy load via botão "ver mais"
- `useMemo` em todas as transformações, `React.lazy` nos gráficos pesados, cache 5min com React Query

### Detalhes técnicos

```text
historical-comparison (edge)
  ├─ collectAggregations()  ← já existia
  │   + buildTimeline()
  │   + buildRegionalShift()
  │   + buildDemographicShift()
  │   + buildEmotionalShift()
  │   + buildEventsImpact() [join political_events]
  │   + buildSentimentTimeline()
  ├─ callAIProviderCascade()  ← prompt expandido
  └─ buildLocalAnalysis()     ← preenche todos os novos campos
```

```text
reactions-aggregate (edge) — opcional
  → agrega social_interactions WHERE post_type IN ('post','status')
  → retorna: kpis, sentimentTimeline, networkBreakdown,
              heatmap[24x7], top5Posts
  → cache em analysis_cache (v1)
```

### Arquivos tocados

- `supabase/functions/historical-comparison/index.ts` (expansão)
- `supabase/functions/reactions-aggregate/index.ts` (novo)
- `src/pages/dashboard/HistoricalComparison.tsx` (novos blocos + Recharts)
- `src/components/dashboard/ReactionsPerPost.tsx` (refatoração agregada)
- `src/pages/Dashboard.tsx` (remover rota PoliticalEvents)
- `src/components/AppSidebar.tsx` (remover item)
- `src/components/MobileBottomNav.tsx` (se referenciar)
- `src/pages/dashboard/PoliticalEvents.tsx` (deletar)

Sem mudanças de schema. Sem novas migrations.
