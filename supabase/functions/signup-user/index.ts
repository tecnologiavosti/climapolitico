// signup-user: cria conta sem disparar e-mail nativo do Supabase.
// Usa admin.createUser com email_confirm=true — nenhum e-mail "System-Blueprint" é enviado.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BRAND_NAME = "Clima Político";
const FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") ?? "onboarding@resend.dev";

function validate(email: unknown, password: unknown, fullName: unknown): string | null {
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "E-mail inválido";
  if (typeof password !== "string" || password.length < 8) return "Senha deve ter no mínimo 8 caracteres";
  if (!/[A-Z]/.test(password)) return "Inclua ao menos 1 letra maiúscula";
  if (!/[a-z]/.test(password)) return "Inclua ao menos 1 letra minúscula";
  if (!/[0-9]/.test(password)) return "Inclua ao menos 1 número";
  if (typeof fullName !== "string" || fullName.trim().length < 2) return "Nome completo inválido";
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { email, password, full_name, organization } = await req.json();
    const err = validate(email, password, full_name);
    if (err) {
      return new Response(JSON.stringify({ error: err }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: created, error: cErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name, organization },
    });
    if (cErr || !created.user) {
      const msg = cErr?.message ?? "Falha ao criar conta";
      const already = /already registered|already exists|duplicate/i.test(msg);
      return new Response(
        JSON.stringify({ error: already ? "Este e-mail já está cadastrado" : msg }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Perfil (o trigger handle_new_user normalmente já cria; upsert garante os campos)
    await admin
      .from("profiles")
      .upsert({ id: created.user.id, full_name, organization }, { onConflict: "id" });

    // Envia e-mail de boas-vindas via Resend (opcional, silencioso em falha)
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (resendKey) {
      const html = `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#0f172a;">
          <h2 style="color:#1e3a8a;margin:0 0 16px;">${BRAND_NAME}</h2>
          <p style="margin:0 0 12px;font-size:15px;">Olá${full_name ? `, ${String(full_name).split(" ")[0]}` : ""}!</p>
          <p style="margin:0 0 12px;font-size:15px;">Sua conta foi criada com sucesso. Bem-vindo(a) ao ${BRAND_NAME}.</p>
          <p style="margin:20px 0;text-align:center;">
            <a href="https://climapolitico.com.br/auth" style="display:inline-block;padding:14px 24px;background:#1e3a8a;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">Acessar minha conta</a>
          </p>
          <p style="color:#94a3b8;font-size:12px;margin-top:24px;">${BRAND_NAME}</p>
        </div>`;
      try {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: `${BRAND_NAME} <${FROM_EMAIL}>`,
            to: [email],
            subject: `Bem-vindo(a) ao ${BRAND_NAME}`,
            html,
            text: `Bem-vindo(a) ao ${BRAND_NAME}! Acesse: https://climapolitico.com.br/auth`,
          }),
        });
      } catch (e) {
        console.error("welcome email error:", e);
      }
    }

    return new Response(JSON.stringify({ success: true, user_id: created.user.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("signup-user error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Erro" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
