// Debug temporário: inspeciona um run do Apify
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const TOKEN = Deno.env.get("APIFY_API_TOKEN")!;
  const { runs } = await req.json();
  const out: any[] = [];
  for (const r of runs as string[]) {
    const meta = await (await fetch(`https://api.apify.com/v2/actor-runs/${r}?token=${TOKEN}`)).json();
    const items = await (await fetch(`https://api.apify.com/v2/actor-runs/${r}/dataset/items?token=${TOKEN}&clean=true&limit=2`)).json();
    out.push({
      run: r,
      status: meta?.data?.status,
      exitCode: meta?.data?.exitCode,
      stats: meta?.data?.stats,
      itemCount: Array.isArray(items) ? items.length : null,
      firstItem: Array.isArray(items) && items[0] ? items[0] : null,
    });
  }
  return new Response(JSON.stringify(out, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
