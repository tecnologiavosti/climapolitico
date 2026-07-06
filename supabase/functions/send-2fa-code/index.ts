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

const BRAND_NAME = "Clima Político";

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

    // Generate 6-digit code (5 min expiry per product spec)
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const codeHash = await sha256(code);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    // Invalidate previous unconsumed codes (only 1 active code per user)
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

    // Send via Lovable transactional email queue
    let emailSent = false;
    try {
      const { error: emailErr } = await admin.rpc("enqueue_email", {
        p_payload: {
          to: user.email,
          from_name: BRAND_NAME,
          subject: `Seu código de verificação - ${BRAND_NAME}`,
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #0f172a;">
              <h2 style="color: #1e3a8a; margin: 0 0 16px;">${BRAND_NAME}</h2>
              <p style="margin: 0 0 12px;">Seu código de verificação é:</p>
              <div style="font-size: 34px; font-weight: 700; letter-spacing: 10px; color: #1e3a8a; background: #eff6ff; padding: 20px; text-align: center; border-radius: 10px; margin: 20px 0;">
                ${code}
              </div>
              <p style="color: #475569; font-size: 14px; margin: 0 0 6px;">Este código expira em 5 minutos.</p>
              <p style="color: #64748b; font-size: 13px; margin: 16px 0 0;">Se você não solicitou este código, ignore este e-mail.</p>
              <p style="color: #94a3b8; font-size: 12px; margin-top: 24px;">${BRAND_NAME}</p>
            </div>
          `,
          text: `Seu código de verificação é: ${code}\n\nEste código expira em 5 minutos.\n\n${BRAND_NAME}`,
          purpose: "transactional",
        },
        p_priority: 1,
      });
      if (!emailErr) emailSent = true;
      else console.error("enqueue_email error:", emailErr);
    } catch (e) {
      console.error("Email queue error:", e);
    }

    console.log(`[2FA] Code issued for ${user.email} (sent=${emailSent})`);

    return new Response(
      JSON.stringify({
        success: true,
        emailSent,
        message: "Enviamos um código de verificação para seu e-mail.",
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
