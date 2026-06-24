
# Refator Catálogo de Candidatos — Base TSE Nacional

## 1. Nova tabela `politicians` (substitui `public_candidates_catalog` como fonte do catálogo)

Migration cria:

- `politicians` com colunas: `id`, `tse_id` (SQ_CANDIDATO), `nome`, `nome_urna`, `nome_normalizado`, `cpf_hash`, `partido_sigla`, `partido_nome`, `numero_partido`, `cargo` (enum textual: presidente, vice_presidente, governador, vice_governador, senador, deputado_federal, deputado_estadual, deputado_distrital, prefeito, vice_prefeito, vereador, ministro, presidente_partido), `regiao` (norte/nordeste/centro_oeste/sudeste/sul/nacional), `estado` (UF), `municipio`, `eleito` (bool), `ativo` (bool), `ano_eleicao`, `foto_url`, `redes_sociais` (jsonb), `popularidade` (numeric), `search_tsv` (tsvector gerado), `created_at`, `updated_at`.
- Índices: GIN em `search_tsv` e em `nome_normalizado gin_trgm_ops`; BTREE em `(cargo, estado, partido_sigla)` e `(ativo, eleito, popularidade desc)`; unique em `tse_id`.
- Trigger `politicians_refresh` atualiza `nome_normalizado` (`unaccent(lower(nome))`) e `search_tsv` em insert/update.
- RLS: SELECT público (`anon`, `authenticated`); INSERT/UPDATE/DELETE restritos a `service_role` (ETL).
- GRANTS conforme regra do projeto.
- RPC `search_politicians(q, p_cargo[], p_partido[], p_regiao[], p_estado[], p_municipio, p_only_eleitos, p_limit, p_offset)` retornando rows + `total_count` + `suggestions` (top 5 via similarity quando q não retorna nada).
- RPC `suggest_politicians(q, limit)` usando `similarity()` para "Você quis dizer…".

## 2. Edge Function ETL `etl-tse-politicians`

- Baixa CSVs do TSE Dados Abertos por ano (2022 federais, 2024 municipais) — URLs oficiais `cdn.tse.jus.br`.
- Streaming + parse CSV (`;`, latin1) chunk a chunk para não estourar memória.
- Normaliza cargo TSE → enum interno; deriva `regiao` da UF.
- Upsert em lotes de 1000 por `tse_id`.
- Marca `ativo=false` em registros não vistos no ciclo (soft delete).
- Logs em `edge_function_logs`; idempotente.
- Auth: somente `service_role` (chamado pelo cron). `verify_jwt = false` + validação por token interno.

## 3. Cron diário

- `pg_cron` + `pg_net` agendam POST diário às 04:00 BRT para a edge function.
- Insert via tool `supabase--insert` (contém URL/key específicos do projeto).

## 4. Seed inicial

- Edge function dispara automaticamente no primeiro deploy via botão admin (não bloqueia migration).
- Admin: botão "Sincronizar TSE agora" em `AdminCandidates.tsx`.

## 5. Frontend

- `useCatalogSearch.ts`: trocar RPC `search_catalog` → `search_politicians`; expor `suggestions` e `totalCount`.
- `CatalogFilters.tsx`: filtros por cargo (lista completa), partido (autocomplete), região, estado (UF), município (texto), toggle "Somente eleitos".
- `CandidatesCatalog.tsx`: paginação tradicional 50/página (substitui scroll infinito conforme pedido); banner "Você quis dizer: X, Y, Z?" quando `total=0` e `suggestions.length>0`.
- `CandidateCatalogCard.tsx`: já cobre foto/nome/partido/cargo/estado/redes; adicionar badge "Eleito".
- Remover toda referência ao catálogo antigo `public_candidates_catalog` no frontend do catálogo (a tabela permanece para outras features que dependem dela).

## 6. Busca fuzzy

- 100% no banco via `pg_trgm` + `unaccent`:
  - tsquery em `search_tsv` (peso A: nome, B: partido, C: cargo+estado)
  - fallback `similarity(nome_normalizado, unaccent(lower(q))) > 0.25` ordenado por similaridade
  - `suggestions`: top 5 nomes distintos por similaridade quando 0 resultados.

## 7. Arquivos

Criar:
- `supabase/functions/etl-tse-politicians/index.ts`

Editar:
- `src/hooks/useCatalogSearch.ts`
- `src/components/dashboard/CatalogFilters.tsx`
- `src/components/dashboard/CandidateCatalogCard.tsx`
- `src/pages/dashboard/CandidatesCatalog.tsx`
- `src/pages/admin/AdminCandidates.tsx` (botão sync)

Migrations:
- Criação da tabela + RPCs + RLS + grants.
- Insert (não migration) com `cron.schedule` para o job diário.

## 8. Observações técnicas

- Dataset TSE completo de candidatos 2022+2024 fica ~600MB descompactado. A função processa em streaming por UF para caber no tempo limite (até 150s) — se necessário, divide em múltiplas execuções por UF via parâmetro `?uf=SP`.
- Primeiro carregamento total pode levar várias horas distribuídas (uma chamada por UF). O cron diário só pega deltas (upsert).
- `popularidade` inicial = heurística (1.0 eleitos federais, 0.8 estaduais, 0.5 municipais); pode ser refinada depois com dados de menções.
