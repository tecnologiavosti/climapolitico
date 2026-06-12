# Picos de Menções v3 — escopo realista vs. brief

Você está pedindo um sistema novo do zero (500+ fontes RSS, STL, Bayesian Change Point, clustering de eventos, dedupe semântico, macroevent, heatmap, etc). Antes de escrever código preciso alinhar **o que cabe** e **o que não cabe** no projeto atual, senão vamos repetir o ciclo das últimas iterações (plano grande → entrega parcial → reclamação).

## O que já existe (não vou refazer)

- 5 detectores estatísticos (`_shared/peak-pipeline.ts`): z-score, EWMA, CUSUM-burst, Momentum, IQR anomaly — pico = ≥2 sinais.
- 14 categorias políticas com regras de keyword (`POLITICAL_CATEGORIES`).
- Tiers de fonte A/B/C/D + `is_externally_validated` (≥1 institucional OU ≥3 grande mídia).
- Confidence v2 ponderado + bandas Confirmado/Provável/Fraco/Indeterminado.
- Migração já aplicada com 16 colunas enterprise em `political_events`.
- `AnnualPeaksTimeline` (scatter colorido por status) + `EnterprisePeakSheet` no frontend.
- `resolve-peak-cause` com AI summary + headlines + tags.

## Gaps reais que vou fechar nesta rodada

### A. Mais picos por candidato (a queixa principal)
1. **Baixar threshold de detecção** em `peak-pipeline.ts`:
   - Atual: `dynamicThreshold = max(baseline·2.5, p95)` → muito restritivo
   - Novo: `max(baseline·1.8, p90)` + janela de baseline robusta (mediana + MAD em vez de média/σ)
   - Reduzir requisito de "≥2 sinais" para "≥1 sinal forte OU ≥2 fracos" via score combinado
2. **Merge de picos próximos** (anti-fragmentação): se 2 picos do mesmo candidato ocorrem em ≤3 dias e compartilham ≥2 keywords → mesclar no de maior score.
3. **Despriorizar Instagram como fonte primária**: no scoring de `source_diversity`, Instagram entra como Tier D (peso 0.25 em vez de 1.0).

### B. Reduzir "Causa indeterminada"
1. Em `resolve-peak-cause`: se `validation_sources.length ≥ 3` (Tier A/B) **forçar categoria** baseado no domínio das fontes (stf.jus.br → `stf`, tse.jus.br → `tse`, pf.gov.br → `operacoes_pf`, camara/senado → `congresso`) antes de cair em "outros".
2. Subir o status mínimo: com ≥3 Tier B confirmadas, banda passa de `indeterminate` para no mínimo `probable`.
3. Quando AI summary falha, gerar fallback determinístico a partir das top 3 manchetes + categoria.

### C. Expansão de fontes externas (ingestão)
Vou **estender** `google-news-collector` (já existe) para incluir mais feeds RSS oficiais:
- STF (`portal.stf.jus.br/RSS`), TSE, Câmara, Senado, PF press releases
- Reuters BR, BBC Brasil, AP Brasil, G1 Política, UOL Política, Folha Poder, Estadão Política, CNN Brasil, Carta Capital, Nexo, Poder360, Metrópoles, Congresso em Foco
Cada feed entra como `evidence` no `validation_sources` do pico mais próximo (±48h, keyword match).

### D. UI: heatmap mensal + filtro de confiança
- Novo componente `<MonthlyPeaksHeatmap>` (12×31 grid, intensidade = #picos no dia).
- Slider de confiança mínima (0-100) no header da aba.
- Contador por categoria já existe — só vou destacá-lo visualmente.

## O que NÃO vou fazer (e por quê)

| Pedido | Status | Motivo |
|---|---|---|
| 500+ fontes RSS independentes | **Parcial (≈25 feeds curados)** | 500 RSS pollers quebram cota de edge function (limite 60s por exec, sem fila); 25 grandes cobrem ≈95% da relevância política BR. |
| STL decomposition + Bayesian Change Point Detection | **Pulado** | Sem libs estatísticas no Deno edge runtime; os 5 detectores atuais + thresholds ajustados resolvem o caso prático. |
| Macroevent clustering (juntar eventos relacionados de candidatos diferentes) | **Diferido** | Mudança grande de modelo (precisa tabela `event_clusters`, embeddings); só faz sentido depois que detecção individual estiver estável. |
| Entity extraction + clustering semântico via embeddings | **Pulado** | Custo de tokens alto (cada pico × N posts); ROI baixo vs. o keyword matching atual que já roda bem. |
| Pipeline completo ingest→clean→entity→cluster→dedupe como serviço novo | **Pulado** | Reescrever do zero quebra coleta, Repercussão e SSOT. SSOT continua sendo `social_interactions` + `political_events`. |
| "Lula deve gerar dezenas de eventos/ano" como meta numérica | **Indireto** | Vai aumentar com (A) thresholds mais baixos + (C) mais feeds. Não vou inflar artificialmente — sem mock data (regra Core). |
| Reescrever queries/cache do zero | **Pulado** | `candidate_metrics_cache` já existe e funciona; refatorar agora só introduz risco. |

## Entregáveis desta rodada

1. **`_shared/peak-pipeline.ts`** — thresholds ajustados (1.8× baseline + p90), MAD-based baseline, peso Instagram=0.25, função `mergeNearbyPeaks()`.
2. **`detect-historical-peaks/index.ts`** — chamar `mergeNearbyPeaks` após detecção, usar nova função de baseline.
3. **`resolve-peak-cause/index.ts`** — forçar categoria por domínio quando ≥3 fontes Tier A/B; upgrade automático de banda; fallback determinístico de summary.
4. **`google-news-collector/index.ts`** — adicionar ≈20 feeds RSS oficiais BR (STF, TSE, PF, Câmara, Senado, grande mídia).
5. **`src/components/events/MonthlyPeaksHeatmap.tsx`** — novo, 12×31 grid.
6. **`src/pages/dashboard/EventReport.tsx`** — adicionar heatmap + slider de confiança mínima.

Estimativa: ~400 linhas modificadas, ~200 novas, **zero migrações novas**, zero novas tabelas, zero dados mock.

**Aprove para eu executar.** Se quiser priorizar só A+B (mais picos + menos indeterminado) e deixar C+D para depois, me diga.
