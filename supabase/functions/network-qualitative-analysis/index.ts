// Visão por Rede Social — Social Listening Político.
// Foco: comportamento, viralização, comentários, formatos, audiência e amplificação por plataforma.

import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { callAICerebrasFirst } from "../_shared/cerebras-ai.ts";
import { collectGoogleNews, collectReddit, type FreeHit } from "../_shared/free-collectors.ts";

interface RequestBody {
  candidate_name: string;
  party?: string | null;
  region?: string | null;
  network?: string;
  start_date: string;
  end_date: string;
}

type ClimaStatus = "explodindo" | "aquecido" | "estavel" | "frio" | "hostil" | "favoravel" | "polarizado";
type Tracao = "alta" | "media" | "baixa";
type Viralizacao = "alta" | "media" | "baixa";
type TomComentario = "apoio" | "critica" | "neutro" | "ironia";

interface ListeningReport {
  clima_social: { status: ClimaStatus[]; headline: string; texto: string };
  reacao_da_rede: { texto: string; sinais: string[] };
  formatos_que_engajam: { alta_tracao: string[]; media_tracao: string[]; baixa_tracao: string[] };
  narrativas_dominantes: { positivas: string[]; negativas: string[]; neutras: string[] };
  comentarios_tipicos: Array<{ texto: string; tom: TomComentario }>;
  amplificadores: Array<{ categoria: string; papel: string; intensidade: Tracao }>;
  risco_viralizacao: Array<{ tema: string; nivel: Viralizacao; motivo: string }>;
  score_performance_social: {
    viralizacao: number;
    aprovacao: number;
    rejeicao: number;
    engajamento: number;
    shareability: number;
    meme_potential: number;
  };
  network: string;
  period: { start: string; end: string };
  evidence_used: number;
  generated_at: string;
}

const NETWORK_LABEL: Record<string, string> = {
  all: "todas as redes sociais",
  news: "Notícias",
  youtube: "YouTube",
  twitter: "X / Twitter",
  x: "X / Twitter",
  telegram: "Telegram",
  tiktok: "TikTok",
  instagram: "Instagram",
  facebook: "Facebook",
  reddit: "Reddit",
};

const PLATFORM_BEHAVIOR: Record<string, string> = {
  all: "Compare diferenças entre plataformas sem transformar a resposta em resumo político genérico. Aponte onde o candidato cresce, onde apanha e quais formatos puxam a conversa.",
  twitter: "X / Twitter: ironia, ataques rápidos, threads, jornalistas, militância organizada, disputa narrativa em tempo real e prints/cortes com alto potencial de conflito.",
  x: "X / Twitter: ironia, ataques rápidos, threads, jornalistas, militância organizada, disputa narrativa em tempo real e prints/cortes com alto potencial de conflito.",
  instagram: "Instagram: imagem pública, Reels, comentários curtos, apoio de baixa fricção, compartilhamento em stories, estética de bastidor e reação superficial a falas fortes.",
  tiktok: "TikTok: memes, edits, cortes curtos, áudio reaproveitado, react, legenda provocativa, retenção nos primeiros segundos e viralização veloz fora da bolha política.",
  youtube: "YouTube: comentários longos, cortes de podcasts, entrevistas, debates, reacts, canais de opinião e audiências que argumentam mais do que apenas curtem.",
  facebook: "Facebook: comunidades locais, grupos de apoio/rejeição, links de notícias, comentários extensos, público mais velho e compartilhamentos em páginas regionais.",
  telegram: "Telegram: canais militantes, encaminhamento coordenado, linguagem de mobilização, bolhas ideológicas e baixa visibilidade pública com alta capacidade de ativação.",
  reddit: "Reddit: discussão em comunidades, ceticismo, perguntas, humor interno, análise de contexto e rejeição a propaganda explícita.",
  news: "Notícias: manchetes, enquadramento editorial, repercussão em portais, colunistas, clipping político e comentários derivados das matérias.",
};

function buildContext(hits: FreeHit[], limit = 30): string {
  if (!hits.length) return "Sem evidências web recentes. Use conhecimento público, mas deixe claro o comportamento de rede e evite resumo político genérico.";
  return hits.slice(0, limit).map((h, i) => {
    const parts = [
      h.title ? `T: ${h.title}` : "",
      h.source ? `F: ${h.source}` : "",
      h.date ? `D: ${h.date}` : "",
      h.description ? `R: ${h.description.slice(0, 260)}` : "",
    ].filter(Boolean);
    return `[${i + 1}] ${parts.join(" | ")}`;
  }).join("\n");
}

function normalizeStatus(values: unknown): ClimaStatus[] {
  const allowed: ClimaStatus[] = ["explodindo", "aquecido", "estavel", "frio", "hostil", "favoravel", "polarizado"];
  const raw = Array.isArray(values) ? values : [values];
  const normalized = raw
    .map((v) => String(v ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "_"))
    .map((s) => allowed.find((a) => s.includes(a)) ?? null)
    .filter((s): s is ClimaStatus => Boolean(s));
  return [...new Set(normalized)].slice(0, 3).length ? [...new Set(normalized)].slice(0, 3) : ["estavel"];
}

function normTraction(v: unknown): Tracao {
  const s = String(v ?? "").toLowerCase();
  if (s.startsWith("a")) return "alta";
  if (s.startsWith("b")) return "baixa";
  return "media";
}

function normViralizacao(v: unknown): Viralizacao {
  return normTraction(v);
}

function normTom(v: unknown): TomComentario {
  const s = String(v ?? "").toLowerCase();
  if (s.includes("cr") || s.includes("neg") || s.includes("rej")) return "critica";
  if (s.includes("iron") || s.includes("sarcas")) return "ironia";
  if (s.includes("apo") || s.includes("pos")) return "apoio";
  return "neutro";
}

function strList(value: unknown, limit: number): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean).slice(0, limit) : [];
}

function clamp(n: unknown): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return 50;
  return Math.max(0, Math.min(100, Math.round(x)));
}

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  try {
    const body = (await req.json()) as RequestBody;
    if (!body.candidate_name || !body.start_date || !body.end_date) {
      return jsonResponse({ error: "MISSING_PARAMS" }, 400);
    }

    const network = (body.network ?? "all").toLowerCase();
    const networkLabel = NETWORK_LABEL[network] ?? network;
    const query = [body.candidate_name, body.party].filter(Boolean).join(" ");

    const [news, reddit] = await Promise.allSettled([
      collectGoogleNews(query, body.start_date, body.end_date),
      collectReddit(query, body.start_date, body.end_date),
    ]);
    const hits: FreeHit[] = [];
    if (news.status === "fulfilled") hits.push(...news.value.hits);
    if (reddit.status === "fulfilled") hits.push(...reddit.value.hits);

    const context = buildContext(hits);
    const platformBehavior = PLATFORM_BEHAVIOR[network] ?? `Rede analisada: ${networkLabel}. Diferencie esta plataforma por comportamento, audiência, formatos e linguagem.`;

    const systemMsg = `Você é um diretor sênior de social listening político brasileiro, no padrão Brandwatch + Meltwater + Sprinklr.
Sua única missão é responder: "Como este candidato existe dentro das redes sociais?"

REGRAS CRÍTICAS:
- Esta é uma análise de SOCIAL MEDIA intelligence, não um resumo político.
- Foco total em comportamento, viralização, comentário, percepção, formato e audiência.
- Não repetir Radar Político, Resumo IA, trajetória legislativa ou análise ideológica genérica.
- Cada rede precisa soar radicalmente diferente: YouTube != X != TikTok != Instagram.
- Descreva a rede e sua reação ao candidato; não faça panfleto, biografia ou editorial.
- Comentários típicos devem ser sintéticos, realistas e plausíveis, como se viessem da plataforma, sem inventar fatos criminosos.
- Narrativas devem parecer extraídas de comentários reais: curtas, específicas, com linguagem social.
- Não use hashtags inventadas nem termos genéricos que serviriam para qualquer candidato.
- Escreva em PT-BR premium, direto, analítico e operacional.`;

    const userPrompt = `Candidato: ${body.candidate_name}
Partido: ${body.party ?? "não informado"}
Estado/Região: ${body.region ?? "não informado"}
Rede analisada: ${networkLabel}
Período EXATO da análise: ${body.start_date} a ${body.end_date}

Comportamento esperado da plataforma:
${platformBehavior}

Evidências web recentes para contexto:
${context}

Produza um JSON estrito (sem markdown e sem comentários) com este schema EXATO:
{
  "clima_social": {
    "status": ["explodindo" | "aquecido" | "estavel" | "frio" | "hostil" | "favoravel" | "polarizado"],
    "headline": "ex.: CLIMA SOCIAL: POLARIZADO + AQUECIDO",
    "texto": "2-3 frases descrevendo COMO A REDE está se comportando em torno do candidato; não descreva o candidato isoladamente"
  },
  "reacao_da_rede": {
    "texto": "2-3 frases específicas da plataforma: no YouTube fale de comentários longos/reacts/cortes; no X de ironia/threads/ataques; no TikTok de memes/edits; no Instagram de imagem/reels/stories etc.",
    "sinais": ["4-6 sinais comportamentais curtos da plataforma"]
  },
  "formatos_que_engajam": {
    "alta_tracao": ["3-5 formatos concretos que viralizam para este candidato nesta rede"],
    "media_tracao": ["3-5 formatos de tração média"],
    "baixa_tracao": ["3-5 formatos de baixa tração"]
  },
  "narrativas_dominantes": {
    "positivas": ["3-6 frases/expressões curtas que pareçam comentários reais favoráveis"],
    "negativas": ["3-6 frases/expressões curtas que pareçam comentários reais críticos"],
    "neutras": ["3-6 frases/expressões curtas neutras/descritivas"]
  },
  "comentarios_tipicos": [
    { "texto": "comentário sintético realista, curto ou médio, no estilo da rede", "tom": "apoio" | "critica" | "neutro" | "ironia" }
  ],
  "amplificadores": [
    { "categoria": "apoiadores | críticos | imprensa | influenciadores | perfis meme | perfis de cortes | grupos locais", "papel": "como esse grupo faz a conversa crescer", "intensidade": "alta" | "media" | "baixa" }
  ],
  "risco_viralizacao": [
    { "tema": "gatilho específico que pode explodir", "nivel": "alta" | "media" | "baixa", "motivo": "por que pode ganhar tração nas próximas horas/dias" }
  ],
  "score_performance_social": {
    "viralizacao": 0-100,
    "aprovacao": 0-100,
    "rejeicao": 0-100,
    "engajamento": 0-100,
    "shareability": 0-100,
    "meme_potential": 0-100
  }
}

Quantidades mínimas:
- comentarios_tipicos: 5 a 8 itens.
- amplificadores: 5 a 7 itens.
- risco_viralizacao: 4 a 6 itens.

Validação editorial antes de responder:
1. Se trocar o nome do candidato por outro, a análise ainda funciona? Se sim, está genérica demais; reescreva.
2. A resposta parece social listening, não ciência política? Se não, reescreva.
3. A plataforma analisada aparece de forma concreta em todos os blocos? Se não, reescreva.`;

    const ai = await callAICerebrasFirst({
      systemMsg,
      userPrompt,
      jsonMode: true,
      maxTokens: 3600,
      temperature: 0.65,
      tag: "network-social-listening-v4",
    });

    let parsed: any;
    try {
      parsed = JSON.parse(ai.content);
    } catch {
      const m = ai.content.match(/\{[\s\S]*\}/);
      if (!m) return jsonResponse({ error: "AI_PARSE_FAILED", raw: ai.content.slice(0, 500) }, 502);
      parsed = JSON.parse(m[0]);
    }

    const report: ListeningReport = {
      clima_social: {
        status: normalizeStatus(parsed?.clima_social?.status),
        headline: String(parsed?.clima_social?.headline ?? "CLIMA SOCIAL: ESTÁVEL"),
        texto: String(parsed?.clima_social?.texto ?? ""),
      },
      reacao_da_rede: {
        texto: String(parsed?.reacao_da_rede?.texto ?? ""),
        sinais: strList(parsed?.reacao_da_rede?.sinais, 8),
      },
      formatos_que_engajam: {
        alta_tracao: strList(parsed?.formatos_que_engajam?.alta_tracao, 6),
        media_tracao: strList(parsed?.formatos_que_engajam?.media_tracao, 6),
        baixa_tracao: strList(parsed?.formatos_que_engajam?.baixa_tracao, 6),
      },
      narrativas_dominantes: {
        positivas: strList(parsed?.narrativas_dominantes?.positivas, 8),
        negativas: strList(parsed?.narrativas_dominantes?.negativas, 8),
        neutras: strList(parsed?.narrativas_dominantes?.neutras, 8),
      },
      comentarios_tipicos: Array.isArray(parsed?.comentarios_tipicos)
        ? parsed.comentarios_tipicos.slice(0, 8).map((c: any) => ({ texto: String(c?.texto ?? c ?? ""), tom: normTom(c?.tom) })).filter((c: any) => c.texto)
        : [],
      amplificadores: Array.isArray(parsed?.amplificadores)
        ? parsed.amplificadores.slice(0, 8).map((a: any) => ({
          categoria: String(a?.categoria ?? "Grupo de amplificação"),
          papel: String(a?.papel ?? "Amplifica a conversa por compartilhamento e comentário."),
          intensidade: normTraction(a?.intensidade),
        }))
        : [],
      risco_viralizacao: Array.isArray(parsed?.risco_viralizacao)
        ? parsed.risco_viralizacao.filter((r: any) => r && r.tema).slice(0, 8).map((r: any) => ({
          tema: String(r.tema),
          nivel: normViralizacao(r.nivel),
          motivo: String(r.motivo ?? ""),
        }))
        : [],
      score_performance_social: {
        viralizacao: clamp(parsed?.score_performance_social?.viralizacao),
        aprovacao: clamp(parsed?.score_performance_social?.aprovacao),
        rejeicao: clamp(parsed?.score_performance_social?.rejeicao),
        engajamento: clamp(parsed?.score_performance_social?.engajamento),
        shareability: clamp(parsed?.score_performance_social?.shareability),
        meme_potential: clamp(parsed?.score_performance_social?.meme_potential),
      },
      network,
      period: { start: body.start_date, end: body.end_date },
      evidence_used: hits.length,
      generated_at: new Date().toISOString(),
    };

    return jsonResponse({ report, provider: ai.provider, model: ai.model });
  } catch (err) {
    console.error("[network-qualitative-analysis]", err);
    return jsonResponse({ error: "INTERNAL_ERROR", message: (err as Error).message }, 500);
  }
});