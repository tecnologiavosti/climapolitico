# Overhaul completo da aba `network-view`

Escopo grande (12 frentes). Vou executar em **3 fases** para entregar valor incremental e permitir validação intermediária.

---

## FASE 1 — Correções críticas de dados (prioridade máxima)

Objetivo: parar de mostrar números irreais e quebrar a credibilidade.

### 1.1 Top Posts funcionando
- Corrigir a invocação `supabase.functions.invoke("social/top-posts")` — hoje retorna erro.
- Refatorar edge function `social/index.ts` rota `top-posts`:
  - Buscar de `social_interactions` (SSOT) por rede.
  - Score: `likes*1 + comments*2 + shares*3 + views*0.1`.
  - Retornar top 10 com thumbnail, autor, rede, métricas, sentimento, link original.
- Fallback elegante (empty state) em vez de erro vermelho.

### 1.2 Hashtags lixo removidas
- Endurecer `isValidHashtag()` no frontend + replicar no RPC `network_view_content_metrics`:
  - bloquear `length > 40`
  - bloquear `/(.)\1{6,}/` (caracteres repetidos)
  - blocklist: `fyp, fypp, fyppp..., viral, funny, funnyvideos, foryou, foryoupage, parati, viral2024, trending`
- Só hashtags politicamente relevantes (mínimo 1 letra, sem spam).

### 1.3 Crescimento sem explodir
- Regra dura: `if (previous < 10) return null` → exibir **"Sem base histórica suficiente"**.
- Aplicar em KPI de crescimento, hashtags (prev_c), e tópicos (prev_mentions).
- Cap visual em ±500% para casos de borda já válidos.

### 1.4 Fallback de baixo volume
- Se `total < 50`: ocultar heatmap, hashtags, dominant topics e mostrar mensagem "Dados insuficientes para análise estatística confiável."

---

## FASE 2 — Qualidade analítica (sentimento, temas, interações)

### 2.1 Sentimento ponderado por engajamento
- Novo campo no RPC: `weighted_sentiment = sentiment_score * ln(engagement + 1)`.
- Recalcular `pos/neg/neu` agregados ponderados (mantém contagens brutas para tooltip).
- Posts virais pesam mais → sai do 72% neutro artificial.

### 2.2 Temas dominantes com categorias fixas
- Trocar clustering livre por classificação em 10 categorias políticas fixas:
  `eleições, segurança pública, economia, saúde, infraestrutura, corrupção, educação, transporte, STF/Judiciário, governo estadual`.
- Edge function `classify-topics` (nova) usando Lovable AI Gateway (`google/gemini-3-flash-preview`), com cache em `embedding_cache`.
- Prompt restrito: "Classifique em até 2 temas reais. Nunca invente temas vagos."

### 2.3 Interações reais separadas
- KPI dividido: `likes / comments / shares / views` separados.
- Total interações = `likes + comments + shares` (views NÃO entram).
- Card de "Interações" mostra breakdown.

### 2.4 Rede dominante por score composto
- `dominanceScore = posts*0.5 + engagement*0.5` (normalizados).
- Substituir ordenação por mentions cruas em `by_network[0]`.

---

## FASE 3 — UX premium + IA + alertas

### 3.1 Resumo IA executivo
- Nova edge function `network-view-summary` ou expandir `generate-insights`:
  - Prompt: forte, sênior, executivo, máx 120 palavras.
  - Output estruturado: forte_em, sofre_em, narrativas, crise_ou_crescimento.
- Renderizar em 4 bullets curtos no card de IA (substituir parágrafo mecânico).

### 3.2 Alertas IA no topo
- Novo bloco `<NetworkAlerts />` acima dos KPIs.
- Regras:
  - `variation > 30%` em qualquer rede → alerta de crescimento/queda
  - Aumento de sentimento negativo > 15pp → alerta de crise
  - Pico de menções em horário eleitoral (17-22h) → alerta de janela
- Badges coloridos (success / warning / destructive).

### 3.3 Heatmap aprimorado
- 4 níveis de intensidade: baixo → médio → alto → explosivo (gradient HSL).
- Tooltip: `"Segunda 20h → 327 interações"` (dia por extenso + total).

### 3.4 UI polish
- Loading skeletons consistentes em todos os cards.
- Substituir mensagem de erro vermelha por empty states elegantes.
- Padding/espaçamento padronizado, cards com sombra sutil.

---

## Arquivos afetados

**Frontend**
- `src/pages/dashboard/NetworkView.tsx` (refatoração grande)
- `src/components/dashboard/NetworkAlerts.tsx` (novo)
- `src/components/dashboard/NetworkHeatmap.tsx` (extraído)
- `src/components/dashboard/NetworkAISummary.tsx` (novo)

**Backend (edge functions)**
- `supabase/functions/social/index.ts` (rota top-posts)
- `supabase/functions/classify-topics/index.ts` (novo)
- `supabase/functions/network-view-summary/index.ts` (novo)

**Database (migrations)**
- Atualizar RPC `network_view_core_metrics` (sentimento ponderado, dominance score, separar interações)
- Atualizar RPC `network_view_content_metrics` (filtro hashtags backend, tópicos com categorias)

---

## Detalhes técnicos

- **Sem mock data** — todos os dados vêm de `social_interactions` (SSOT).
- **Multi-tier fallback IA** mantido (Cerebras → Groq → Gemini → Lovable Gateway).
- **BR-PT** em toda a UI e prompts.
- **Cache** de 15min em React Query mantido; cache de IA via `embedding_cache`.

---

## Confirmação

Posso começar pela **Fase 1** (correções críticas: top posts + hashtags lixo + crescimento + fallback) agora? Ou prefere ordem diferente?
