
# Plano de Correções — Clima Político

Foco: eliminar LIMITs artificiais, corrigir agregações, e usar 100% dos dados reais em todos os componentes analíticos.

## 1. Reações por Post (`ReactionsPerPost.tsx`)
- Remover `LIMIT 2000` da query — paginar via `range()` em blocos de 1000 até consumir tudo (ou usar agregação SQL via RPC).
- Adicionar seletor de paginação visual: **50 / 100 / 500 / 1000 / Todos**.
- KPIs no topo: total real de posts raiz, comentários, respostas, interações (curtidas+replies+shares).
- Classificação Pos/Neg/Neu calculada sobre **todos** os registros do período, não só os top 10.
- Agrupar posts pelo `post_id` (raiz) + somar métricas das respostas filhas.

## 2. Comparativo Consolidado (`CandidatesComparisonPanel.tsx`)
- Substituir gráfico "Top 5 positivas" por **Donut/Pizza multinível de sentimentos por candidato** (Pos/Neg/Neu por candidato, top 5–10).
- Gráfico "Evolução temporal": agregar `social_interactions` por dia (últimos 7/30 dias) — menções, sentimento médio, engajamento. Nunca renderizar eixo vazio: fallback usa `historical_metrics`.

## 3. Visão por Rede Social (`NetworkView.tsx` + páginas relacionadas)
- Quando filtro = "Todas as redes": somar agregando por `social_network` sem LIMIT.
- Buscar via paginação em loop ou contagem por SQL (`count: 'exact'`).
- Sentimento/engajamento/pizza/linha temporal devem cobrir 100% das coletas do período.
- **Desambiguação de posts relevantes**: criar helper `lib/candidateMatcher.ts` que valida o texto contra:
  - nome completo + sobrenome + cargo + partido + estado
  - blacklist contextual (ex.: "Cristiano", "#futebol" para Ronaldo Caiado)
  - score de relevância contextual (0–1); descartar < 0.4.

## 4. Análise Regional (`RegionalAnalysis.tsx` + `CitiesRanking.tsx`)
- Remover qualquer LIMIT na agregação por cidade/estado.
- Adicionar input de busca por cidade.
- Para cada cidade: total menções, sentimento médio, crescimento %, top 3 candidatos.
- **Invariante**: `Σ menções por cidade ≤ total geral`. Comentários sem geolocalização entram em bucket "Não identificado" — não duplicar.

## 5. Árvore de Comentários (`CommentTree.tsx`)
- Remover `LIMIT 1000` — paginar até esgotar.
- Recursão multi-nível usando `parent_comment_id` (não só 2 níveis raiz↔reply).
- Métricas por nó: pos/neg/neu, likes, replies, shares.
- Card "Repercussão": para cada thread, calcular delta de sentimento entre raiz e respostas + texto curto via IA ("forte polarização", "consenso positivo", etc.).
- Timeline da thread: respostas por hora desde a raiz (linha simples).

## 6. Eventos e Entrevistas (`PoliticalEvents.tsx`)
- Substituir CRUD manual por **detecção automática via IA**.
- UI: seletor de candidato + período → botão "Detectar eventos".
- Edge function nova `auto-detect-events`:
  - Lê `social_interactions` + `historical_metrics` do período.
  - Detecta picos de menção (≥2x baseline) + clusters de hashtags/temas.
  - Usa Gemini Flash para nomear evento (debate, entrevista, comício, fala) e extrair tema.
  - Para cada evento: reação regional (sentimento por região), top comentários, crescimento temporal, hashtags, temas associados.
- Manter tabela `political_events` como cache dos eventos detectados.

## Regra global
- Auditoria: remover todo `.limit(N)` arbitrário em queries analíticas; substituir por paginação completa ou `count: 'exact', head: true` quando só precisar do número.
- Componentes nunca renderizam vazio: estado de loading → fallback histórico → mensagem clara se realmente não há dados.

## Arquivos a editar/criar
- `src/components/dashboard/ReactionsPerPost.tsx` (reescrever query + paginação)
- `src/components/dashboard/CandidatesComparisonPanel.tsx` (novos gráficos)
- `src/pages/dashboard/NetworkView.tsx` (agregação total + desambiguação)
- `src/lib/candidateMatcher.ts` (novo — desambiguação)
- `src/pages/dashboard/RegionalAnalysis.tsx` + `CitiesRanking.tsx` (busca + invariante)
- `src/pages/dashboard/CommentTree.tsx` (recursão + repercussão + timeline)
- `src/pages/dashboard/PoliticalEvents.tsx` (UI de detecção)
- `supabase/functions/auto-detect-events/index.ts` (novo edge function)

## Execução
Faço em 2 lotes:
- **Lote A** (correções de dados/limites): 1, 3, 4, 5
- **Lote B** (gráficos + IA): 2, 6

Confirma "vai" que eu inicio pelo Lote A.
