import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendAuthEmail } from "../_shared/auth-email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Alert = {
  type: "api" | "collector" | "youtube";
  severity: "critical" | "warning";
  name: string;
  message: string;
  usage_percent?: number;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Auth: admin only
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: role } = await supabase.from("user_roles")
      .select("role").eq("user_id", userData.user.id).eq("role", "admin").maybeSingle();
    if (!role) {
      return new Response(JSON.stringify({ error: "Admin required" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const sendEmail: boolean = !!body.send_email;
    const recipient: string | undefined = body.email;
    const warnThreshold: number = Number(body.warn_threshold ?? 70);
    const critThreshold: number = Number(body.critical_threshold ?? 90);

    const alerts: Alert[] = [];

    // 1) API configurations (invalid/expired keys)
    const { data: apis } = await supabase
      .from("api_configurations")
      .select("platform, verified_status, error_message, is_active, last_verified_at");
    for (const a of apis ?? []) {
      if (a.is_active === false) continue;
      if (a.verified_status === "invalid") {
        alerts.push({
          type: "api", severity: "critical", name: a.platform,
          message: `Chave inválida/expirada: ${a.error_message ?? "sem detalhes"}`,
        });
      }
    }

    // 2) Collector quotas
    const { data: quotas } = await supabase
      .from("collector_quota_state")
      .select("collector_name, daily_calls, max_daily_calls, paused_until");
    const nowIso = new Date().toISOString();
    for (const q of quotas ?? []) {
      const max = Number(q.max_daily_calls ?? 0);
      const used = Number(q.daily_calls ?? 0);
      const pct = max > 0 ? Math.round((used / max) * 100) : 0;
      if (q.paused_until && q.paused_until > nowIso) {
        alerts.push({
          type: "collector", severity: "critical", name: q.collector_name,
          message: `Pausado até ${new Date(q.paused_until).toLocaleString("pt-BR")} — ${used}/${max} chamadas`,
          usage_percent: pct,
        });
      } else if (pct >= critThreshold) {
        alerts.push({
          type: "collector", severity: "critical", name: q.collector_name,
          message: `${pct}% da quota diária consumida (${used}/${max})`, usage_percent: pct,
        });
      } else if (pct >= warnThreshold) {
        alerts.push({
          type: "collector", severity: "warning", name: q.collector_name,
          message: `${pct}% da quota diária consumida (${used}/${max})`, usage_percent: pct,
        });
      }
    }

    // 3) YouTube API keys
    const { data: ytKeys } = await supabase
      .from("youtube_api_keys")
      .select("label, is_active, quota_exceeded_count, last_quota_exceeded_at");
    const activeYt = (ytKeys ?? []).filter((k) => k.is_active);
    const exhaustedYt = activeYt.filter((k) => {
      if (!k.last_quota_exceeded_at) return false;
      const hoursAgo = (Date.now() - new Date(k.last_quota_exceeded_at).getTime()) / 3_600_000;
      return hoursAgo < 24;
    });
    if (activeYt.length > 0 && exhaustedYt.length === activeYt.length) {
      alerts.push({
        type: "youtube", severity: "critical", name: "YouTube API",
        message: `Todas as ${activeYt.length} chaves excederam quota nas últimas 24h`,
      });
    } else if (exhaustedYt.length > 0) {
      alerts.push({
        type: "youtube", severity: "warning", name: "YouTube API",
        message: `${exhaustedYt.length}/${activeYt.length} chaves excederam quota recentemente`,
      });
    }

    // Send email if requested and has alerts
    let emailSent = false;
    if (sendEmail && recipient && alerts.length > 0) {
      const rows = alerts.map((a) => `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">
            <span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;color:#fff;background:${a.severity === "critical" ? "#dc2626" : "#f59e0b"};">
              ${a.severity === "critical" ? "CRÍTICO" : "AVISO"}
            </span>
          </td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-weight:600;">${a.name}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#4b5563;">${a.message}</td>
        </tr>
      `).join("");

      const html = `
        <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px;">
          <h1 style="color:#0f172a;margin:0 0 8px;">🚨 Alertas de Tokens — Clima Político</h1>
          <p style="color:#64748b;margin:0 0 20px;">Detectamos ${alerts.length} alerta(s) de APIs/Coletores prestes a esgotar ou já com problema.</p>
          <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
            <thead style="background:#f8fafc;">
              <tr>
                <th style="text-align:left;padding:10px 12px;font-size:12px;color:#475569;">Nível</th>
                <th style="text-align:left;padding:10px 12px;font-size:12px;color:#475569;">Fonte</th>
                <th style="text-align:left;padding:10px 12px;font-size:12px;color:#475569;">Detalhe</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <p style="color:#94a3b8;font-size:12px;margin-top:20px;">Enviado automaticamente pelo Painel Admin — ${new Date().toLocaleString("pt-BR")}</p>
        </div>
      `;

      await sendAuthEmail({
        to: recipient,
        subject: `🚨 ${alerts.length} alerta(s) de tokens/APIs — Clima Político`,
        html,
      });
      emailSent = true;
    }

    return new Response(JSON.stringify({
      alerts,
      total: alerts.length,
      critical: alerts.filter((a) => a.severity === "critical").length,
      warning: alerts.filter((a) => a.severity === "warning").length,
      email_sent: emailSent,
      checked_at: new Date().toISOString(),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("check-token-alerts error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
