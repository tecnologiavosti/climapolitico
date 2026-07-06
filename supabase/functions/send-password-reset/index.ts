import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const BRAND_NAME = "Clima Político";
const FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") ?? "onboarding@resend.dev";
const BASE_URL = "https://climapolitico.com.br";

async function sha256(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function randomToken(bytes = 32): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const genericOk = () =>
    new Response(
      JSON.stringify({
        success: true,
        message: "Se o e-mail existir, enviaremos as instruções.",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );

  try {
    const { email } = await req.json();
    if (!email || typeof email !== "string") {
      return new Response(JSON.stringify({ error: "Email é obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) {
      console.error("RESEND_API_KEY não configurada");
      return new Response(
        JSON.stringify({ error: "Serviço de e-mail não configurado" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // Localiza usuário sem vazar existência
    const { data: list, error: listErr } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });
    if (listErr) {
      console.error("listUsers error:", listErr);
      return genericOk();
    }
    const target = list.users.find(
      (u) => (u.email ?? "").toLowerCase() === email.toLowerCase(),
    );
    if (!target) return genericOk();

    // Token próprio — não usa admin.generateLink (evita e-mail interno do Lovable)
    const token = randomToken(32);
    const tokenHash = await sha256(token);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    // Invalida tokens anteriores
    await admin
      .from("password_reset_tokens")
      .update({ consumed_at: new Date().toISOString() })
      .eq("user_id", target.id)
      .is("consumed_at", null);

    const { error: insErr } = await admin.from("password_reset_tokens").insert({
      user_id: target.id,
      token_hash: tokenHash,
      expires_at: expiresAt,
    });
    if (insErr) {
      console.error("insert token error:", insErr);
      return genericOk();
    }

    const resetUrl = `${BASE_URL}/reset-password?token=${token}`;

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #0f172a;">
        <h2 style="color: #1e3a8a; margin: 0 0 16px;">${BRAND_NAME}</h2>
        <p style="margin: 0 0 12px; font-size: 15px;">Você solicitou a redefinição da sua senha.</p>
        <p style="margin: 0 0 20px; font-size: 15px;">Clique no botão abaixo para criar uma nova senha:</p>
        <p style="text-align:center; margin: 24px 0;">
          <a href="${resetUrl}"
             style="display:inline-block; padding:14px 24px; background:#1e3a8a; color:#ffffff; border-radius:8px; text-decoration:none; font-weight:600;">
            Redefinir senha
          </a>
        </p>
        <p style="color: #475569; font-size: 13px; margin: 0 0 6px;">Este link expira em 15 minutos.</p>
        <p style="color: #64748b; font-size: 13px; margin: 16px 0 0;">Se você não solicitou isso, ignore este e-mail.</p>
        <p style="color: #94a3b8; font-size: 12px; margin-top: 24px;">${BRAND_NAME}</p>
      </div>
    `;

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${BRAND_NAME} <${FROM_EMAIL}>`,
        to: [target.email],
        subject: `Redefinição de senha - ${BRAND_NAME}`,
        html,
        text: `Redefina sua senha em: ${resetUrl}\n\nExpira em 15 minutos.\n\n${BRAND_NAME}`,
      }),
    });

    const body = await resendRes.text();
    if (!resendRes.ok) {
      console.error("Resend error:", resendRes.status, body);
      return new Response(
        JSON.stringify({ error: "Falha ao enviar e-mail", detail: body }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(`[reset] Email enviado para ${target.email}`);
    return new Response(
      JSON.stringify({
        success: true,
        message: "Enviamos um e-mail com instruções para redefinir sua senha.",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("send-password-reset error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Erro" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
