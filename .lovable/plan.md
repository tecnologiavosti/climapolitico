# Refator Enterprise — Aba "Picos de Menções"

Vou reestruturar todo o pipeline mantendo SSOT (`social_interactions`) e o cron existente, mas trocando o detector, o validador e a UI por módulos profissionais.

## 1. Novos módulos compartilhados (`supabase/functions/_shared/peaks/`)

```text
peaks/
 ├─ source-registry.ts      # 300+ portais + RSS + institucionais classificados por tier (A/B/C/D)
 ├─ ingestion.ts            # Firecrawl search + RSS fetch + dedup por URL/hash semântico
 ├─ entity-extractor.ts     # match candidato (nome, apelidos, @handle, variações)
 ├─ time-series.ts          # constrói série diária por candidato (SSOT + externos)
 ├─ detectors.ts            # zScore, ewma, cusum, burst, momentum, iqrAnomaly → DetectorSignals
 ├─ dynamic-threshold.ts    # max(baseline*2.5, p95) por candidato + janela 90d
 ├─ clustering.ts           # embeddings (google/gemini-embedding-001) + cosine ≥0.78
 ├─ taxonomy.ts             # 14 categorias + score por keyword com threshold mínimo
 ├─ validator.ts            # Tier A/B/C/D; confirma se ≥3 Tier A ou ≥1 institucional
 ├─ confidence.ts           # score ponderado (fórmula do brief) → confirmed/probable/weak/indeterminate
 └─ ai-summarizer.ts        # gemini-3-flash factual, sem alucinação, com citações
```

### Fórmula de confidence (fiel ao brief)
```
score = 0.20*z + 0.15*burst + 0.15*momentum
      + 0.20*source_diversity + 0.10*source_authority
      + 0.10*cross_platform + 0.10*political_relevance
```
Bandas: ≥85 confirmed · 70–84 probable · 50–69 weak · <50 indeterminate. **Nenhum evento é descartado.**

### Tiers de fonte
- **A (peso 1.0):** g1, folha, estadão, uol, cnn, globo, reuters, bbc, ap, valor, oglobo, veja, poder360, agência brasil, metrópoles
- **B (0.7):** regionais verificados (~200 portais)
- **C (0.4):** blogs políticos verificados
- **D (0.0, bloqueado como evidência):** instagram, facebook, youtube, tiktok, telegram, x/twitter, threads, reddit
- **Institucional (peso 1.5):** stf.jus.br, tse.jus.br, pf.gov.br, gov.br, senado.leg.br, camara.leg.br, planalto.gov.br

## 2. Edge functions

**`detect-historical-peaks/index.ts`** — orquestrador:
1. Carrega 365d de série temporal (SSOT) por candidato
2. Roda **5 detectores em paralelo** (z, ewma, cusum, burst, momentum) + IQR
3. Pico = ≥2 sinais OR z≥2.0 com threshold dinâmico
4. Cluster por embeddings (janela ±3d)
5. Para cada cluster: Firecrawl search (Tier A/B + institucionais) → validator
6. Classifica via taxonomy → resolve cause via AI summarizer
7. Calcula confidence → grava `political_events` com `status`, `signals`, `tier_breakdown`, `evidence_urls`

**`resolve-peak-cause/index.ts`** — recebe evidências já validadas, gera resumo factual; nunca chama IA se evidência insuficiente (retorna "Causa indeterminada").

**`ingest-external-sources/index.ts`** (novo) — cron 30min:
- Lê RSS feeds (registry)
- Firecrawl scrape em portais Tier A
- Insere em nova tabela `external_mentions` (raw evidence pool)

## 3. Banco de dados (migração)

- `external_mentions` (id, candidate_id, source_host, source_tier, url, title, content, published_at, embedding vector(3072))
  - índice HNSW em `embedding`, índice em `(candidate_id, published_at)`
- `political_events`: adicionar colunas `status`, `signals jsonb`, `tier_breakdown jsonb`, `evidence_urls text[]`, `confidence_band`, `dynamic_threshold`
- pgvector enable + GRANTs + RLS

## 4. Frontend — `src/pages/dashboard/EventReport.tsx`

- Header com 5 contadores clicáveis: Total · Confirmados (🟢) · Prováveis (🟡) · Fracos (🟠) · Indeterminados (🔴)
- **Timeline anual** (recharts) com pontos coloridos por status, tooltip com título
- Filtros: categoria (14), status, período, tier de fonte
- Card de evento: título, data, categoria, badges de sinais (Z·EWMA·CUSUM·Burst·Momentum), confidence bar, lista de evidências (favicon + host + link), resumo IA com disclaimer
- Skeleton states + virtualização para >100 picos

## 5. Performance

- Particionamento mensal lógico em queries (range em `published_at`)
- Cache de embeddings por hash de texto
- Detectores em `Promise.all`
- Validator em batches de 10 candidatos
- Materialized view `mv_candidate_daily_volume` (refresh diário)

## 6. Não muda

SSOT (`social_interactions`), coleta de redes sociais, sentimento, repercussão de eventos, autenticação, billing.

## Entregáveis

- 11 arquivos novos em `_shared/peaks/`
- 1 nova edge function `ingest-external-sources`
- 2 edge functions reescritas (`detect-historical-peaks`, `resolve-peak-cause`)
- 1 migração (pgvector + colunas + tabela + MV)
- `EventReport.tsx` reescrito (~400 linhas)
- Estimativa: ~2.000 linhas, ~15 min de execução

## Meta de qualidade

Para Lula/Bolsonaro: **30–80 picos/ano** detectados, ≥60% com status ≥ probable, zero invenção de eventos sem evidência Tier A/B.

Aprove para eu executar tudo em sequência (migração primeiro, depois código).
