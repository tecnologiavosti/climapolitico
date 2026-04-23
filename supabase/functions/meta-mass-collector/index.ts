// Coletor "best-effort" de Instagram (Picuki/Dumpor/Imginn) e Facebook (RSS-Bridge).
// Reusa colunas existentes:
//   - candidates.social_media_link → de onde extraímos o handle do IG e/ou da página FB.
//   - social_interactions.interaction_type → 'post' ou 'comment'.
//
// AVISO: as fontes públicas usadas aqui são instáveis e bloqueiam IPs de datacenter
// com frequência. O coletor é tolerante a falhas: se uma fonte responder, registra; se
// nenhuma responder, retorna 0 sem quebrar.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const INSTAGRAM_SOURCES = [
  "https://www.picuki.com/profile/",
  "https://dumpor.io/v/",
  "https://imginn.com/",
];

const FB_RSS_BRIDGES = [
  "https://rss-bridge.org/bridge01/",
  "https://rss-bridge.lewd.tech/",
  "https://rssbridge.flossboxin.org.in/",
  "https://wtf.roflcopter.fr/rss-bridge/",
];

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
];
const ua = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

const FETCH_TIMEOUT_MS = 12000;
async function fetchWithTimeout(url: string): Promise<Response | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      headers: { "User-Agent": ua(), "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8" },
      signal: ctrl.signal,
    });
  } catch (e) {
    console.warn(`[meta] fetch falhou ${url}: ${(e as Error).message}`);
    return null;
  } finally {
    clearTimeout(t);
  }
}

function extractInstagramHandle(link: string | null): string | null {
  if (!link) return null;
  const m = link.match(/instagram\.com\/(?:p\/)?@?([A-Za-z0-9_.]+)/i);
  return m?.[1] && m[1] !== "p" ? m[1] : null;
}

function extractFacebookHandle(link: string | null): string | null {
  if (!link) return null;
  const m = link.match(/facebook\.com\/([A-Za-z0-9.\-_]+)/i);
  return m?.[1] || null;
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripHtml(s: string): string {
  return decodeHtml(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

// --- Instagram via Picuki/Dumpor/Imginn (extrai legendas como "posts") ---
async function collectInstagram(handle: string): Promise<Array<{ text: string; url: string }>> {
  const out: Array<{ text: string; url: string }> = [];
  for (const base of INSTAGRAM_SOURCES) {
    const url = `${base}${handle}`;
    const res = await fetchWithTimeout(url);
    if (!res || !res.ok) continue;
    const html = await res.text();
    // Captura legendas de posts (heurística genérica que funciona em vários mirrors)
    const captionRegex = /<(?:p|div)[^>]*class="[^"]*(?:caption|post-caption|photo-description)[^"]*"[^>]*>([\s\S]*?)<\/(?:p|div)>/gi;
    let m: RegExpExecArray | null;
    while ((m = captionRegex.exec(html)) !== null) {
      const text = stripHtml(m[1]).slice(0, 1000);
      if (text.length > 5) out.push({ text, url });
      if (out.length >= 30) break;
    }
    if (out.length > 0) break; // Sucesso nesta fonte
  }
  return out;
}

// --- Facebook via RSS-Bridge (Facebook Bridge) ---
async function collectFacebook(pageHandle: string): Promise<Array<{ text: string; url: string; date?: string }>> {
  const out: Array<{ text: string; url: string; date?: string }> = [];
  for (const bridge of FB_RSS_BRIDGES) {
    const url = `${bridge}?action=display&bridge=Facebook&u=${encodeURIComponent(pageHandle)}&format=Json`;
    const res = await fetchWithTimeout(url);
    if (!res || !res.ok) continue;
    try {
      const data = await res.json();
      const items = (data?.items || []) as Array<{ content_text?: string; content_html?: string; title?: string; url?: string; date_published?: string }>;
      for (const it of items) {
        const text = (it.content_text || stripHtml(it.content_html || "") || it.title || "").slice(0, 2000);
        if (text && it.url) out.push({ text, url: it.url, date: it.date_published });
      }
      if (out.length > 0) break;
    } catch {
      // tenta próxima instância
    }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const startedAt = Date.now();

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    // Permite chamada manual com candidateId específico
    let candidateId: string | undefined;
    try {
      if (req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        candidateId = body?.candidateId;
      }
    } catch { /* noop */ }

    let q = supabase
      .from("candidates")
      .select("id, full_name, user_id, social_media_link")
      .eq("status", "active");
    if (candidateId) q = q.eq("id", candidateId);

    const { data: candidates, error } = await q.limit(500);
    if (error) throw error;
    const list = candidates || [];
    if (list.length === 0) {
      return new Response(JSON.stringify({ message: "Sem candidatos ativos." }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const summary: Record<string, { ig: number; fb: number; igFail: number; fbFail: number }> = {};

    const job = (async () => {
      for (const c of list) {
        const igHandle = extractInstagramHandle(c.social_media_link);
        const fbHandle = extractFacebookHandle(c.social_media_link);
        const stat = (summary[c.full_name] = { ig: 0, fb: 0, igFail: 0, fbFail: 0 });

        const rows: Array<Record<string, unknown>> = [];

        if (igHandle) {
          try {
            const igPosts = await collectInstagram(igHandle);
            stat.ig = igPosts.length;
            for (const p of igPosts) {
              rows.push({
                candidate_id: c.id,
                user_id: c.user_id,
                social_network: "instagram",
                interaction_type: "post",
                comment_text: p.text,
                comment_author: igHandle,
                author_profile_url: `https://www.instagram.com/${igHandle}`,
                original_posted_at: new Date().toISOString(),
              });
            }
            if (igPosts.length === 0) stat.igFail = 1;
          } catch (e) {
            stat.igFail = 1;
            console.warn(`[meta] IG ${c.full_name}:`, (e as Error).message);
          }
        }

        if (fbHandle) {
          try {
            const fbPosts = await collectFacebook(fbHandle);
            stat.fb = fbPosts.length;
            for (const p of fbPosts) {
              rows.push({
                candidate_id: c.id,
                user_id: c.user_id,
                social_network: "facebook",
                interaction_type: "post",
                comment_text: p.text,
                comment_author: fbHandle,
                author_profile_url: p.url,
                original_posted_at: p.date || new Date().toISOString(),
              });
            }
            if (fbPosts.length === 0) stat.fbFail = 1;
          } catch (e) {
            stat.fbFail = 1;
            console.warn(`[meta] FB ${c.full_name}:`, (e as Error).message);
          }
        }

        if (rows.length > 0) {
          const { error: insErr } = await supabase.from("social_interactions").insert(rows);
          if (insErr) console.warn(`[meta] insert ${c.full_name}: ${insErr.message}`);
        }

        await new Promise((r) => setTimeout(r, 600));
      }
      console.log(`[meta] concluído em ${(Date.now() - startedAt) / 1000}s | ${JSON.stringify(summary)}`);
    })();

    // @ts-ignore EdgeRuntime
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(job);
    }

    return new Response(JSON.stringify({
      success: true,
      accepted: true,
      candidates: list.length,
      message: "Coleta Meta iniciada em background",
    }), { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro desconhecido";
    console.error("[meta] erro fatal:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
