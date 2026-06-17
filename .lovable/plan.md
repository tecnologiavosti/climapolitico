## Objetivo

Refatorar a aba **Visão por Rede Social** para funcionar igual ao **Radar Político**: o período controla a coleta real, e a IA apenas analisa o material coletado. Acabar com simulações genéricas.

---

## Mudanças no frontend (`src/pages/dashboard/NetworkView.tsx`)

1. **Remover a camada de IA generativa (`aiIntel`)** que inventa distribuição, séries, tópicos e termos.
2. **Tornar `customInteractions` a única fonte primária**, sempre ativa (já está), recalculada a cada mudança de `period | startDate | endDate | candidate | network`.
3. **Remover `useAI` / `REAL_THRESHOLD`** — não há mais fallback para dados sintéticos.
4. **Estado vazio honesto**: se o intervalo não tiver dados, renderizar mensagem "Sem dados no período selecionado" em cada bloco (gráficos, tabelas, termos, assuntos). Sem inventar.
5. **Bucketing dinâmico de timeline** no `useMemo` do `series`:
   - ≤30d → diário
   - 31–90d → semanal (ISO week)
   - 91–365d → mensal
   - 366–1460d → trimestral
   - >1460d → semestral
6. **Topics/Terms** vêm de duas vias, nessa ordem:
   - a) extração JS local (`computeTopicsAndTerms`) sobre as linhas reais do período;
   - b) chamada à nova edge function `network-view-analyze` (abaixo) que recebe **somente os textos coletados** e devolve tópicos + termos refinados por IA. Se a IA falhar, exibe a versão local.
7. Loading: usar `customInteractions.isFetching || analyzeQuery.isFetching` para skeletons.
8. KPIs (`total`, `engagement`, `likes`, `replies`, `shares`, sentimentos, rede dominante) sempre derivados de `customData`.

---

## Mudanças no backend

### `supabase/functions/network-view-intelligence/index.ts`
Reescrever de "gerador de cenário" para **analisador de conteúdo coletado**, renomeando lógica internamente (manter o nome para não quebrar invokes):
- Input: `{ candidate_id, network, start_date, end_date, samples: string[] }` (textos curtos: `post_title + comment_text`, deduplicados, máx ~120 amostras).
- Coleta no servidor (caso o cliente não envie `samples`): query em `social_interactions` no intervalo, paginada como o cliente faz, limitada a ~5k linhas para extração.
- IA (Lovable AI Gateway, modelo padrão) recebe **apenas** os textos e devolve:
  - `topics`: temas detectados (label + relevância + sentimento agregado).
  - `terms`: entidades/hashtags extraídas, com contagem.
- Sem `PERSONA_SHARES`, sem `generateTimelineByPeriod`, sem `yearHint` de cenário.
- Cache key passa a ser `${candidate_id}|${network}|${start_date}|${end_date}|${hash(samples)}`.
- Retorno: `{ topics, terms, period }` — não retorna mais `by_network` nem `series` (esses vêm dos dados reais no frontend).

---

## Detalhes técnicos

- `pickBucket(days)` no frontend agrupa `series` por chave (`YYYY-MM-DD`, `YYYY-Www`, `YYYY-MM`, `YYYY-Qn`, `YYYY-Sn`) e formata `date` adequadamente para o eixo X.
- Sanitizar textos antes de enviar à IA (`clean-content.ts` já existe em `_shared`).
- Manter `network_view_*` RPCs como estão; eles continuam alimentando `query.data` para casos sem custom range, mas o caminho principal vira `customInteractions` (já é hoje na prática).
- Nenhuma migration; nenhuma mudança em outras abas.

---

## Critérios de aceite

- Trocar 7d ↔ 8a recalcula menções, distribuição, séries, tópicos e termos com valores claramente distintos.
- Período personalizado refaz toda a aba.
- Nada de "Estimativa por IA" sobre distribuição/rede dominante — esses números só existem se houver dado real.
- Timeline muda de granularidade conforme o intervalo.
- Sem dados ⇒ blocos mostram "Sem dados no período selecionado".
