# Refatoração: Repercussão por Região (External-First)

## Conceito
Mudar a aba de "extensão do monitor de comentários" para **análise de repercussão externa** de acontecimentos reais, com dados internos apenas como complemento.

```text
EVENTO EXTERNO → Coleta externa (News/Web/YouTube) 
              → IA classifica + distribui regionalmente 
              → Cruza opcionalmente com dados internos 
              → Dashboard
```

## Arquitetura

### 1. Detector de eventos externos (`detect-candidate-events` reescrita)
- Fonte primária: **Firecrawl search** (`tbs=qdr:m`) em queries como:
  - `"{candidato}" entrevista OR debate OR discurso OR coletiva site:g1.globo.com OR site:cnnbrasil.com.br OR site:metropoles.com OR site:folha.uol.com.br`
  - `"{candidato}" agenda OR viagem OR reunião OR evento`
- Fonte secundária: GDELT DOC API (gratuita, sem key) para tom/volume global.
- IA (Gemini 3 flash) recebe headlines + snippets e classifica:
  ```json
  { id, title, description, eventType, date, location, entities,
    keywords, topics, importanceScore, sources:[{name,url,outlet}] }
  ```
- Persiste em `political_events` com `metadata.external_sources`, `metadata.importance_score`, `metadata.estimated_reach`.
- Ordenação por `importance_score` (não mais por menções internas).

### 2. Analisador de repercussão externa (`analyze-event-regional` reescrita)
Novo pipeline:
1. Recoleta corpus externo do evento (Firecrawl + GDELT por keywords + janela de datas).
2. IA gera `externalRepercussion`:
   ```json
   { totalPublications, estimatedReach, majorTopics[],
     regionalDistribution:{ Sudeste, Nordeste, Sul, CO, Norte },
     positiveSignals, negativeSignals, neutralSignals,
     narratives:{ apoio[], criticas[], debates[] } }
   ```
3. Distribuição regional inferida via: outlet origin (Globo→SE, Diário do NE→NE, etc.), menções de cidades/UFs, hashtags.
4. `internalReaction` (opcional, só se houver ≥1 menção): mentions/engagement/sentiment a partir de `social_interactions`.
5. **Remove bloqueio "<30 menções"** — tela sempre funciona com dados externos.

### 3. Frontend `EventRepercussion.tsx`
- Card de evento com fontes (logos/nomes), alcance estimado, importance badge.
- **Duas seções separadas**: "Repercussão externa" vs "Reação da plataforma" — nunca misturadas.
- Mapa BR colorido por `regionalDistribution` externa.
- Cards: Temas dominantes, Narrativas (apoio/críticas/debates), Timeline (antes/durante/depois) baseada em publicações.
- Chat regional usa `externalCorpus` como base, internos como complemento.
- Painel debug: fontes coletadas, publicações, alcance, distribuição, confiança.

### 4. Componentes
- Reescrever: `RepercussionInsightCards`, `RegionalSentimentMap`, `RepercussionTimeline`, `RegionalChat`, `EventSelectorList`.
- Hook `useEventRepercussion` → nova interface com `externalRepercussion` + `internalReaction`.

## Detalhes técnicos
- **Firecrawl**: usar connector já disponível (`FIRECRAWL_API_KEY`). Search com `tbs=qdr:w/m`, `scrapeOptions.formats=['markdown']`.
- **GDELT**: `https://api.gdeltproject.org/api/v2/doc/doc?query=...&mode=ArtList&format=json` — sem auth.
- **Cache**: novo campo `external_repercussion_cache` no `metadata` do evento (TTL 6h) para evitar refazer scraping.
- **Outlet→Região map**: tabela em `_shared/outlet-regions.ts`.
- **Confiança**: baseada em #fontes distintas + diversidade regional + concordância de sinais (não em volume interno).

## Arquivos
- `supabase/functions/_shared/outlet-regions.ts` (novo)
- `supabase/functions/_shared/external-collector.ts` (novo — Firecrawl + GDELT)
- `supabase/functions/detect-candidate-events/index.ts` (reescrita)
- `supabase/functions/analyze-event-regional/index.ts` (reescrita)
- `supabase/functions/chat-event-region/index.ts` (atualiza prompt p/ corpus externo)
- `src/hooks/useEventRepercussion.tsx` (nova interface)
- `src/pages/dashboard/EventRepercussion.tsx` (UI nova)
- `src/components/dashboard/repercussion/*.tsx` (todos atualizados)

## Pré-requisitos
- Conector **Firecrawl** precisa estar linkado ao projeto. Se ainda não estiver, faço o link antes de implementar.
