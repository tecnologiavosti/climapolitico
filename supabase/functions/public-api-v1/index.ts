// Public API v1 — versioned read-only endpoints for external integrations.
// Auth: Bearer <pk_...> token validated via verify_api_key RPC.
// Rate limit: per-key per-minute, enforced via check_api_rate_limit RPC.
// Every request is recorded as a usage_event for billing/analytics.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "x-api-version": "v1", ...extraHeaders },
  });
}

const SCOPE_BY_RESOURCE: Record<string, string> = {
  candidates: "read:candidates",
  analyses: "read:analyses",
  usage: "read:usage",
  ranking: "read:candidates",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);

  const url = new URL(req.url);
  // Path looks like: /public-api-v1/v1/<resource>[/<id>]
  const parts = url.pathname.split("/").filter(Boolean);
  const vIdx = parts.findIndex((p) => p === "v1");
  if (vIdx === -1 || !parts[vIdx + 1]) {
    return json({ error: "not_found", hint: "GET /v1/{candidates|analyses|usage|ranking}" }, 404);
  }
  const resource = parts[vIdx + 1];
  const subId = parts[vIdx + 2];

  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token.startsWith("pk_")) return json({ error: "missing_api_key" }, 401);

  const requiredScope = SCOPE_BY_RESOURCE[resource];
  if (!requiredScope) return json({ error: "unknown_resource", resource }, 404);

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // Validate
  const { data: keyRows, error: keyErr } = await supabase.rpc("verify_api_key", {
    _token: token,
    _required_scope: requiredScope,
  });
  if (keyErr || !keyRows || (keyRows as any[]).length === 0) {
    return json({ error: "invalid_or_expired_key" }, 401);
  }
  const keyInfo = (keyRows as any[])[0] as { user_id: string; key_id: string; rate_limit_per_minute: number };

  // Rate limit
  const { data: allowed } = await supabase.rpc("check_api_rate_limit", {
    _key_id: keyInfo.key_id,
    _limit: keyInfo.rate_limit_per_minute,
  });
  if (allowed === false) {
    return json({ error: "rate_limit_exceeded", limit_per_minute: keyInfo.rate_limit_per_minute }, 429, {
      "retry-after": "60",
    });
  }

  // Always record the API request (used for billing + rate limiting window)
  await supabase.rpc("record_usage_event", {
    _user_id: keyInfo.user_id,
    _event_type: "api_request",
    _resource: resource,
    _quantity: 1,
    _cost_units: 0.001,
    _metadata: { key_id: keyInfo.key_id, path: url.pathname },
  }).catch(() => {});

  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") ?? "50", 10) || 50));
  const offset = Math.max(0, parseInt(url.searchParams.get("offset") ?? "0", 10) || 0);

  try {
    if (resource === "candidates") {
      let q = supabase
        .from("candidates")
        .select("id, full_name, party, region, status, mentions, sentiment, trend, last_analysis_at")
        .eq("user_id", keyInfo.user_id)
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);
      if (subId) q = q.eq("id", subId);
      const { data, error } = await q;
      if (error) return json({ error: error.message }, 500);
      return json({ data, limit, offset });
    }

    if (resource === "analyses") {
      let q = supabase
        .from("candidate_analyses")
        .select("id, candidate_id, social_network, sentiment_score, sentiment_label, posts_analyzed, created_at, analysis_status")
        .eq("user_id", keyInfo.user_id)
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);
      if (subId) q = q.eq("candidate_id", subId);
      const { data, error } = await q;
      if (error) return json({ error: error.message }, 500);
      return json({ data, limit, offset });
    }

    if (resource === "ranking") {
      const { data, error } = await supabase
        .from("candidate_rankings")
        .select("candidate_id, rank_position, overall_score, positive_perception, negative_perception, period_start, period_end")
        .eq("user_id", keyInfo.user_id)
        .order("period_end", { ascending: false })
        .order("rank_position", { ascending: true })
        .range(offset, offset + limit - 1);
      if (error) return json({ error: error.message }, 500);
      return json({ data, limit, offset });
    }

    if (resource === "usage") {
      const days = Math.min(90, Math.max(1, parseInt(url.searchParams.get("days") ?? "30", 10) || 30));
      const { data, error } = await supabase.rpc("get_user_usage_summary", { _days: days });
      if (error) return json({ error: error.message }, 500);
      return json({ data, days });
    }

    return json({ error: "unknown_resource" }, 404);
  } catch (e) {
    return json({ error: "internal_error", message: (e as Error).message }, 500);
  }
});
