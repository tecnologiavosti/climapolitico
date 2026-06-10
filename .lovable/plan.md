# Reformular "Picos de Menções" em Enciclopédia Histórica

## Objetivo

Tornar a aba **Clima Político → Picos de Menções** uma linha do tempo cronológica de acontecimentos políticos relevantes do candidato (2018+), independente de existir dado na SSOT. Detector atual (Google News + GDELT + IA) preservado; SSOT vira enriquecimento opcional já implementado.

## O que muda

### Backend — `supabase/functions/detect-historical-peaks/index.ts`

1. **Substituir `meetsCoverageThreshold` por `coverageQuality`** que devolve um nível (`forte` | `media` | `fraca` | `ai_only`) em vez de booleano. **Nenhum evento é descartado por baixa cobertura.** O nível alimenta `relevance_score` e aparece como badge na UI.

2. **Manter** filtros que já existem e são por design:
   - `BLOCKED_EVENT_TYPES` (comício, agenda, visita…) — continuam barrando ruído de campanha rotineira.
   - `BLOCKED_NAME_TERMS` — idem.
   - Janela temporal (start..end ±1 dia) e tipo válido — mantidos.

3. **Aumentar limite `.slice(0, 40)` → `.slice(0, 120)`** para suportar varredura plurianual (2018–2026 = 9 anos).

4. **Garantir descoberta histórica multi-ano:** confirmar que `discoverKnownEvents` (IA) recebe a janela completa e que `discoverFromGoogleRSS`/`discoverFromGDELT` não impõem filtro de recência (já está assim hoje — apenas validar).

5. **Adicionar `category`** a cada evento (derivada de `type` + heurística no nome): `eleicao`, `operacao_pf`, `stf`, `tse`, `cpi`, `julgamento`, `escandalo`, `prisao`, `debate`, `outros`. Usado pelos novos filtros da UI.

6. **Camada 2 (SSOT) — já implementada** na iteração anterior via `event_ssot_correlation`. Mantida: roda só quando `candidate.id` tem registros no período; nunca esconde evento sem SSOT.

### Frontend — `src/pages/dashboard/EventReport.tsx`

1. **Filtros por categoria** (chips horizontais): Todos · Eleições · Operações PF · STF · TSE · CPI · Julgamentos · Escândalos · Prisões · Debates. Filtragem client-side sobre `events`.

2. **Linha do tempo agrupada por ano** (substitui a lista plana). Cada ano vira uma seção com header `2018`, `2019`, … e os eventos do ano listados cronologicamente dentro.

3. **Badge de cobertura por evento:**
   - `forte` (≥5 outlets, ≥10 evidências) — verde
   - `media` (2–4 outlets) — âmbar
   - `fraca` (1 outlet) — cinza
   - `ai_only` (sem cobertura externa, descoberto só por IA) — outline

4. **Métricas visuais** já presentes (outlets, evidências, duração, sentimento, volume SSOT) — mantidas e exibidas mesmo em eventos `ai_only` (mostra "Cobertura limitada — registrado por descoberta histórica").

5. **Preset padrão de período:** ampliar para `2018-01-01` → `current_date` (era 2022 only). Mantém os presets existentes.

## O que NÃO muda

- Detector atual, RPCs de SSOT, filtros políticos, sentimento, deduplicação, dashboards de outras abas.
- Pipeline de coleta (`social_interactions`), `social_metrics_daily`, cron de refresh.

## Critérios de aceite

- Buscar Flavio Bolsonaro com janela 2018-01-01..2026-12-31 retorna eventos em ≥4 anos distintos.
- Eventos `ai_only` aparecem com badge correto e não são escondidos.
- Filtros de categoria reduzem corretamente a lista sem refazer fetch.
- Eventos com SSOT continuam mostrando o bloco "Repercussão observada".
- Nenhuma regressão em `EventRepercussion.tsx` (consome `political_events` diretamente, não a edge function).

## Arquivos tocados

- `supabase/functions/detect-historical-peaks/index.ts` — alterar threshold/filtros, adicionar `category` e `coverage_quality`, aumentar limite.
- `src/pages/dashboard/EventReport.tsx` — filtros de categoria, agrupamento por ano, badge de cobertura, preset 2018+.

Total estimado: ~150 linhas backend, ~120 linhas frontend.
