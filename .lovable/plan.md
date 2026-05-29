# Plano: Refatoração "Repercussão por Região" + Mobile QA Global

Esta é uma entrega grande. Proponho dividir em **3 fases** entregáveis e testáveis separadamente, para evitar quebrar o que já funciona.

---

## FASE 1 — Responsividade global (gráficos + sidebar + nomes de abas)

Aplica-se a TODA a plataforma, não só à aba Repercussão.

### 1.1 Gráficos (Recharts) responsivos
Auditar e padronizar todos os componentes em `src/components/dashboard/**` que usam Recharts:
- `SocialMediaCharts`, `ReactionsPerPost(Charts)`, `SocialMediaTemporalEvolution`, `SocialMediaPeakHours`, `RealTimeMentionsChart`, `RealTimeSentimentChart`, `RealTimeSentimentGauge`, `StatsGrid`, `RepercussionTimeline`, etc.
- Garantir `<ResponsiveContainer width="100%" aspect={...}>` com aspect menor no mobile.
- Pizza/Donut: raio dinâmico via `useIsMobile()`, legenda empilhada abaixo, fontes menores, sem labels externos longos no mobile.
- Tooltip com `wrapperStyle` adaptado a touch.
- Reforçar regras já adicionadas em `src/index.css` (`.recharts-*`, `svg { max-width:100% }`).

### 1.2 Nomes de abas/menus — NÃO truncar
- `AppSidebar.tsx` e `MobileBottomNav.tsx`: remover qualquer `truncate`/abreviação.
- Permitir `whitespace-normal break-words leading-tight`, `min-h` em vez de altura fixa.
- Bottom nav mobile: empilhar ícone + label em 2 linhas se necessário; reduzir ícone antes do texto.
- Manter rótulos completos: "Repercussão por Região", "Monitor Geográfico", "Feed em Tempo Real", "Análise IA", etc.

### 1.3 Sidebar mobile (drawer)
- Aumentar largura do `Sheet` mobile (ex. `w-[85vw] max-w-[340px]`).
- Scroll interno habilitado, labels completos, ícones alinhados.

### 1.4 Cards "Reações por post" e similares
- Layout `flex-col` no mobile, gráfico abaixo do texto, métricas empilhadas, botões `min-h-11`.

---

## FASE 2 — Refatoração funcional da aba Repercussão por Região

### 2.1 Remoção e simplificação
- Remover seletor de período (7/30/±7 dias) em `EventRepercussion.tsx` e no hook.
- Detecção sempre busca eventos recentes + relevantes (auto).
- Remover painel Debug da produção (manter atrás de flag dev).

### 2.2 Detecção real de eventos (edge `detect-candidate-events`)
- Pipeline: Firecrawl Search (notícias BR) + GDELT → normalizar → agrupar por similaridade (título + entidades + janela 48h) via Cerebras → produzir eventos com: título, descrição, categoria, local, data, fontes[], importanceScore, confidenceScore, themes[], narratives[].
- Categorias: entrevista, discurso, reunião, coletiva, viagem, debate, polêmica, internacional, economia, eleição.
- Deduplicação por hash de título normalizado + janela temporal.

### 2.3 Thresholds de qualidade
Só persistir/exibir evento se:
- `distinctOutlets >= 3` E `publications >= 5` E `confidenceScore >= 0.4`.
- Caso contrário, marcar `lowCoverage = true` e ocultar do feed principal (toggle "Mostrar baixa cobertura").

### 2.4 Análise externa-first (edge `analyze-event-regional`)
- Já refatorada parcialmente; reforçar que `internalReaction` é só complemento.
- Inferência regional: outlet origin + menções regionais no texto + circulação conhecida (já existe em `outlet-regions.ts`, expandir lista).
- Gerar: tom da cobertura, polarização, narrativas (apoio/críticas/debates), temas dominantes, repercussão política/econômica/internacional — todos baseados em evidência textual.

### 2.5 Chat IA por evento (Cerebras)
- `chat-event-region` já existe; garantir que recebe contexto cheio (evento + narrativas + dist regional + top 30 fontes + sentimentos).
- Sugestões de perguntas no UI: "Como o Nordeste reagiu?", "Quais críticas dominaram no Sudeste?", "Compare Sul e Nordeste", "Quais veículos deram mais destaque?".

### 2.6 Mapa do Brasil refeito
- `RegionalSentimentMap`: melhorar gradiente, hover (raise + glow), tooltip com mini-stats (publicações, top veículo, tom). Mobile: SVG `width:100%`, legenda colapsada em accordion.

### 2.7 Nova estrutura visual
- TOPO: KPIs (candidato, total eventos, publicações, veículos, alcance).
- ESQUERDA: lista de eventos + filtros por categoria.
- CENTRO: análise IA, narrativas, temas, timeline.
- DIREITA: mapa + ranking regional + veículos.
- INFERIOR: chat IA contextual.
- Em mobile, vira tabs verticais: Evento → Análise → Mapa → Chat.

### 2.8 Fontes
- Lista de veículos com link, data, região, score de relevância (já existe parcial em `ExternalSource`; expor melhor no UI).

### 2.9 Performance
- Cache em `political_events.metadata.external_cache` (já existe) com TTL 6h.
- Detecção incremental: só processar URLs ainda não vistas (set de hashes de URL).

---

## FASE 3 — QA mobile final

- Testar em viewports 375, 414, 768 das telas: Overview, RealTime, EventRepercussion, NetworkView, RegionalAnalysis, AIInsights.
- Validar: nenhum gráfico cortado, nenhum nome de aba truncado, nenhum overflow horizontal.

---

## Detalhes técnicos

**Arquivos principais afetados:**
- `src/components/AppSidebar.tsx`, `src/components/MobileBottomNav.tsx`
- `src/components/dashboard/**/*Chart*.tsx`, `ReactionsPerPost*.tsx`
- `src/components/dashboard/repercussion/*` (todos)
- `src/pages/dashboard/EventRepercussion.tsx`
- `src/hooks/useEventRepercussion.tsx`
- `supabase/functions/detect-candidate-events/index.ts`
- `supabase/functions/analyze-event-regional/index.ts`
- `supabase/functions/chat-event-region/index.ts`
- `supabase/functions/_shared/outlet-regions.ts` (expandir)
- `src/index.css` (já tem base, reforçar)

**Migração DB:** adicionar `low_coverage boolean default false`, `confidence_score numeric` em `political_events` se ainda não existirem.

**Sem mudanças em:** auth, RLS de outras tabelas, ranking, monitor em tempo real (apenas correções visuais de gráficos).

---

## Pergunta antes de começar

Quer que eu execute **as 3 fases em sequência neste mesmo loop** (vai ser um patch grande, ~15-20 arquivos), ou prefere que eu comece pela **Fase 1 (mobile global)** e depois você valide antes de eu mexer na lógica da Repercussão (Fase 2)?

Recomendo começar pela **Fase 1** — corrige o problema mais visível (gráficos/sidebar quebrados em produção) sem risco de quebrar a lógica de eventos que ainda está sendo estabilizada.
