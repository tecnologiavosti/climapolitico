// Descobre automaticamente URLs de Instagram e Facebook dos candidatos
// usando busca no DuckDuckGo HTML (sem API key) e popula candidate_social_links.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const BLOCKED_IG = new Set([
  "explore", "accounts", "p", "reel", "reels", "stories", "directory", "about",
  "developer", "legal", "press", "api", "session", "challenge",
]);
const BLOCKED_FB = new Set([
  "sharer", "dialog", "plugins", "tr", "watch", "events", "groups", "marketplace",
  "gaming", "help", "policies", "login", "signup", "business", "ads", "search",
  "people", "pages", "permalink.php", "story.php", "photo.php", "video.php",
  "media", "public", "directory", "settings",
]);

function decodeDdg(href: string): string {
  // DDG html links são do tipo //duckduckgo.com/l/?uddg=ENCODED
  try {
    const u = new URL(href.startsWith("//") ? "https:" + href : href);
    const real = u.searchParams.get("uddg");
    return real ? decodeURIComponent(real) : href;
  } catch {
    return href;
  }
}

function extractFirstHandle(
  html: string,
  domain: "instagram.com" | "facebook.com",
  blocked: Set<string>,
): { url: string; handle: string } | null {
  const re = new RegExp(`https?:\\\/\\\/(?:www\\.)?${domain.replace(".", "\\.")}\\/([A-Za-z0-9_.\\-]+)`, "gi");
  for (const m of html.matchAll(re)) {
    const handle = m[1];
    if (!handle || blocked.has(handle.toLowerCase())) continue;
    if (handle.length < 2 || handle.length > 40) continue;
    return { url: `https://www.${domain}/${handle}/`, handle };
  }
  return null;
}

async function ddgSearch(query: string): Promise<string> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8" },
  });
  if (!res.ok) return "";
  const raw = await res.text();
  return raw.replace(/\/\/duckduckgo\.com\/l\/\?uddg=[^"'\s]+/g, (m) => decodeDdg(m));
}

async function firecrawlSearch(query: string): Promise<string> {
  const key = Deno.env.get("FIRECRAWL_API_KEY");
  if (!key) return "";
  try {
    const res = await fetch("https://api.firecrawl.dev/v1/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ query, limit: 10 }),
    });
    if (!res.ok) return "";
    const j = await res.json();
    const items = j?.data ?? [];
    return items.map((it: any) => `${it.url ?? ""} ${it.title ?? ""} ${it.description ?? ""}`).join("\n");
  } catch (e) {
    console.error("firecrawl:", (e as Error).message);
    return "";
  }
}

async function discoverFor(
  candidateName: string,
  domain: "instagram.com" | "facebook.com",
  blocked: Set<string>,
): Promise<{ url: string; handle: string } | null> {
  const platformName = domain === "instagram.com" ? "instagram" : "facebook";
  const queries = [
    `"${candidateName}" site:${domain}`,
    `${candidateName} ${platformName} oficial`,
  ];
  for (const q of queries) {
    try {
      // Primeiro tenta Firecrawl (mais estável); fallback para DDG
      let html = await firecrawlSearch(q);
      if (!html) html = await ddgSearch(q);
      const found = extractFirstHandle(html, domain, blocked);
      if (found) return found;
    } catch (e) {
      console.error(`search ${q}: ${(e as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUser = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: userData, error: authErr } = await supabaseUser.auth.getUser(
    authHeader.replace("Bearer ", ""),
  );
  if (authErr || !userData?.user?.id) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const userId = userData.user.id;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    let body: { candidate_id?: string } = {};
    try { body = await req.json(); } catch { /* sem body */ }

    let q = supabase.from("candidates").select("id, full_name, user_id").eq("user_id", userId);
    if (body.candidate_id) q = q.eq("id", body.candidate_id);
    const { data: candidates, error: cErr } = await q;
    if (cErr) throw cErr;
    if (!candidates || candidates.length === 0) {
      return new Response(JSON.stringify({ message: "Sem candidatos.", added: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verifica quais plataformas cada candidato já possui
    const ids = candidates.map((c) => c.id);
    const { data: existing } = await supabase
      .from("candidate_social_links")
      .select("candidate_id, platform")
      .in("candidate_id", ids);

    const haveSet = new Set((existing ?? []).map((l) => `${l.candidate_id}:${l.platform}`));

    const toInsert: Array<{ candidate_id: string; user_id: string; platform: string; url: string; handle: string }> = [];
    const results: Array<{ candidate: string; instagram?: string; facebook?: string; skipped?: string[] }> = [];

    for (const c of candidates) {
      const r: { candidate: string; instagram?: string; facebook?: string; skipped?: string[] } = {
        candidate: c.full_name,
        skipped: [],
      };

      if (haveSet.has(`${c.id}:instagram`)) {
        r.skipped!.push("instagram (já existe)");
      } else {
        const ig = await discoverFor(c.full_name, "instagram.com", BLOCKED_IG);
        if (ig) {
          toInsert.push({
            candidate_id: c.id, user_id: c.user_id, platform: "instagram",
            url: ig.url, handle: ig.handle,
          });
          r.instagram = ig.url;
        }
      }

      if (haveSet.has(`${c.id}:facebook`)) {
        r.skipped!.push("facebook (já existe)");
      } else {
        const fb = await discoverFor(c.full_name, "facebook.com", BLOCKED_FB);
        if (fb) {
          toInsert.push({
            candidate_id: c.id, user_id: c.user_id, platform: "facebook",
            url: fb.url, handle: fb.handle,
          });
          r.facebook = fb.url;
        }
      }

      if (!r.skipped!.length) delete r.skipped;
      results.push(r);
    }

    let added = 0;
    if (toInsert.length > 0) {
      const { error: insErr, count } = await supabase
        .from("candidate_social_links")
        .upsert(toInsert, { onConflict: "candidate_id,platform,url", ignoreDuplicates: true, count: "exact" });
      if (insErr) console.error("insert:", insErr.message);
      added = count ?? toInsert.length;
    }

    return new Response(JSON.stringify({
      message: "Descoberta concluída",
      candidates_processed: candidates.length,
      added,
      results,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("discover-social-links fatal:", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
