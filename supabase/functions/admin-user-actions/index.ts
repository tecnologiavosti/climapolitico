// admin-user-actions: comprehensive admin operations. service_role required.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: any, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function limitsForTier(tier: string) {
  const normalized = String(tier ?? "").toLowerCase().trim();
  switch (normalized) {
    case "vip": return { max_candidates: 999999, max_updates: 999999 };
    case "lifetime": return { max_candidates: 999999, max_updates: 999999 };
    case "vitalicio": return { max_candidates: 999999, max_updates: 999999 };
    case "vitalício": return { max_candidates: 999999, max_updates: 999999 };
    case "enterprise": return { max_candidates: 25, max_updates: 1000 };
    case "pro": return { max_candidates: 5, max_updates: 100 };
    case "starter": return { max_candidates: 2, max_updates: 30 };
    case "free": return { max_candidates: 1, max_updates: 10 };
    default: return { max_candidates: 1, max_updates: 10 };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: "unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: hasAccess } = await admin.rpc("has_admin_access", { _user_id: user.id });
    if (!hasAccess) return json({ error: "forbidden" }, 403);

    const body = await req.json();
    const { action, target_user_id } = body ?? {};
    if (!action) return json({ error: "missing action" }, 400);

    const audit = async (metadata: Record<string, any>, target = target_user_id, type = "user") => {
      await admin.from("admin_audit_logs").insert({
        admin_id: user.id,
        admin_email: user.email ?? null,
        action,
        target_type: type,
        target_id: target,
        metadata,
        ip_address: req.headers.get("x-forwarded-for") ?? null,
        user_agent: req.headers.get("user-agent") ?? null,
      });
    };

    // ----- CREATE USER -----
    if (action === "create_user") {
      const { email, password, full_name, organization, tier = "free", expires_in_days } = body;
      if (!email || !password) return json({ error: "missing email/password" }, 400);
      const { data: created, error: cErr } = await admin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { full_name },
      });
      if (cErr || !created.user) return json({ error: cErr?.message ?? "create failed" }, 400);
      const uid = created.user.id;
      await admin.from("profiles").upsert({ id: uid, full_name, organization }, { onConflict: "id" });
      const lim = limitsForTier(tier);
      const periodEnd = expires_in_days
        ? new Date(Date.now() + Number(expires_in_days) * 86400000).toISOString()
        : new Date(Date.now() + 30 * 86400000).toISOString();
      await admin.from("subscriptions").upsert({
        user_id: uid, tier, status: "active",
        max_candidates: lim.max_candidates, max_updates_per_month: lim.max_updates,
        current_period_start: new Date().toISOString(),
        current_period_end: tier === "lifetime" ? new Date(Date.now() + 100 * 365 * 86400000).toISOString() : periodEnd,
      }, { onConflict: "user_id" });
      await audit({ email, tier }, uid);
      return json({ ok: true, user_id: uid });
    }

    if (!target_user_id) return json({ error: "missing target_user_id" }, 400);

    // ----- BAN / UNBAN -----
    if (action === "ban") {
      await admin.from("profiles").update({
        is_banned: true, ban_reason: body.reason ?? null,
        banned_at: new Date().toISOString(), banned_by: user.id,
      }).eq("id", target_user_id);
      await admin.auth.admin.signOut(target_user_id).catch(() => {});
      await audit({ reason: body.reason });
      return json({ ok: true });
    }
    if (action === "unban") {
      await admin.from("profiles").update({
        is_banned: false, ban_reason: null, banned_at: null, banned_by: null,
      }).eq("id", target_user_id);
      await audit({});
      return json({ ok: true });
    }

    // ----- SUSPEND / UNSUSPEND -----
    if (action === "suspend") {
      const { until, reason } = body;
      if (!until) return json({ error: "missing until" }, 400);
      await admin.from("profiles").update({
        suspended_until: new Date(until).toISOString(), suspended_reason: reason ?? null,
      }).eq("id", target_user_id);
      await admin.auth.admin.signOut(target_user_id).catch(() => {});
      await audit({ until, reason });
      return json({ ok: true });
    }
    if (action === "unsuspend") {
      await admin.from("profiles").update({ suspended_until: null, suspended_reason: null }).eq("id", target_user_id);
      await audit({});
      return json({ ok: true });
    }

    // ----- RESET PASSWORD -----
    if (action === "reset_password") {
      const { new_password } = body;
      if (new_password) {
        const { error } = await admin.auth.admin.updateUserById(target_user_id, { password: new_password });
        if (error) return json({ error: error.message }, 400);
        await audit({ method: "direct" });
        return json({ ok: true, mode: "direct" });
      }
      // Send recovery email via nosso fluxo Resend (sem e-mail nativo do Supabase)
      const { data: u } = await admin.auth.admin.getUserById(target_user_id);
      if (!u.user?.email) return json({ error: "no email" }, 400);
      const resetRes = await fetch(`${SUPABASE_URL}/functions/v1/send-password-reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE}` },
        body: JSON.stringify({ email: u.user.email }),
      });
      if (!resetRes.ok) {
        const txt = await resetRes.text();
        return json({ error: "Falha ao enviar e-mail", detail: txt }, 502);
      }
      await audit({ method: "email" });
      return json({ ok: true, mode: "email" });
    }

    // ----- IMPERSONATE (magic link) -----
    if (action === "impersonate") {
      const { data: u } = await admin.auth.admin.getUserById(target_user_id);
      if (!u.user?.email) return json({ error: "no email" }, 400);
      const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: u.user.email });
      if (error) return json({ error: error.message }, 400);
      await audit({ email: u.user.email });
      return json({ ok: true, action_link: data.properties?.action_link });
    }

    // ----- UPDATE PROFILE -----
    if (action === "update_profile") {
      const { full_name, organization, phone, role_title, admin_notes, party } = body;
      const patch: Record<string, any> = {};
      if (full_name !== undefined) patch.full_name = full_name;
      if (organization !== undefined) patch.organization = organization;
      if (phone !== undefined) patch.phone = phone;
      if (role_title !== undefined) patch.role_title = role_title;
      if (admin_notes !== undefined) patch.admin_notes = admin_notes;
      if (party !== undefined) patch.party = party;
      if (Object.keys(patch).length) await admin.from("profiles").update(patch).eq("id", target_user_id);
      if (body.email) {
        const { error } = await admin.auth.admin.updateUserById(target_user_id, { email: body.email });
        if (error) return json({ error: error.message }, 400);
      }
      await audit(patch);
      return json({ ok: true });
    }

    // ----- UPDATE SUBSCRIPTION (manual limits / expiration) -----
    if (action === "update_subscription") {
      const { max_candidates, max_updates_per_month, current_period_end, status, notes } = body;
      const patch: Record<string, any> = {};
      if (max_candidates !== undefined) patch.max_candidates = Number(max_candidates);
      if (max_updates_per_month !== undefined) patch.max_updates_per_month = Number(max_updates_per_month);
      if (current_period_end !== undefined) patch.current_period_end = new Date(current_period_end).toISOString();
      if (status !== undefined) patch.status = status;
      if (notes !== undefined) patch.notes = notes;
      const { data: existing } = await admin.from("subscriptions").select("id").eq("user_id", target_user_id).maybeSingle();
      if (existing) await admin.from("subscriptions").update(patch).eq("id", existing.id);
      else await admin.from("subscriptions").insert({ user_id: target_user_id, tier: "free", ...patch });
      await audit(patch);
      return json({ ok: true });
    }

    // ----- CHANGE PLAN (with optional duration) -----
    if (action === "change_plan") {
      const { tier, duration_days } = body;
      if (!tier) return json({ error: "missing tier" }, 400);
      const lim = limitsForTier(tier);
      const end = tier === "lifetime"
        ? new Date(Date.now() + 100 * 365 * 86400000).toISOString()
        : new Date(Date.now() + Number(duration_days ?? 365) * 86400000).toISOString();
      const payload = {
        user_id: target_user_id, tier, status: "active",
        max_candidates: lim.max_candidates, max_updates_per_month: lim.max_updates,
        current_period_start: new Date().toISOString(), current_period_end: end, cancelled_at: null,
      };
      const { data: existing } = await admin.from("subscriptions").select("id").eq("user_id", target_user_id).maybeSingle();
      if (existing) await admin.from("subscriptions").update(payload).eq("id", existing.id);
      else await admin.from("subscriptions").insert(payload);
      await audit({ tier, duration_days });
      return json({ ok: true });
    }

    // ----- REVOKE SUBSCRIPTION -----
    if (action === "revoke_subscription") {
      await admin.from("subscriptions").update({
        status: "cancelled", cancelled_at: new Date().toISOString(),
      }).eq("user_id", target_user_id);
      await audit({});
      return json({ ok: true });
    }

    // ----- HARD DELETE -----
    if (action === "hard_delete") {
      const tables = [
        "candidates", "candidate_analyses", "candidate_rankings",
        "social_interactions", "candidate_metrics_cache",
        "subscriptions", "user_roles", "speech_analyses",
        "undecided_analyses", "notifications", "narrative_alerts",
        "scheduled_reports", "report_templates", "api_keys", "export_jobs",
        "webhook_endpoints", "ai_insights", "candidate_social_links",
        "billing_history",
      ];
      for (const t of tables) {
        await admin.from(t).delete().eq("user_id", target_user_id).then(() => {}, () => {});
      }
      await admin.from("profiles").delete().eq("id", target_user_id);
      await admin.auth.admin.deleteUser(target_user_id);
      await audit({ cascade: tables });
      return json({ ok: true });
    }

    return json({ error: "unknown action" }, 400);
  } catch (e: any) {
    console.error(e);
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
