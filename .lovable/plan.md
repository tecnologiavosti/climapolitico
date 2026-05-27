# Repercussão por Região — Plano de Implementação

Nova aba que detecta automaticamente eventos políticos (entrevistas, debates, lives, podcasts, discursos) e analisa a reação da população por região do Brasil, com mapa, insights de IA e chat interativo.

## Aproveitamento do que já existe

- `political_events` (tabela) e `detect-candidate-events` (edge function) já detectam eventos via clustering de comentários. **Reusar**.
- `analyze-event-repercussion` já existe (análise por evento). Vou estender com recorte regional.
- `regional-insights` já gera pontos fortes/fracos por região. Vou usar como base para o mapa.
- `BrazilStateMap`, `_regional_city_dict` e função RPC `get_cities_ranking_summary` já fazem normalização e inferência de região. **Reusar** para o heatmap regional.
- `callAICerebrasFirst` (shared) já implementa fallback Cerebras→Lovable Gateway. **Reusar**.

## Estrutura

### 1. Rota e navegação
- Nova rota `/dashboard/event-repercussion` em `App.tsx`
- Item no `AppSidebar` ("Repercussão por Região", ícone Radio/Activity)

### 2. Página `src/pages/dashboard/EventRepercussion.tsx`
Layout (top→bottom):
- **Header**: seletor de candidato + barra de busca de evento + filtros (período: hoje/7d/30d, tipo: todos/entrevista/debate/live/podcast/discurso)
- **Lista de eventos** (sidebar esquerda em desktop, drawer no mobile): cards compactos com nome, tipo, data/hora, badge de volume. Ordenação por repercussão/recência.
- **Painel principal** (quando um evento é selecionado):
  - 4 cards de insights automáticos: 📈 assunto que mais cresceu, 🔥 região mais engajada, ⚠ região mais crítica, ❤️ região mais favorável
  - **Mapa do Brasil** colorido por sentimento (verde/amarelo/vermelho/cinza) — reusa `BrazilStateMap` agregado por região
  - **Timeline de repercussão**: gráfico de área (antes/durante/depois do evento), seletor 24h/48h/7d/30d
  - **Detalhe regional**: ao clicar numa região, abre painel com KPIs (menções, sentimentos, engajamento), top assuntos, palavras mais citadas, top comentários, tendência
  - **Chat IA regional**: input "Pergunte à IA" com sugestões prontas; respostas streaming via Cerebras

### 3. Edge functions (novas)
- **`detect-events-multisource`**: orquestra detecção. Usa `detect-candidate-events` (cluster heurístico + LLM) e cruza com GDELT/Google News para eventos já existentes (eventos com `metadata.source = 'news'`). Salva em `political_events`. Dispara em background com `EdgeRuntime.waitUntil`, retorna 202 com job_id.
- **`analyze-event-regional`**: dado `event_id`, retorna agregação por região do Brasil (5 regiões + breakdown por UF). Usa `social_interactions` filtrando por janela de tempo do evento (start_date−1d até end_date+7d) + match por keywords do evento. Saída: `{ regions: { Norte: { mentions, positive, negative, neutral, engagement, growth, topThemes, topWords, sampleComments }, ... }, timeline: [...], insights: {...} }`. Cacheia no `analysis_cache`.
- **`chat-event-region`**: chat sobre um evento+região específicos. Input: `{ event_id, region?, question }`. Carrega amostra de comentários reais, monta prompt com contexto, chama `callAICerebrasFirst` em modo streaming. Responde com SSE/text-stream. Se < 20 comentários: "Dados insuficientes para uma análise confiável."

### 4. Componentes (`src/components/dashboard/repercussion/`)
- `EventSelector.tsx` — busca, filtros, lista ordenada
- `EventInsightsCards.tsx` — 4 cards superiores
- `RegionalSentimentMap.tsx` — wrapper sobre `BrazilStateMap` colorindo por sentimento agregado
- `RegionDetailPanel.tsx` — drawer com KPIs, temas, palavras, comentários ao clicar região
- `RepercussionTimeline.tsx` — gráfico de área (Recharts) com marcadores antes/durante/depois
- `RegionalChat.tsx` — chat com sugestões, streaming, cita comentários reais
- `RepercussionLoadingState.tsx` — skeletons + barra de progresso ("Detectando evento... 25%" → "Finalizando... 100%")

### 5. Hook
- `useEventRepercussion(eventId, range)` — React Query. Chama `analyze-event-regional`, cacheia 5min, expõe `regions`, `timeline`, `insights`, status de loading granular.

### 6. Cache
- Resultado de `analyze-event-regional` salvo em `analysis_cache` com `cache_key = event_id:range`, TTL 10min.
- Chat não cacheia (sempre fresco).

## Detalhes técnicos

- **Detecção multifonte**: por ora reusa `detect-candidate-events` (cobre todos os comentários coletados, independente da rede). Eventos do GDELT/news já são coletados via `google-news-collector` e ficam em `social_interactions` com `social_network='news'`, então o cluster captura. Adicionar passo extra: extrair títulos de notícia com `social_network IN ('news','google_news')` e gerar `political_events` com `event_type='noticia'`.
- **Modelo IA**: Cerebras `llama-3.3-70b` (rápido) para chat e insights; fallback Lovable Gateway `google/gemini-3-flash-preview` via `callAICerebrasFirst`.
- **Streaming chat**: `streamText` da AI SDK no edge function, transporte SSE para o front (`useChat` com transport apontando para `/functions/v1/chat-event-region`).
- **Inferência regional**: reusa lógica de `get_cities_ranking_summary` (unaccent + `_regional_city_dict`) para mapear cidade→região quando `region` está vazio.
- **Performance**: paginação 1000 por página em `social_interactions`; limite 30k registros por evento; agregação em memória; `EdgeRuntime.waitUntil` para detecção; debounce 300ms em pesquisa de evento.

## Design
- Dark mode primário (`#0f1117` bg, `#161b22` cards) consistente com Monitor de Comentários.
- Verde `hsl(var(--positive))`, amarelo `hsl(var(--neutral))`, vermelho `hsl(var(--negative))`, cinza `hsl(var(--muted))`.
- Layout split em desktop (lista esquerda 320px + painel direito), drawer empilhado no mobile.
- Transições com `framer-motion` (fade/slide).

## Entregáveis
1. Migration: índice em `political_events(user_id, candidate_id, event_date desc)` + RPC `get_event_regional_summary(event_id uuid, range_days int)` para agregação rápida.
2. 3 edge functions: `detect-events-multisource`, `analyze-event-regional`, `chat-event-region`.
3. 1 página + 7 componentes + 1 hook.
4. Atualizações em `App.tsx` e `AppSidebar.tsx`.