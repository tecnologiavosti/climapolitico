# Refatoração da aba "Visão por Rede Social" — Stack 100% gratuita

## Objetivo
Remover toda dependência de APIs pagas (Firecrawl, SerpAPI, DataForSEO, Apify) e operar apenas com fontes gratuitas, persistindo evidências reais em `historical_social_mentions`. Nunca inventar dados.

## Arquitetura nova

```text
network-listening (orquestrador)
  ├── news_collector       → Google News RSS
  ├── twitter_collector    → Nitter (rotativo) — falha isolada
  ├── reddit_collector     → Reddit JSON API (gratuita, sem token)
  ├── youtube_collector    → YouTube Data API v3 (YOUTUBE_API_KEY já existe)
  ├── telegram_collector   → Bot API search (gratuito) / placeholder
  ├── tiktok_collector     → scraper HTML público
  └── instagram_collector  → scraper HTML público
```

Cada coletor:
- roda em paralelo, com timeout próprio
- em falha → marca rede como `unavailable` e segue
- grava resultados em `historical_social_mentions` (idempotente por `url`)
- retorna `{ platform, evidence: [...], status }`

Orquestrador:
- agrega evidências
- `render_state = NO_DATA` só se TODAS as redes vierem vazias
- caso contrário `PARTIAL_DATA` / `FULL_DATA` conforme threshold (≥20)
- cache apenas quando `FULL_DATA`

## Mudanças por arquivo

### Edge functions (Deno) — `supabase/functions/`
1. **`_shared/free-collectors.ts`** (novo)
   - `collectGoogleNews(candidate)` — fetch RSS, parse XML manual (sem libs pagas)
   - `collectNitter(candidate)` — tenta instâncias de `nitter_instances`, retorna `{ status: 'unavailable' }` se todas falharem
   - `collectReddit(candidate)` — `https://www.reddit.com/search.json?q=...&sort=new`
   - `collectYouTube(candidate)` — Data API v3 (`search` + `videos` + `commentThreads`)
   - `collectTelegram(candidate)` — busca pública via `t.me/s/<channel>` (best-effort)
   - `collectTikTok(candidate)` — HTML público `tiktok.com/tag/...`
   - `collectInstagram(candidate)` — HTML público `instagram.com/explore/tags/...`
   - cada função: timeout 15s, retorna `{platform, items: NormalizedItem[], status, error?}`
2. **`network-listening/index.ts`** — substituir chamadas Firecrawl/SerpAPI pelos coletores acima, manter cache e thresholds existentes, ajustar `pipeline_used` (`free_listening`).
3. **`historical-social-collector/index.ts`** — mesma substituição para backfill (chunks já corretos).
4. Remover/depreciar funções pagas: `_shared/scrape-utils.ts` (Firecrawl helpers) — manter arquivo mas remover uso; sem deleção destrutiva.

### Persistência
- Upsert em `historical_social_mentions` com `on conflict (url)`.
- Campos: `candidate_id, source, platform, text, author, engagement_score, url, published_at, sentiment`.
- Sentiment: usar heurística simples já existente OU deixar `null` (sem inventar).

### Frontend
- Nenhuma mudança necessária — `NetworkView.tsx` já filtra redes `unavailable` e respeita `render_state`.

## Política
- Sem dados sintéticos. Se 0 menções reais → `NO_DATA`.
- Falha de uma rede ≠ falha global.
- Logs estruturados por rede (`ok_sources`, `failed_ratio`).

## Riscos
- Scrapers HTML (TikTok/Instagram) podem retornar vazio frequentemente — esperado, marcam `unavailable`.
- Reddit/YouTube/Google News são os pilares estáveis.

Aprove para eu implementar.
