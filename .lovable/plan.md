## Refatoração — Visão por Rede Social

Refatoração end-to-end. Vou executar em **4 PRs lógicos sequenciais** dentro deste turno (todos no mesmo commit), na ordem abaixo, porque há dependências entre eles.

---

### PR 1 — Backend: instrumentação, persistência e cache (Partes 1, 2, 3)

**`supabase/functions/network-listening/index.ts`**
- Adiciona logger estruturado por fonte: `source_name`, `request_url`, `status_code`, `response_size`, `mentions_found`, `elapsed_ms`.
- Conta falhas (HTTP 4xx/5xx/timeout/empty). Se `failed/total > 0.7` → resposta com `collection_status: "failed_external_sources"` + `fallback: true`, **status 200** (sem 500).
- Envolve `runHistoricalBackfill()` com logs de `before_insert`, `insert_payload` (apenas count + sample), `insert_error`, `rows_inserted`.
- Cache: só grava quando `evidence_count >= 20`. Nunca grava `evidence_count === 0`. Lê cache somente se `evidence_count >= 20` e dentro do TTL.

**Migração SQL**
- `DELETE FROM network_view_cache WHERE (payload->>'evidence_count')::int < 20 OR payload->>'render_state' = 'NO_DATA';`
- Verifica RLS de `historical_social_mentions` para `service_role`; adiciona policy/grant se faltar.

---

### PR 2 — Eliminar fallback heurístico (Parte 4)

**`supabase/functions/network-listening/index.ts`** + helpers
- Remove qualquer função que gere: menções estimadas, interações estimadas, hashtags genéricas, assuntos artificiais, percentuais sintéticos por rede.
- Substitui por retorno explícito:
  ```json
  { "evidence_count": 0, "render_state": "NO_DATA", "message": "Histórico insuficiente para análise quantitativa neste período." }
  ```

---

### PR 3 — Pipelines por período + backfill em chunks (Partes 5, 6)

**`network-listening/index.ts`** — roteamento por `period`:
- `7d / 30d / 90d` → `liveSocialListening()` (X, Reddit, YouTube, Telegram, TikTok, news recentes).
- `1y` → `historical_social_mentions` + Google News + backfill incremental se < 50 rows.
- `4y` → índice histórico + arquivos + Google Trends + IA contextual (sem números inventados).
- `8y` → análise histórica (eleições/mandatos/eventos) — sem scraping live.

**`historical-social-collector/index.ts`**
- `runHistoricalBackfill({ period })` em chunks: 1y=12 mensais, 4y=16 trimestrais, 8y=32 trimestrais.
- Emite progresso por chunk via `realtime` channel `backfill:{candidate_id}` com `{ window: X, total: Y, mentions_found: N }`.

---

### PR 4 — Frontend: renderização por evidência (Partes 7, 8)

**`src/pages/dashboard/NetworkView.tsx`** + `src/lib/networkVisibility.ts`
- Esconde redes sem evidência real (não renderiza placeholders "Sem dados").
- Estados:
  - `evidence_count === 0` → mensagem + botão "Tentar novamente". Esconde cards/gráficos/assuntos/termos.
  - `0 < evidence_count < 20` → apenas análise qualitativa textual.
  - `evidence_count >= 20` → UI completa.
- Subscreve canal `backfill:{candidate_id}` e exibe "Janela X/Y · N menções encontradas" em tempo real.

---

### Notas técnicas

- Nenhuma mudança de schema além da limpeza de cache + verificação de grants em `historical_social_mentions`.
- Todos os logs vão para `console.log/warn` (já capturados pelo edge function logs).
- Nenhum 500 sai mais do `network-listening` — erros recuperáveis voltam com `status:200, fallback:true`.
- Sem mudança visual de design system; só lógica de exibição condicional.

### Escopo fora deste turno

- Integração de novas fontes históricas (arquivos jornalísticos pagos, APIs Google Trends oficiais) — exigem secrets/contratos. Vou usar o que já está plugado (Firecrawl, Google News, GDELT como fallback).
- Tuning de TTL do cache por período pode precisar ajuste após observar dados reais.