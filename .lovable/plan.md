## Nova aba: Comparação Histórica IA

Criar uma nova seção no dashboard que permite comparar dois períodos arbitrários de um candidato (inclusive períodos anteriores ao cadastro), com coleta histórica sob demanda e análise gerada por IA.

### 1. Backend — Tabela `historical_mentions`

Migration criando:

```
historical_mentions (
  id uuid PK,
  candidate_id uuid (FK candidates),
  user_id uuid,
  date date NOT NULL,
  platform text,           -- youtube, news, twitter, etc
  mentions int default 0,
  engagement int default 0,
  sentiment_positive int default 0,
  sentiment_negative int default 0,
  sentiment_neutral int default 0,
  themes text[],
  region text,
  source text,             -- 'social_interactions' | 'historical_fetch' | 'cache'
  fetched_at timestamptz,
  created_at timestamptz
)
```

- Índices: `(candidate_id, date)`, `(candidate_id, platform, date)`.
- RLS: dono vê o próprio; admin vê tudo.
- RPC `get_historical_comparison(candidate_id, period_a_start, period_a_end, period_b_start, period_b_end)` que agrega dos dois fontes:
  - `social_interactions` para datas cobertas pelo cadastro
  - `historical_mentions` para datas anteriores
  - Retorna JSON com totais, sentimento, temas dominantes, breakdown por região e por plataforma para cada período.

### 2. Edge function `historical-comparison`

Responsabilidades:
1. Recebe `{ candidateId, periodA, periodB }`, valida JWT.
2. Para cada período: se houver intervalo anterior à `candidates.created_at` E sem registros suficientes em `historical_mentions`, dispara coleta histórica:
   - YouTube Data API com `publishedBefore`/`publishedAfter` e nome do candidato.
   - Google News RSS / GDELT (já integrados) com janela de datas.
   - Twitter via consumer keys quando disponível.
   - Persiste agregações diárias em `historical_mentions` com `source='historical_fetch'`.
3. Chama RPC `get_historical_comparison` para obter números consolidados dos dois períodos.
4. Chama Lovable AI Gateway (`google/gemini-3-flash-preview`, `Output.object` com schema Zod) para gerar:
   - resumo narrativo,
   - mudanças detectadas (crescimento, queda, polarização, regiões, temas),
   - insights estratégicos.
5. Resposta:
   ```
   {
     periodA: {...}, periodB: {...},
     deltas: { mentionsPct, sentimentShift, ... },
     aiAnalysis: { summary, insights[], themeShift, regionalShift },
     dataCompleteness: { periodA: 'full'|'partial'|'insufficient', periodB: ... }
   }
   ```
6. Se um período retornar volume abaixo de um limiar, marca `insufficient` e a UI mostra "Dados históricos insuficientes para análise completa" — nunca inventa.

### 3. Frontend — `src/pages/dashboard/HistoricalComparison.tsx`

Layout:
- Cabeçalho com seletor de candidato (reaproveitar `CandidateSelector`).
- Bloco de filtros: dois `DateRangePicker` (Período A / Período B) + atalhos rápidos: 7d, 30d, 90d, 6m, 1a, "mesmo período ano anterior", "período total".
- Botão "Comparar" dispara `supabase.functions.invoke('historical-comparison', ...)` com loading state e progresso ("Coletando dados históricos…").
- Resultados em duas colunas espelhadas (Período A | Período B) mostrando: menções, sentimento %, tema dominante, região líder, engajamento.
- Card "Análise IA" com o resumo narrativo + lista de insights.
- Gráficos (recharts):
  - `LineChart` evolução temporal dos dois períodos sobrepostos (eixo X normalizado em dias).
  - `BarChart` comparativo de menções / engajamento / sentimento.
  - `RadarChart` comparação temática (eixos = temas).
  - Mapa regional simples (barras horizontais por região, já que não há geo-map no projeto).
- Badge de qualidade de dados ("Dados completos" / "Parcial" / "Insuficiente") por período.

### 4. Roteamento e navegação

- Adicionar rota lazy `/dashboard/historical-comparison` em `src/pages/Dashboard.tsx`.
- Adicionar item "Comparação Histórica IA" em `src/components/AppSidebar.tsx` (ícone `GitCompareArrows`).

### 5. Regras

- Português brasileiro em toda a UI e nos prompts da IA.
- Nunca inventar dados: a edge function só agrega o que existe ou o que ela mesma coletou e persistiu.
- Se a coleta falhar ou não retornar volume, devolver `insufficient` e exibir o aviso pedido.
- Reaproveitar `LOVABLE_API_KEY`, `YOUTUBE_API_KEY`, `APIFY_API_TOKEN`, `TWITTER_*` já configurados.

### Arquivos afetados

- nova migration `historical_mentions` + RPC
- nova edge function `supabase/functions/historical-comparison/index.ts`
- nova página `src/pages/dashboard/HistoricalComparison.tsx`
- edição `src/pages/Dashboard.tsx` (rota)
- edição `src/components/AppSidebar.tsx` (item)
- pequenos componentes auxiliares (atalhos de período, comparador lado a lado) dentro da página
