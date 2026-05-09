// Webhook dispatcher: envia eventos pendentes para endpoints externos com HMAC SHA-256.
// Roda via cron / chamada manual. Faz retry com backoff via reenfileiramento.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function hmac(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: pending } = await admin
    .from("webhook_deliveries")
    .select("id, endpoint_id, event_type, payload, attempts")
    .eq("status", "pending")
    .lt("attempts", 5)
    .limit(50);

  let ok = 0, fail = 0;
  for (const d of pending ?? []) {
    const { data: ep } = await admin
      .from("webhook_endpoints")
      .select("url, secret, is_active, consecutive_failures")
      .eq("id", d.endpoint_id).maybeSingle();
    if (!ep || !ep.is_active) continue;

    const body = JSON.stringify({ event: d.event_type, data: d.payload, delivery_id: d.id });
    const signature = await hmac(ep.secret, body);
    let status = 0, text = "";
    try {
      const res = await fetch(ep.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-clima-event": d.event_type,
          "x-clima-signature": `sha256=${signature}`,
        },
        body,
      });
      status = res.status;
      text = (await res.text()).slice(0, 2000);
    } catch (e) {
      text = String((e as Error).message).slice(0, 2000);
    }

    const success = status >= 200 && status < 300;
    await admin.from("webhook_deliveries").update({
      status: success ? "delivered" : (d.attempts + 1 >= 5 ? "failed" : "pending"),
      status_code: status || null,
      response_body: text,
      attempts: d.attempts + 1,
      delivered_at: success ? new Date().toISOString() : null,
    }).eq("id", d.id);

    await admin.from("webhook_endpoints").update(
      success
        ? { last_success_at: new Date().toISOString(), consecutive_failures: 0 }
        : { last_failure_at: new Date().toISOString(), consecutive_failures: (ep.consecutive_failures ?? 0) + 1 },
    ).eq("id", d.endpoint_id);

    success ? ok++ : fail++;
  }

  return new Response(JSON.stringify({ processed: (pending?.length ?? 0), ok, fail }), {
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
});
