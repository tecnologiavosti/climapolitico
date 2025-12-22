import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface WikipediaResult {
  title: string;
  extract: string;
  pageUrl: string;
  thumbnail?: string;
  categories?: string[];
  infobox?: Record<string, string>;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { candidateName } = await req.json();

    if (!candidateName) {
      return new Response(JSON.stringify({ error: "candidateName is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Searching Wikipedia for: ${candidateName}`);

    // Search for the page
    const searchUrl = `https://pt.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(candidateName)}`;
    
    const response = await fetch(searchUrl, {
      headers: {
        "User-Agent": "ClimaPolitico/1.0 (https://climapolitico.com; contact@climapolitico.com)",
        "Accept": "application/json",
      },
    });

    if (response.status === 404) {
      // Try search API if direct lookup fails
      const searchApiUrl = `https://pt.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(candidateName)}&format=json&srlimit=5`;
      const searchResponse = await fetch(searchApiUrl, {
        headers: {
          "User-Agent": "ClimaPolitico/1.0",
          "Accept": "application/json",
        },
      });
      
      if (!searchResponse.ok) {
        return new Response(JSON.stringify({ 
          found: false,
          message: "Página não encontrada na Wikipedia",
          candidateName
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const searchData = await searchResponse.json();
      const results = searchData.query?.search || [];
      
      if (results.length === 0) {
        return new Response(JSON.stringify({ 
          found: false,
          message: "Nenhum resultado encontrado na Wikipedia",
          candidateName,
          suggestions: []
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Get summary of first result
      const firstResult = results[0];
      const summaryUrl = `https://pt.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(firstResult.title)}`;
      const summaryResponse = await fetch(summaryUrl, {
        headers: {
          "User-Agent": "ClimaPolitico/1.0",
          "Accept": "application/json",
        },
      });

      if (!summaryResponse.ok) {
        return new Response(JSON.stringify({ 
          found: false,
          message: "Erro ao buscar detalhes",
          suggestions: results.map((r: any) => r.title)
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const summaryData = await summaryResponse.json();
      
      const result: WikipediaResult = {
        title: summaryData.title,
        extract: summaryData.extract || "",
        pageUrl: summaryData.content_urls?.desktop?.page || `https://pt.wikipedia.org/wiki/${encodeURIComponent(summaryData.title)}`,
        thumbnail: summaryData.thumbnail?.source,
      };

      return new Response(JSON.stringify({
        found: true,
        ...result,
        source: "wikipedia",
        candidateName,
        otherResults: results.slice(1).map((r: any) => r.title)
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!response.ok) {
      return new Response(JSON.stringify({ 
        found: false,
        message: `Erro na API: ${response.status}`,
        candidateName
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();

    const result: WikipediaResult = {
      title: data.title,
      extract: data.extract || "",
      pageUrl: data.content_urls?.desktop?.page || `https://pt.wikipedia.org/wiki/${encodeURIComponent(data.title)}`,
      thumbnail: data.thumbnail?.source,
    };

    console.log(`Found Wikipedia page: ${result.title}`);

    return new Response(JSON.stringify({
      found: true,
      ...result,
      source: "wikipedia",
      candidateName,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: unknown) {
    console.error("Error in search-wikipedia:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});