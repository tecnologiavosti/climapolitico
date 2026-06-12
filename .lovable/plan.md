# Refator: Clima Político → Picos de Menções

Transformar a aba em uma enciclopédia política baseada em **evidência externa verificável**, eliminando alucinações e buzz irrelevante.

## Pipeline novo (rígido)

```text
1. detectar spike    -> baseline + zscore + volume mínimo
2. buscar evidência  -> apenas veículos tier1/tier2 + órgãos oficiais
3. validar fontes    -> peso por tier, mínimo 2 independentes p/ confirmar
4. classificar       -> 11 categorias por regex robusto
5. calcular relevância -> volume 40 + duração 30 + diversidade 20 + impacto 10
6. IA factual        -> só explica com evidência; nunca inventa
7. publicar          -> só passa se status != indeterminate OU se for spike forte
```

Nenhum passo pode ser pulado. IA NUNCA gera fato sem evidência externa.

## Mudanças por arquivo

### `supabase/functions/_shared/peak-pipeline.ts` (novo, modular)
- `detectSpikes(series)` — moving avg + std + zscore (≥2.5) + `mentions > baseline*2` + volume mínimo absoluto (≥30 menções/dia para não promover ruído).
- `SOURCE_WEIGHTS` — tier1 1.0 (Reuters, BBC, STF, TSE, Senado, Câmara, PF, gov.br, planalto), tier2 0.8 (G1, Folha, Estadão, O Globo, UOL, CNN Brasil, Valor, Poder360, Metrópoles, Agência Brasil), tier3 0.4 (Carta Capital, Nexo, Congresso em Foco, Brasil de Fato, Veja), tier4 0.1 (Instagram, TikTok, Facebook, X, YouTube, Telegram, blogs, bing aggregators).
- `BLOCKED_HOSTS` — instagram, tiktok, pinterest, bing aggregator paths, m.facebook.
- `classifySource(url, outlet)` → tier + peso.
- `confidenceFromSources(pubs)` → soma de pesos; status = `confirmed` (≥1.5), `probable` (≥0.8), `indeterminate` (<0.8). Indeterminate exige `independent_strong_sources < 2`.
- `classifyCategory(text)` → regex por categoria (Eleições, Operações PF, STF, TSE, CPI, Julgamentos, Escândalos, Prisões, Debates, Outros). Match mais específico vence.
- `computeRelevance({volume, durationDays, sourceDiversity, politicalImpact})` → 0–100, faixas baixa/média/alta/crítica.

### `supabase/functions/detect-historical-peaks/index.ts`
- Usar `peak-pipeline.ts` para detecção, validação, classificação e relevância (remover lógica duplicada).
- Filtrar publicações tier4 antes da contagem de confidence (mantém só como contexto, não valida).
- Cada evento devolvido carrega: `status`, `category`, `confidence_score`, `confidence_weight_sum`, `independent_strong_sources`, `relevance`, `relevance_band`, `tier_breakdown`.
- Eventos `indeterminate` SÓ aparecem se o spike for forte (zscore>4 e volume>100); caso contrário, descartados.
- AI enrichment desabilitado para `indeterminate`.

### `supabase/functions/resolve-peak-cause/index.ts`
- System prompt substituído pelo prompt factual da spec (status/title/summary/category/confidence/sentiment/why_peak/entities/terms).
- Hard rule: `independent_strong_sources < 2` → resposta forçada `{status:"indeterminate", title:"Causa indeterminada", confidence: <0.4}` sem chamar IA.
- Saída legacy mantida para compat (event_title/event_summary/category/shouldDisplay).

### `src/pages/dashboard/EventReport.tsx`
- Filtros de categoria atualizados para as 11 obrigatórias.
- Card de evento mostra badge por status:
  - 🟢 Evento confirmado (verde)
  - 🟡 Evento provável (âmbar)
  - 🔴 Causa indeterminada (cinza/vermelho discreto)
- Linha de metadados: categoria · relevância (banda + score) · nº fontes confiáveis · menções · breakdown de tiers.
- Mensagem vazia por categoria: "Nenhum pico encontrado nesta categoria".
- Eventos `indeterminate` exibem aviso "A IA não encontrou evidências suficientes" em vez de explicação.

## O que NÃO muda
- SSOT (`social_interactions`), pipeline de coleta, cron, sentimento, dashboards de outras abas.
- Detector de picos da aba Repercussão.

## Critérios de aceite
- Pico sem ≥2 fontes tier1/tier2 distintas nunca é exibido como "confirmado".
- Nenhuma IA cita encontro/decisão/operação sem URL correspondente nas evidências.
- Filtros de categoria distribuem eventos (não tudo em "Outros").
- Relevância varia (não fica concentrada em 75–95).
- Instagram/TikTok sozinhos nunca disparam status confirmado.

## Estimativa
~250 linhas novas em `_shared/peak-pipeline.ts`, ~120 linhas alteradas em `detect-historical-peaks`, ~60 em `resolve-peak-cause`, ~80 em `EventReport.tsx`.
