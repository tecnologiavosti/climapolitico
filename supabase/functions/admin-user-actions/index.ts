// admin-user-actions: ban/unban/hard-delete users. service_role required.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: hasAccess, error: roleErr } = await admin.rpc("has_admin_access", { _user_id: user.id });
    if (roleErr || !hasAccess) {
      return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json();
    const { action, target_user_id, reason } = body ?? {};

    if (!action || !target_user_id) {
      return new Response(JSON.stringify({ error: "missing fields" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const audit = async (metadata: Record<string, any>) => {
      await admin.from("admin_audit_logs").insert({
        admin_id: user.id,
        admin_email: user.email ?? null,
        action,
        target_type: "user",
        target_id: target_user_id,
        metadata,
        ip_address: req.headers.get("x-forwarded-for") ?? null,
        user_agent: req.headers.get("user-agent") ?? null,
      });
    };

    if (action === "ban") {
      await admin.from("profiles").update({
        is_banned: true,
        ban_reason: reason ?? null,
        banned_at: new Date().toISOString(),
        banned_by: user.id,
      }).eq("id", target_user_id);
      // revoke all sessions
      await admin.auth.admin.signOut(target_user_id).catch(() => {});
      await audit({ reason });
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "unban") {
      await admin.from("profiles").update({
        is_banned: false,
        ban_reason: null,
        banned_at: null,
        banned_by: null,
      }).eq("id", target_user_id);
      await audit({});
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "hard_delete") {
      // Cascade cleanup
      const tables = [
        "candidates", "candidate_analyses", "candidate_rankings",
        "social_interactions", "candidate_metrics_cache",
        "subscriptions", "user_roles", "speech_analyses",
        "undecided_analyses", "rejection_analyses",
        "notifications", "narrative_alerts", "scheduled_reports",
        "report_templates", "api_keys", "export_jobs", "webhook_endpoints",
        "ai_insights", "candidate_social_links",
      ];
      for (const t of tables) {
        await admin.from(t).delete().eq("user_id", target_user_id).then(() => {}, () => {});
      }
      await admin.from("profiles").delete().eq("id", target_user_id);
      await admin.auth.admin.deleteUser(target_user_id);
      await audit({ cascade: tables });
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "change_plan") {
      const { tier } = body;
      if (!tier) return new Response(JSON.stringify({ error: "missing tier" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      const max_candidates = tier === "lifetime" ? 9999 : tier === "enterprise" ? 25 : tier === "pro" ? 5 : 1;
      const max_updates = tier === "lifetime" ? 9999 : tier === "enterprise" ? 1000 : tier === "pro" ? 100 : 10;

      const { data: existing } = await admin.from("subscriptions").select("id").eq("user_id", target_user_id).maybeSingle();
      const payload = {
        user_id: target_user_id,
        tier,
        status: "active",
        max_candidates,
        max_updates_per_month: max_updates,
        current_period_start: new Date().toISOString(),
        current_period_end: new Date(Date.now() + 365 * 86400000 * (tier === "lifetime" ? 100 : 1)).toISOString(),
        cancelled_at: null,
      };
      if (existing) await admin.from("subscriptions").update(payload).eq("id", existing.id);
      else await admin.from("subscriptions").insert(payload);
      await audit({ tier });
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "unknown action" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
