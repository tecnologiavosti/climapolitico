# Picos de Menções v2 — refator enterprise (execução em fases)

## Status atual (já implementado nas últimas iterações)

Antes de propor mais código, o que **já existe** no pipeline:

- **5 detectores** (`_shared/peak-pipeline.ts → detectHybridSpikes`): Z-score, EWMA (α=0.3, UCL=μ+3σ), CUSUM-like burst, Momentum (mean3/mean7), Anomaly (IQR). Pico = ≥2 sinais.
- **14 categorias** (`POLITICAL_CATEGORIES` + `CATEGORY_RULES`): eleicoes, stf, tse, operacoes_pf, cpi, julgamentos, escandalos, prisoes, debates, congresso, executivo, economia, internacional, outros — com score por keyword e threshold mínimo.
- **Confidence ponderado** (`computeConfidenceScore`): 0.20·z + 0.15·burst + 0.15·momentum + 0.20·diversity + 0.10·authority + 0.10·cross_platform + 0.10·relevance → bandas ≥85/70/50.
- **Threshold dinâmico** (`dynamicThreshold`): `max(baseline·2.5, p95)`.
- **Tiers de fonte** (`classifySource`): A (institucional/Reuters/BBC/STF/TSE/PF), B (Globo/Folha/Estadão/UOL/CNN), C (Veja/Nexo/Carta), D (redes sociais bloqueadas como evidência).
- **UI** (`EventReport.tsx`): 5 contadores clicáveis (Confirmado/Provável/Fraco/Indeterminado/Total), filtros por 14 categorias, badges de sinais, badges de status com emojis.

## Gaps reais a fechar (este plano)

### Fase 1 — Persistência expandida (migração obrigatória)
Adicionar colunas em `political_events` sem criar tabelas novas (mantém SSOT):
- `confidence_v2 numeric` · `confidence_band text` · `detectors_triggered text[]` · `dynamic_threshold numeric`
- `source_diversity_score numeric` · `source_authority_avg numeric` · `cross_platform_score numeric`
- `is_externally_validated bool` · `institutional_confirmations int` · `large_media_confirmations int`
- `validation_sources jsonb` · `ai_summary text` · `ai_tags text[]` · `top_headlines jsonb`
- `peak_hourly_mentions int` · `baseline_mentions numeric`
- Índices: `(candidate_id, confidence_score DESC)`, `(confidence_band, event_date DESC)`

### Fase 2 — Edge function escreve campos novos
Em `detect-historical-peaks/index.ts`:
1. Calcular `dynamicThreshold(series)` por candidato e gravar.
2. Calcular `computeConfidenceScore({...})` a partir dos sinais já coletados → gravar `confidence_v2` + `confidence_band`.
3. Persistir `detectors_triggered` (já temos no `signals`).
4. Validação externa: marcar `is_externally_validated = true` se `tier1_count ≥ 1` (institucional) OU `tier2_count ≥ 3` (grande mídia).
5. Contar `institutional_confirmations` (Tier 1) e `large_media_confirmations` (Tier 2).
6. AI summary: já é gerado em `resolve-peak-cause` — salvar resultado em `ai_summary` ao invés de apenas no campo `description`.

### Fase 3 — Timeline anual no frontend (`EventReport.tsx`)
Componente novo `<AnnualPeaksTimeline events={...} />`:
- `Recharts` `ComposedChart` (já é dependência): barras de volume diário + scatter de picos colorido por `confidence_band`.
- Eixo X: Jan→Dez do ano selecionado, granularidade semanal por padrão.
- Cores: confirmed `hsl(var(--success))`, probable `hsl(var(--info))`, weak `hsl(var(--warning))`, indeterminate `hsl(var(--muted-foreground))`.
- Tooltip rico: título · score · categoria · top headline.
- Click no dot → expande o card correspondente abaixo (já temos accordion).

### Fase 4 — Painel lateral de detalhes
Usar `Sheet` do shadcn (já instalado):
- Trigger: botão "Ver detalhes completos" no card existente.
- Conteúdo: gauge do score (0-100), barras dos 6 componentes do score, lista de detectores ativados, lista de fontes Tier A/B clicáveis, badges institucionais, resumo IA, top 5 headlines.

## O que NÃO vou fazer (e por quê)

| Pedido | Status | Motivo |
|---|---|---|
| Tabelas novas `raw_mentions`, `mention_timeseries`, `event_peaks` com particionamento mensal | **Pulado** | SSOT é `social_interactions`; o pipeline já agrega timeline on-the-fly. Migrar para 3 tabelas novas quebraria coleta, Repercussão, sentimento e métricas. Posso fazer em projeto separado se você confirmar. |
| Popular banco com **50+ picos demo de Lula, 40+ Bolsonaro** | **Recusado** | Memória Core do projeto: **"No mock data"**. Dados vêm da coleta real (Cerebras → Groq → Gemini → SSOT). |
| Isolation Forest (6º detector) | **Pulado** | Não há lib estatística para Deno edge runtime; os 5 detectores atuais cobrem o caso e o brief permite "≥2 sinais". |
| Redis para cache | **Pulado** | Não está provisionado; usar `candidate_metrics_cache` (Postgres) que já existe. |
| Materialized views + Edge Function queues + filas async | **Diferido** | Mudança de infraestrutura grande. O cron atual roda detecção a cada execução manual + nightly; latência atual é aceitável para o volume real. |
| Tema dark `#0F1117` fixo | **Pulado** | Já temos design tokens semânticos (regra Core); trocar paleta global afeta todo o app. |

## Entregáveis desta fase

1. **1 migração** Postgres (Fase 1) — colunas novas + índices.
2. **`detect-historical-peaks/index.ts`** atualizado (Fase 2) — grava campos novos.
3. **`resolve-peak-cause/index.ts`** atualizado — grava em `ai_summary`/`ai_tags`/`top_headlines`.
4. **`EventReport.tsx`** — adiciona `<AnnualPeaksTimeline>` + Sheet de detalhes (Fase 3 e 4).
5. **Tipos** atualizados em `types.ts` (regenerado após migração).

Estimativa: ~600 linhas modificadas, ~250 novas, 1 migração com ~12 colunas. Sem novas tabelas, sem dados mock, sem quebra do SSOT.

**Aprove para eu rodar:** migração → ajuste das duas edge functions → componentes do frontend.
