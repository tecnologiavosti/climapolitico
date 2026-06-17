# Refatorar Visão por Rede Social → mesmo pipeline do Radar Político

A aba hoje lê `social_interactions` e usa IA para inventar tópicos quando há poucos dados. Vou trocar a fonte pelos eventos do Radar (`radar-job-create` + `radar-job-status`) e derivar TODOS os blocos a partir desses documentos reais.

## 1. Fonte única: jobs do Radar

- Disparar `radar-job-create` em `NetworkView.tsx` com `{ candidate_id, candidate_name, start_date, end_date, categories: [], force_refresh: false }` sempre que o usuário trocar candidato/período (igual Radar).
- Reutilizar polling de `radar-job-status` com prefetch incremental até `events_count` (mesmo padrão do `RadarPolitico.tsx`).
- Cache em memória + `localStorage` com chave `nv-radar:${candidate}|${start}|${end}` para evitar reprocessar.
- Pré-requisito: candidato selecionado (≠ "all") e período válido — caso contrário renderizar empty state explicando a regra (Radar já exige o mesmo).

## 2. Mapeamento evento → rede social

Cada `RadarEvent.sources[]` tem `type` (`news`, `youtube`, `twitter`, `telegram`, `tiktok`, `instagram`, `facebook`, `reddit`, etc.). Normalizar:

```text
news/google_news/gdelt   → News
youtube/invidious        → YouTube
twitter/x/bluesky        → X/Twitter
telegram                 → Telegram
tiktok                   → TikTok
instagram/meta           → Instagram
facebook                 → Facebook
reddit/4chan/lemmy       → Reddit
```

Um evento pode contar para várias redes (uma vez por rede distinta nos sources). Aplicar filtro `network !== "all"` removendo eventos sem aquela rede.

## 3. Blocos derivados (sem IA generativa)

| Bloco | Cálculo |
| --- | --- |
| Total menções | `events.length` filtrados |
| Total interações | `Σ event.social_score` (proxy real do Radar) |
| Sentimento líquido | `sentimentByEvent` agregado (ver §4) |
| Rede dominante | `argmax(byNetwork.count)` |
| Distribuição | `byNetwork.count / total` |
| Evolução temporal | bucket por `event_date` usando granularidade existente (diário/semanal/mensal/trimestral/semestral) |
| Sentimento por rede | sentimento médio dentro de cada rede |
| Assuntos dominantes | IA sobre títulos+summaries reais |
| Termos em alta | extração de entidades sobre o corpus real |

## 4. Sentimento por evento

Radar não retorna sentimento. Adicionar `network-view-sentiment` edge function (ou estender `network-view-intelligence`) que recebe até ~200 amostras `{id, text}` e devolve `{id, sentiment: 'pos'|'neg'|'neu'}` via Lovable AI Gateway (`google/gemini-3-flash-preview`, modo JSON). Resultado memoizado por hash do corpus.

## 5. Tópicos e termos

Manter chamada existente `network-view-intelligence` mas passando títulos+summaries dos eventos do Radar em vez de `social_interactions`. Backend já preserva entidades compostas e bloqueia stopwords/verbos — apenas reforçar blacklist (verbos PT comuns) e exigir saída categorizada em: `politico | partido | hashtag | instituicao`. Descartar tokens fora dessas classes.

## 6. Mudanças por arquivo

- `src/pages/dashboard/NetworkView.tsx`
  - Remover queries `query`, `fallback`, `customInteractions` (dependentes de `social_interactions`).
  - Adicionar `radarJob` mutation + `radarStatus` query (mesmo shape do Radar).
  - `customData` passa a derivar de `radarEvents` (eventos paginados completos).
  - `aiAnalyze` passa a enviar `samples` extraídos dos eventos do Radar.
  - Novo hook `useEventSentiment(events)` que chama `network-view-sentiment`.
  - Empty state honesto quando `events.length === 0`.

- `supabase/functions/network-view-intelligence/index.ts`
  - Aceitar opcionalmente `documents: [{title, summary, sources}]` além de `samples`.
  - Reforçar blacklist de verbos PT e exigir classificação de termo.

- `supabase/functions/network-view-sentiment/index.ts` (novo)
  - Input: `{ samples: [{id, text}] }`.
  - Output: `{ results: [{id, sentiment, score}] }`.
  - Cache em memória 30min por hash.

## 7. Critérios de aceite

- Trocar 7d ↔ 30d ↔ 1a ↔ 8a ↔ Personalizado recoleta via Radar e recalcula TODOS os blocos.
- Nenhum bloco mostra "Estimativa por IA" para distribuição/rede dominante.
- Sem candidato selecionado: tab mostra "Selecione um candidato" (igual Radar).
- Sem eventos no período: cada bloco mostra "Sem dados no período".
- Termos em alta nunca contém verbos (`afirmou`, `disse`, `falou`, etc.) nem fragmentos isolados (`mato`, `grosso`).

Confirma esse plano para eu aplicar?
