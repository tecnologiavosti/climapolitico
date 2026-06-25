
# Crawler Estruturado — Catálogo Político 2026

## Realidade técnica (leia antes de aprovar)

Não existe nenhuma fonte única que entregue "500 vereadores de Lavras 2026" hoje:

- **TSE 2026**: registro de candidaturas só abre em **agosto/2026**. Antes disso, a API oficial não tem 2026.
- **TSE 2024 (municipal) e 2022 (federal/estadual)**: já implementado, é a base sólida e paginada.
- **TREs, Câmaras Municipais, Assembleias**: ~5.570 municípios + 27 estados, cada um com site/HTML próprio. Não há API padronizada. Escrever 5.570 scrapers é inviável e quebra a cada redesign.
- **Scraping Google/Bing**: bloqueia bots, viola ToS, resultado instável.
- **DuckDuckGo + Firecrawl**: viável como fallback, mas devolve links, não uma lista estruturada de 500 candidatos.

Portanto, a regra "se existem 500, retornar 500" só é cumprível **dentro da base TSE oficial** (2024 municipal + 2022 federal). Para 2026, o catálogo será necessariamente parcial até o TSE publicar — qualquer outra abordagem inventa dados.

## O que vou construir

Crawler em cascata com 3 camadas reais, sem LLM gerando candidatos:

### Camada 1 — TSE oficial (já existe, vou reforçar)
- `divulgacandcontas.tse.jus.br` 2024 + 2022.
- Paginação completa por município (sem truncar): remover o limite atual de 120 municípios, substituir por **streaming com cache em memória + timeout suave**. Se passar de 60s, retorna o que coletou e marca `partial: true`.
- Concorrência: 8 requests paralelos com retry exponencial (3 tentativas).

### Camada 2 — Firecrawl search (fallback estruturado)
- Quando TSE não tem o cargo (Ministro, Presidente de partido, pré-candidato 2026) **ou** quando usuário busca por nome livre.
- Usa connector Firecrawl: `search(query, { limit: 50, scrapeOptions: { formats: ['markdown'] } })`.
- Query builder determinístico:
  - cargo + cidade + UF + "2026" / "candidatos" / "eleitos"
  - nome puro quando informado
- Parse: extrai nome/partido/cargo de listas estruturadas (Wikipedia, G1, UOL, sites oficiais). **Não pede pro LLM inventar** — só usa LLM (Cerebras) para normalizar nomes parseados.

### Camada 3 — Cerebras (apenas normalização)
- Correção ortográfica de nome digitado ("gustav martinel" → "Gustavo Martinelli").
- Deduplicação semântica ("Carlos Eduardo Leite" == "Eduardo Leite").
- **Nunca** gera lista de candidatos.

## Pipeline

```text
filtros → queryBuilder → [TSE cascade] → [Firecrawl fallback]
       → normalize(UF dict) → dedupe(nameKey) → paginate(50)
       → { rows, total, partial, sources[] }
```

## Schema de resposta

```ts
{
  rows: Candidate[],   // página atual
  total: number,        // total real coletado
  page, pageSize: 50,
  hasMore: boolean,
  partial: boolean,     // true se crawler abortou por timeout
  sources: ['tse-2024', 'firecrawl'],
  last_updated: ISO,
}
```

`Candidate`: id, nome, nomeCompleto, cargo, partido, numeroPartido, cidade, estado(UF), status, fonte, confidence.

## Normalização (backend, não IA)

- `UF_DICT` fixo (já existe) — IA nunca define UF.
- Status whitelist: Eleito, Candidato, Ex-candidato, Mandatário, Possível presidenciável.
- Dedupe por `firstToken|lastToken|cargo|UF`.

## Frontend

- Loading com mensagens rotativas: "Consultando bases eleitorais…", "Coletando resultados…", contador parcial via SSE **opcional** (v2, não nessa entrega).
- Banner amarelo se `partial: true`: "Resultado parcial — refine os filtros para coleta completa".
- Paginação 50/página (já existe).
- Logs `console.log` em FILTROS/QUERY/SOURCE/RAW/NORMALIZED/FINAL COUNT (já existem no edge — vou estender pro frontend).

## Detalhes técnicos

- Arquivo único: `supabase/functions/tse-search/index.ts` continua sendo o orquestrador (renomear conceitualmente para "catalog-search", mas mantenho o nome do endpoint para não quebrar frontend).
- Adiciona `firecrawlSearch()` quando: cargo ∈ {ministro, presidente_partido, pre_candidato} OU `q` preenchido sem cargo OU TSE devolve 0.
- Cerebras: chamada única no final só pra dedupe semântica + correção de `q`.
- Requer connector **Firecrawl** linkado (vou pedir confirmação antes de chamar `standard_connectors--connect`).

## O que NÃO vou fazer (e por quê)

- ❌ Scrapers individuais por TRE/Câmara/Assembleia → 5.000+ alvos sem padrão, manutenção impossível.
- ❌ Scraping direto Google/Bing → bloqueio + ToS.
- ❌ LLM gerando lista de candidatos → alucinação garantida (foi o problema anterior).
- ❌ Garantir "500 de 500" para 2026 antes do TSE publicar → impossível, qualquer um que prometa isso está inventando.

## Confirmações que preciso

1. **Aprova essa arquitetura realista** (TSE + Firecrawl + Cerebras-só-normaliza), ciente de que 2026 será parcial até agosto?
2. **Posso linkar o connector Firecrawl** agora? (necessário para camada 2)
3. **Cargos não-TSE** (Ministro, Presidente de partido): aceita que venham só de Firecrawl + Wikipedia, com `confidence < 100` e badge "fonte: web"?
