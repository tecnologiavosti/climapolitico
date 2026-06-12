## Refator completo — Clima Político > Picos de Menções

Objetivo: detectar dezenas de picos políticos reais por ano para figuras de alta relevância (Lula, Bolsonaro), sem alucinação, com classificação correta e relevância calibrada.

### Arquitetura nova (pipeline modular)

```text
SSOT (social_interactions)
   │
   ▼
[1] Ingestão por tiers (A/B/C/D)        ── _shared/source-tiers.ts
   │
   ▼
[2] Spike detector híbrido               ── _shared/spike-detector.ts
   (zscore + momentum + burst + anomaly)
   │
   ▼
[3] Entity clustering (embeddings)       ── _shared/event-clustering.ts
   (Lovable AI embeddings + cosine)
   │
   ▼
[4] Evidence collector (Tier A/B só)     ── _shared/evidence-collector.ts
   (Firecrawl search + filtro de domínios)
   │
   ▼
[5] Event resolver                       ── resolve-peak-cause/index.ts
   (confirmed / probable / weak / indeterminate)
   │
   ▼
[6] Category classifier (score-based)    ── _shared/category-classifier.ts
   (default = outros, nunca TSE fallback)
   │
   ▼
[7] Relevance engine                     ── _shared/relevance-engine.ts
   (volume + engajamento + duração + autoridade + impacto)
   │
   ▼
[8] UI EventReport.tsx
   (contadores: total/confirmados/prováveis/indeterminados)
```

### Mudanças por arquivo

**Novos módulos shared (`supabase/functions/_shared/`)**
- `source-tiers.ts` — 4 tiers (A: Reuters/BBC/STF/TSE/PF/Senado/Câmara/gov.br/Folha/G1/Estadão; B: regionais/Metrópoles/Poder360/CNN BR; C: contas verificadas; D: Instagram/TikTok/Telegram/Facebook/YouTube → BLOQUEADO como evidência). Função `classifySource(url, outlet) → {tier, weight, isExternalEvidence}`. Apenas Tier A/B contam como evidência externa.
- `spike-detector.ts` — detector híbrido:
  - z-score (janela 14d, threshold ≥2.0, **mais sensível** que o atual 2.5)
  - momentum (derivada 3d > 1.5× média 7d)
  - burst (CUSUM acumulado > threshold)
  - anomaly (IQR outlier, mentions > Q3 + 1.5×IQR)
  - pico = OR de qualquer 2 dos 4 sinais + volume mínimo (≥20/dia, reduzido de 30)
- `event-clustering.ts` — clusteriza menções diárias em eventos semânticos via embeddings (`google/gemini-embedding-001`) + cosine similarity (threshold 0.78). Janela ±2 dias. Evita dividir um mesmo evento em vários picos.
- `category-classifier.ts` — score por categoria com threshold mínimo. **Default sempre `outros`** (jamais TSE). Termos TSE exigem ≥2 pts explícitos (tse / tribunal superior eleitoral / justiça eleitoral / inelegibilidade / urna).
- `relevance-engine.ts` — score 0–100:
  - volume (log-scale, ceiling 5k) — peso 30%
  - engajamento (log-scale, ceiling 1M) — peso 25%
  - duração (dias) — peso 15%
  - autoridade da fonte (Σ pesos tier A/B) — peso 20%
  - impacto político (heurística por categoria) — peso 10%
  - bandas: baixa <30, média 30-54, alta 55-79, crítica ≥80

**`supabase/functions/detect-historical-peaks/index.ts`**
- Substitui pipeline atual pela orquestração dos 7 módulos acima.
- Para cada candidato: detecta picos híbridos → clusteriza → busca evidência (Firecrawl, Tier A/B apenas) → classifica → calcula relevância → resolve causa.
- Devolve para cada evento: `status`, `category`, `relevance`, `relevance_band`, `evidence_count`, `tier_breakdown`, `signals` (quais detectores dispararam).
- Remove o filtro que descarta indeterminados — agora todos passam, UI decide exibição.

**`supabase/functions/resolve-peak-cause/index.ts`**
- Status passa a ter 4 níveis: `confirmed` (≥2 fontes Tier A independentes), `probable` (≥1 Tier A ou ≥2 Tier B), `weak` (apenas Tier B/C ou 1 Tier B), `indeterminate` (<0.5 weight). 
- Sem evidência Tier A/B → IA não é chamada, retorna `indeterminate` com `title: "Causa indeterminada"`.
- Prompt factual reforçado: proíbe inventar fatos, exige citação por URL.

**`src/pages/dashboard/EventReport.tsx`**
- Header: cards com 4 contadores (Total / 🟢 Confirmados / 🟡 Prováveis / 🟠 Fracos / 🔴 Indeterminados).
- Badge de status nos cards (4 cores).
- Filtro por status além de categoria.
- Mostra `signals` no card (quais detectores dispararam: Z, Momentum, Burst, Anomaly).
- Categorias = 10 obrigatórias + "Todos".

### O que NÃO muda
- SSOT (`social_interactions`), coleta, cron, sentimento, outras abas, detector de picos da aba Repercussão.

### Critérios de aceite
- Lula / Bolsonaro: ≥20 picos detectados em 12 meses (vs 2 hoje).
- Nenhum evento com 0 fontes Tier A/B é exibido como `confirmed`.
- Categoria "Outros" e "TSE" deixam de absorver a maioria dos eventos.
- Instagram/TikTok/Telegram nunca contam como evidência externa.
- Relevância varia em 0–100 (não fica concentrada em uma faixa).
- UI mostra contadores totais e por status.

### Estimativa
~600 linhas em 5 novos módulos shared, ~200 linhas refatoradas em `detect-historical-peaks`, ~80 em `resolve-peak-cause`, ~120 em `EventReport.tsx`. Embeddings via Lovable AI Gateway (sem chave do usuário).
