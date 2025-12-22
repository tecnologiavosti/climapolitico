import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify admin auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if user is admin
    const { data: roleData } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .single();

    if (!roleData) {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { platform } = await req.json();

    if (!platform) {
      return new Response(JSON.stringify({ error: "Platform is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get API config for platform
    const { data: config, error: configError } = await supabase
      .from("api_configurations")
      .select("*")
      .eq("platform", platform)
      .single();

    if (configError || !config) {
      return new Response(JSON.stringify({ valid: false, message: "Configuração não encontrada" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let valid = false;
    let message = "";

    try {
      switch (platform) {
        case "twitter": {
          if (!config.api_key) {
            message = "Bearer Token não configurado";
            break;
          }
          // Test Twitter API
          const twitterRes = await fetch("https://api.twitter.com/2/tweets/search/recent?query=test&max_results=10", {
            headers: { Authorization: `Bearer ${config.api_key}` },
          });
          if (twitterRes.status === 200) {
            valid = true;
            message = "Token válido";
          } else if (twitterRes.status === 401) {
            message = "Token inválido ou expirado";
          } else if (twitterRes.status === 403) {
            message = "Acesso negado - verifique permissões do app";
          } else {
            const errorBody = await twitterRes.text();
            message = `Erro ${twitterRes.status}: ${errorBody.substring(0, 100)}`;
          }
          break;
        }

        case "youtube": {
          if (!config.api_key) {
            message = "API Key não configurada";
            break;
          }
          // Test YouTube API
          const ytRes = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&q=test&maxResults=1&key=${config.api_key}`);
          if (ytRes.status === 200) {
            valid = true;
            message = "API Key válida";
          } else if (ytRes.status === 400) {
            message = "API Key inválida";
          } else if (ytRes.status === 403) {
            const errorBody = await ytRes.json();
            message = errorBody.error?.message || "Quota excedida ou acesso negado";
          } else {
            message = `Erro ${ytRes.status}`;
          }
          break;
        }

        case "meta": {
          if (!config.access_token) {
            message = "Access Token não configurado";
            break;
          }
          // Test Meta Graph API
          const metaRes = await fetch(`https://graph.facebook.com/v18.0/me?access_token=${config.access_token}`);
          if (metaRes.status === 200) {
            valid = true;
            message = "Access Token válido";
          } else {
            const errorBody = await metaRes.json();
            message = errorBody.error?.message || "Token inválido";
          }
          break;
        }

        case "tiktok": {
          if (!config.access_token) {
            message = "Access Token não configurado";
            break;
          }
          // TikTok API validation is limited - just check format
          if (config.access_token.startsWith("act.") || config.access_token.length > 50) {
            valid = true;
            message = "Token configurado (validação completa requer chamada real)";
          } else {
            message = "Formato do token parece inválido";
          }
          break;
        }

        case "reddit": {
          if (!config.api_key || !config.api_secret) {
            message = "Client ID e/ou Secret não configurados";
            break;
          }
          // Test Reddit API - get access token
          const auth = btoa(`${config.api_key}:${config.api_secret}`);
          const redditRes = await fetch("https://www.reddit.com/api/v1/access_token", {
            method: "POST",
            headers: {
              Authorization: `Basic ${auth}`,
              "Content-Type": "application/x-www-form-urlencoded",
              "User-Agent": "ClimaPolítico/1.0",
            },
            body: "grant_type=client_credentials",
          });
          if (redditRes.status === 200) {
            const data = await redditRes.json();
            if (data.access_token) {
              valid = true;
              message = "Credenciais válidas";
            } else {
              message = "Resposta inesperada da API";
            }
          } else {
            message = "Credenciais inválidas";
          }
          break;
        }

        default:
          message = "Plataforma não suportada";
      }
    } catch (apiError: unknown) {
      console.error(`Error validating ${platform}:`, apiError);
      const errorMessage = apiError instanceof Error ? apiError.message : "Unknown error";
      message = `Erro de conexão: ${errorMessage}`;
    }

    // Update config with validation result
    await supabase
      .from("api_configurations")
      .update({
        verified_status: valid ? "valid" : "invalid",
        last_verified_at: new Date().toISOString(),
        error_message: valid ? null : message,
        updated_at: new Date().toISOString(),
      })
      .eq("id", config.id);

    console.log(`API validation for ${platform}: ${valid ? "VALID" : "INVALID"} - ${message}`);

    return new Response(JSON.stringify({ valid, message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: unknown) {
    console.error("Error in validate-api-key:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});