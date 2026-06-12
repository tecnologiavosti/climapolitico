# Refatoração: Clima Político → Radar Político

Transformação para algo **simples, rápido e confiável**, estilo Bloomberg/Reuters.

## 1. Renomear

- Sidebar, rotas, breadcrumbs, títulos: **Clima Político → Radar Político**
- Manter rota acessível (alias `/dashboard/clima-politico` → redirect para `/dashboard/radar-politico`)

## 2. Backend simplificado

### Migration: limpeza da `political_events`

Manter apenas colunas essenciais:
```
id, candidate_id, user_id, title, summary, category,
event_date, source_count, social_score, importance, status,
created_at, updated_at
```
Demais colunas (z_score, baseline, ewma, burst, anomaly, momentum, peak_score, tier_breakdown, network_distribution, etc.) são **dropadas**.

`event_sources` já existe — adequar para: `id, event_id, source_name, url, type (institutional|news|social), credibility, published_at`.

Tabelas removidas/depreciadas: `social_event_metrics` (manter só se útil internamente), nenhum uso em UI.

### Classificação `importance`
- `grande` > 25
- `medio` 12–25
- `pequeno` < 12

### Pipeline novo (edge functions)

Reescrever stack em **3 funções simples**:

1. **`fetch-institutional-events`** — coleta RSS/feeds STF, TSE, PF, Senado, Câmara, G1, UOL, Folha, Estadão, Reuters, Poder360.
2. **`match-events-to-candidates`** — filtra/clusteriza eventos por candidato (nome + apelidos + cargo).
3. **`score-social-repercussion`** — para cada evento, mede repercussão em X, YouTube, Telegram, Reddit (apenas como `social_score`, nunca como fonte do evento).

Orquestrador `run-radar-pipeline` chamado por cron (30 min).
**Regra dura**: evento só nasce de fonte institucional/notícia. Social é apenas métrica derivada.

Metas de volume: Lula ≥ 80 eventos/mês, Flávio ≥ 40.

## 3. UI nova — `RadarPolitico.tsx`

Substitui página atual. Layout limpo:

```text
┌─ Header ─────────────────────────────────────────┐
│  Radar Político    [candidato ▾] [ano ▾] [filtros]│
├─ KPIs ───────────────────────────────────────────┤
│  [Eventos]  [Grandes]  [Médios]  [Pequenos]      │
├─ Timeline mensal (barra simples) ────────────────┤
│  J F M A M J J A S O N D                         │
├─ Lista de cards compactos ───────────────────────┤
│  • Título · data · categoria                     │
│    n fontes · repercussão · resumo curto         │
└──────────────────────────────────────────────────┘
```

Design: tipografia séria, alto contraste, sem gradientes, sem heatmaps, sem badges coloridos exagerados.

### Componentes a **remover** (arquivar):
- `EnterprisePeakSheet`, `MonthlyPeaksHeatmap`, `AnnualPeaksTimeline` (versão antiga complexa), score composition, network distribution, qualquer UI com z-score/ewma/burst/anomaly/momentum/baseline/cause indeterminada.

### Componentes a **criar**:
- `RadarHeader` (candidato + ano + filtros)
- `RadarKPIs` (4 cards)
- `RadarMonthlyTimeline` (barra simples por mês)
- `RadarEventCard` + `RadarEventList`
- `RadarEventDetailSheet` (versão minimalista: título, resumo, lista de fontes com link, social_score)

### Hook
- `useRadarEvents(candidateId, year, filters)` → lê `political_events` direto, ordenado por `event_date desc`.

## 4. Execução

Ordem:
1. Migration (drop columns + ajuste event_sources)
2. Edge functions novas + cron
3. Página + componentes novos
4. Remover/redirect rota antiga
5. Backfill manual disparando pipeline 1x para popular volume

## Detalhes técnicos

- Não tocar em `social_interactions` (SSOT).
- `social_score` = engagement normalizado (0–100) dos posts que citam o evento.
- `importance` = `min(100, source_count*2 + log(social_score+1)*5 + institutional_bonus)`.
- Cron `*/30 * * * *` chama `run-radar-pipeline` global.
- Frontend usa apenas Tailwind tokens já existentes; sem cores hardcoded.

Confirma para eu começar?
