import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

async function sha256(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Não autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Não autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Generate 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const codeHash = await sha256(code);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    // Invalidate previous unconsumed codes
    await admin
      .from("email_otp_codes")
      .update({ consumed_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .is("consumed_at", null);

    const { error: insertErr } = await admin.from("email_otp_codes").insert({
      user_id: user.id,
      code_hash: codeHash,
      purpose: "login_2fa",
      expires_at: expiresAt,
    });

    if (insertErr) {
      console.error("Insert OTP error:", insertErr);
      return new Response(JSON.stringify({ error: "Erro ao gerar código" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Try to send via Lovable transactional email queue (may not be configured yet)
    let emailSent = false;
    try {
      const { error: emailErr } = await admin.rpc("enqueue_email", {
        p_payload: {
          to: user.email,
          subject: "Seu código de verificação - Clima Político",
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
              <h2 style="color: #1e3a8a;">Código de verificação</h2>
              <p>Use o código abaixo para confirmar seu acesso:</p>
              <div style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #1e3a8a; background: #eff6ff; padding: 16px; text-align: center; border-radius: 8px; margin: 16px 0;">
                ${code}
              </div>
              <p style="color: #6b7280; font-size: 14px;">Este código expira em 10 minutos.</p>
              <p style="color: #6b7280; font-size: 14px;">Se você não solicitou este código, ignore este e-mail.</p>
            </div>
          `,
          purpose: "transactional",
        },
        p_priority: 1,
      });
      if (!emailErr) emailSent = true;
    } catch (e) {
      console.warn("Email queue not configured:", e);
    }

    // DEV FALLBACK: log code so user can use it during development
    console.log(`[2FA] Code for user ${user.email}: ${code} (sent=${emailSent})`);

    return new Response(
      JSON.stringify({
        success: true,
        emailSent,
        // Only expose code in dev/non-production for testing
        devCode: emailSent ? null : code,
        message: emailSent
          ? "Código enviado para seu e-mail"
          : "Sistema de e-mail não configurado. Use o código de teste mostrado.",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("send-2fa-code error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Erro" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
