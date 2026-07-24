import { sendAuthEmail } from "../_shared/auth-email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { email } = await req.json().catch(() => ({ email: "" }));
    const to = (email as string) || "gustavo.leg.cortes@gmail.com";

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
        <h1 style="color:#0f172a;">✅ E-mail de teste — Clima Político</h1>
        <p style="color:#475569;">Se você recebeu esta mensagem, o sistema de envio de e-mails está funcionando corretamente.</p>
        <p style="color:#64748b;font-size:14px;">Enviado em ${new Date().toLocaleString("pt-BR")}</p>
      </div>
    `;
    const result = await sendAuthEmail({
      to,
      subject: "✅ Teste de envio — Clima Político",
      html,
    });
    return new Response(JSON.stringify({ ok: true, to, result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
