
# Refatoração: Catálogo Político Híbrido (TSE + Pré-candidatos IA)

Entrega completa em um único ciclo. Nome da página mantido. Inclui crawler social via cron.

---

## 1. Banco de Dados (migração)

### Tabela `pre_candidates`
Campos conforme spec: `id, nome, nome_normalizado, estado, municipio, cargo_sugerido, partido_sugerido, instagram, facebook, tiktok, youtube, mentions_30d, engagement_score, sentiment_score, growth_score, confidence_score, source, reason, status, created_at, updated_at`.

- Índices: `nome_normalizado`, `(estado, municipio)`, `confidence_score DESC`.
- `UNIQUE (nome_normalizado, estado, municipio, cargo_sugerido)` para deduplicar.
- GRANTs: `SELECT` para `anon` e `authenticated`; `ALL` para `service_role`.
- RLS: leitura pública; escrita só `service_role`.
- Trigger `updated_at`.

### Tabela `pre_candidate_signals` (sinais brutos coletados)
`id, pre_candidate_id, source (instagram|tiktok|facebook|youtube|news|web), url, snippet, matched_keywords text[], collected_at`. RLS service-role-only.

### Cache de IA
Reaproveita `analysis_cache` existente com namespace `precand-classify:<nome_normalizado>` (TTL 24h).

### Adicionar `candidate_type` no resultado do catálogo
Não altera tabela `politicians`; o tipo é derivado no merge (`official` para TSE, `pre_candidate` para tabela nova, `monitored` para resultados web).

---

## 2. Edge Functions (novas)

### `classify-political-figure`
Input: `{ nome, contexto?, estado?, municipio? }`. Chama `callAICerebrasFirst` com o prompt da spec. Cacheia em `analysis_cache`. Se `confidence >= 70` faz upsert em `pre_candidates`. Retorna o JSON da IA.

### `social-political-crawler` (rodada via cron)
- Lista keywords: `pré-candidato, candidatura, eleições 2026, meu nome está à disposição, rumo a Brasília, rumo à prefeitura, vamos reconstruir, conto com vocês em 2026`.
- Usa Firecrawl Search (`tbs: qdr:w`) para varrer cada keyword + site filters (`site:instagram.com`, `site:tiktok.com`, `site:facebook.com`, `site:youtube.com`).
- Extrai nome candidato dos resultados (regex + IA leve).
- Para cada nome novo: insere sinal em `pre_candidate_signals` e dispara `classify-political-figure`.
- Limites: máx. 30 resultados por keyword por execução para controlar custo.

### `catalog-search-hybrid`
Wrapper único chamado pelo frontend. Faz em paralelo:
1. `tse-search` (existente).
2. Query em `pre_candidates` (filtros equivalentes).
3. Web search (Firecrawl) — só se `tse + pre` retornarem < 5 resultados, com cache 15min.

Merge:
- Deduplica por `nome_normalizado + estado + (municipio||cargo)`.
- Anota `candidate_type` em cada linha.
- Ordena por: `eleito desc, confidence_score desc, popularidade desc`.

### Cron
Via `supabase--insert` no `cron.schedule`: `social-political-crawler` a cada 6h.

---

## 3. Frontend

### `CatalogFilters.tsx`
Novo grupo de chips "Tipo": `Oficiais`, `Pré-candidatos`, `Ambos` (default `Ambos`). Estado em `CatalogFilters.candidateType`.

### `useCatalogSearch.ts`
- Adiciona campo `candidateType` ao filtro.
- Troca `tse-search` por `catalog-search-hybrid`.
- Tipo `PoliticianRow` ganha `candidate_type: 'official' | 'pre_candidate' | 'monitored'` e `confidence_score?`.

### `CandidateCatalogCard.tsx`
Badge no canto superior:
- 🟢 `Oficial TSE` (official)
- 🟡 `Pré-candidato IA` + tooltip mostrando `confidence_score`
- 🔵 `Figura monitorada` (monitored)

### `CandidatesCatalog.tsx`
Quando resultado total = 0 após hybrid:
```
Não encontramos esse nome nas bases oficiais.
Deseja monitorar essa pessoa como pré-candidato?
[ Adicionar como pré-candidato ]
```
Botão abre o `AddCandidateDialog` existente já preenchido com o `q` digitado, marcando `type=pre_candidate`.

Nome da página: mantido conforme escolha do usuário.

---

## 4. Performance / Cache

- `pre_candidates` query: `staleTime: 5 * 60_000` no React Query.
- Web search dentro do hybrid: cache em `analysis_cache` chave `web:<hash(filters)>` TTL 15min.
- IA classify: cache 24h (já descrito).

---

## 5. Detalhes Técnicos

- Normalização de nome: reusar `src/lib/candidateNameNormalizer.ts`.
- Helper compartilhado `_shared/normalize.ts` na função para manter consistência server-side.
- Firecrawl via secret `FIRECRAWL_API_KEY` (já presente no projeto; se faltar, solicitar).
- IA via `_shared/cerebras-ai.ts` (chain Cerebras→Groq→Gemini→OpenRouter→Mistral→Lovable).
- `verify_jwt = false` apenas se necessário; default mantém autenticação.

---

## 6. Riscos Conhecidos

- Crawler social: Instagram/TikTok bloqueiam scraping; cobertura real virá majoritariamente de Google indexado via Firecrawl Search. Documentado nos logs.
- Custo de IA: cap de 30 nomes/keyword/execução + cache 24h.
- Falsos positivos em `pre_candidates`: threshold `confidence >= 70` + campo `status='auto_detected'` para revisão futura.

---

## 7. Ordem de Implementação

1. Migração `pre_candidates` + `pre_candidate_signals` (aprovação do usuário).
2. Edge functions `classify-political-figure`, `social-political-crawler`, `catalog-search-hybrid`.
3. Cron job (insert SQL).
4. Frontend: filtros, badges, hybrid hook, CTA vazio.
5. Smoke test rápido via browser/Playwright no `/dashboard/catalog`.
