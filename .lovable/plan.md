## Objetivo

Transformar a aba **Visão por Rede Social** em um módulo de **social listening histórico** que funciona para qualquer período (7d → 8 anos, ou personalizado), inclusive 2018/2020/2022, **sem depender de `social_interactions`, posts internos ou do pipeline Radar Político**.

Radar = eventos institucionais. Visão por Rede Social = buzz/menções/temas/termos digitais por candidato no período.

## Arquitetura nova

```text
Frontend (NetworkView.tsx)
  └─► edge: network-listening (NOVA)
        ├─► Firecrawl search (Google News, Reddit, YouTube, blogs, snapshots)
        │     - 1 query por rede relevante no período
        │     - filtro temporal: tbs=qdr:* + recorte por data
        ├─► Lovable AI (gemini-3-flash-preview), JSON mode
        │     Entrada: { candidate, party, office, state, period, results[] }
        │     Saída estruturada (ver "Schema da IA")
        └─► Cache 30min por (candidate|start|end|network)
```

Sem dados internos. Sem `social_interactions`. Sem `radar-job-*`.

## Schema da IA (saída)

```json
{
  "total_mentions": 12400,
  "total_interactions": 38200,
  "sentiment": { "pos": 42, "neg": 31, "neu": 27 },
  "net_sentiment": 11,
  "dominant_network": "twitter",
  "distribution": [{ "network": "twitter", "pct": 38 }, ...],
  "timeline": [{ "date": "2018-09", "total": 1800, "pos": 700, "neg": 900 }],
  "sentiment_by_network": [{ "network": "twitter", "pos": 32, "neg": 48, "neu": 20 }],
  "topics": [{ "label": "Antipetismo", "mentions": 4200, "pos": 30, "neg": 55, "neu": 15 }],
  "terms": [{ "term": "#Bolsonaro2026", "kind": "hashtag", "count": 980 }],
  "confidence": "high|medium|low",
  "reasoning": "Texto curto explicando bases (cobertura encontrada, contexto histórico aplicado)"
}
```

A IA recebe contexto explícito:
- maturidade das redes por ano (ex.: TikTok irrelevante <2020, Bluesky pós-2023)
- perfil esperado por rede (X polarizado/negativo, Instagram neutro+, Telegram militante, Reddit polarizado, Notícias neutro)
- fallback: se cobertura escassa, **inferir** com base no contexto político do período (nunca retornar 0/vazio)
- granularidade do bucket: 7d/30d→dia, 90d→semana, 1a→mês, 4a→trimestre, 8a→semestre

## Mudanças por arquivo

1. **`supabase/functions/network-listening/index.ts`** (NOVA)
   - CORS, validação Zod
   - Firecrawl search (`tbs` mapeado do período; 4–6 queries por rede chave)
   - Monta corpus compacto (título+snippet+data+source)
   - Chama Lovable AI Gateway com JSON schema acima
   - Heurística por ano embutida no system prompt
   - Cache em memória (Map) por chave 30min

2. **`src/pages/dashboard/NetworkView.tsx`** (refatorar)
   - Remover: `radar-job-create`, `radar-job-status`, polling, `events`, `eventNetworks`, `network-view-sentiment`, `network-view-intelligence` calls
   - Adicionar: `useQuery(["nv-listening", candidateId, range, network])`
   - Período personalizado: modal com `DateRangePicker` já existente; botão "Aplicar período"
   - Todos os blocos consomem direto do JSON da IA:
     - KPIs (menções, interações, sentimento líquido com label +30/+10/-10/-30, rede dominante)
     - Distribuição por rede (barras)
     - Evolução temporal (LineChart com Volume/Pos/Neg)
     - Sentimento por rede (tabela)
     - Assuntos dominantes (lista com badges sentimento)
     - Termos em alta (chips por kind: pessoa/partido/instituição/hashtag/slogan/região)
   - Empty state só se IA retornar `confidence:"low"` e zero dados — caso contrário sempre renderizar

3. **`supabase/functions/network-view-sentiment/index.ts`** → deletar
4. **`supabase/functions/network-view-intelligence/index.ts`** → deletar (substituída por `network-listening`)

## Conexão Firecrawl

Já existe `FIRECRAWL_API_KEY` no projeto? Verificar via `fetch_secrets`. Se não, solicitar conexão Firecrawl (este é o data connector padrão).

## Critérios de aceite

- 7d, 1a, 4a, 8a e personalizado (ex.: 01/01/2018–31/12/2018) recalculam **todos** os blocos
- "Bolsonaro 2018" mostra Twitter/Facebook dominantes, hashtags de campanha, temas (antipetismo, segurança), TikTok ~0%
- Distribuição de rede coerente com a maturidade da rede no ano
- Termos contêm apenas pessoas, partidos, instituições, hashtags, slogans, regiões — sem verbos/fragmentos
- Nunca exibir "Sem dados" se houver contexto histórico inferível (fallback IA ativo)
- Período personalizado dispara nova chamada e atualiza todos os blocos

## Observação técnica

Esta refatoração reescreve `NetworkView.tsx` quase completamente (~800 linhas) e adiciona uma nova edge function de ~250 linhas. É um único PR grande mas autocontido — sem migração de dados, sem impacto em Radar Político.
