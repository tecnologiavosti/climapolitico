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

function validatePassword(pwd: unknown): string | null {
  if (typeof pwd !== "string") return "Senha inválida";
  if (pwd.length < 8) return "Senha deve ter no mínimo 8 caracteres";
  if (!/[A-Z]/.test(pwd)) return "Inclua ao menos 1 letra maiúscula";
  if (!/[a-z]/.test(pwd)) return "Inclua ao menos 1 letra minúscula";
  if (!/[0-9]/.test(pwd)) return "Inclua ao menos 1 número";
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { token, password, verifyOnly } = await req.json();
    if (!token || typeof token !== "string") {
      return new Response(JSON.stringify({ error: "Token inválido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const tokenHash = await sha256(token);
    const { data: row, error: selErr } = await admin
      .from("password_reset_tokens")
      .select("id, user_id, expires_at, consumed_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (selErr || !row) {
      return new Response(JSON.stringify({ error: "Link inválido ou expirado" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (row.consumed_at) {
      return new Response(JSON.stringify({ error: "Este link já foi utilizado" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      return new Response(JSON.stringify({ error: "Link expirado. Solicite um novo." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (verifyOnly) {
      return new Response(JSON.stringify({ success: true, valid: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const pwdErr = validatePassword(password);
    if (pwdErr) {
      return new Response(JSON.stringify({ error: pwdErr }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: updErr } = await admin.auth.admin.updateUserById(row.user_id, {
      password,
    });
    if (updErr) {
      console.error("updateUser error:", updErr);
      return new Response(JSON.stringify({ error: "Falha ao atualizar senha" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await admin
      .from("password_reset_tokens")
      .update({ consumed_at: new Date().toISOString() })
      .eq("id", row.id);

    return new Response(
      JSON.stringify({ success: true, message: "Senha redefinida com sucesso." }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("verify-password-reset error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Erro" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
