import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const BRAND_NAME = "Clima Político";
const FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") ?? "onboarding@resend.dev";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

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

    // Sempre força o domínio oficial de produção, ignorando origem do request
    const BASE_URL = "https://climapolitico.com.br";

    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // Gera o link oficial de recuperação do Supabase (válido por padrão do Auth)
    const { data, error } = await admin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo: `${BASE_URL}/reset-password` },
    });

    if (error) {
      console.error("generateLink error:", error);
      // Não vaza se usuário existe; responde sucesso genérico
      return new Response(
        JSON.stringify({ success: true, message: "Se o e-mail existir, enviaremos as instruções." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const actionLink = data?.properties?.action_link;
    if (!actionLink) {
      return new Response(
        JSON.stringify({ success: true, message: "Se o e-mail existir, enviaremos as instruções." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #0f172a;">
        <h2 style="color: #1e3a8a; margin: 0 0 16px;">${BRAND_NAME}</h2>
        <p style="margin: 0 0 12px; font-size: 15px;">Você solicitou a redefinição da sua senha.</p>
        <p style="margin: 0 0 20px; font-size: 15px;">Clique no botão abaixo para criar uma nova senha:</p>
        <p style="text-align:center; margin: 24px 0;">
          <a href="${actionLink}"
             style="display:inline-block; padding:14px 24px; background:#1e3a8a; color:#ffffff; border-radius:8px; text-decoration:none; font-weight:600;">
            Redefinir senha
          </a>
        </p>
        <p style="color: #475569; font-size: 13px; margin: 0 0 6px;">Este link expira em breve por segurança.</p>
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
        to: [email],
        subject: `Redefinição de senha - ${BRAND_NAME}`,
        html,
        text: `Redefina sua senha em: ${actionLink}\n\n${BRAND_NAME}`,
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

    console.log(`[reset] Email enviado para ${email}:`, body);
    return new Response(
      JSON.stringify({ success: true, message: "Enviamos um e-mail com instruções para redefinir sua senha." }),
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
