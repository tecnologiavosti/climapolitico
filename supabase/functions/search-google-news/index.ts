import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface NewsItem {
  title: string;
  link: string;
  pubDate: string;
  source: string;
  description: string;
}

function parseRSSFeed(xmlText: string): NewsItem[] {
  const items: NewsItem[] = [];
  
  // Simple XML parsing for RSS items
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  
  while ((match = itemRegex.exec(xmlText)) !== null) {
    const itemXml = match[1];
    
    const title = itemXml.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/)?.[1] || "";
    const link = itemXml.match(/<link>(.*?)<\/link>/)?.[1] || "";
    const pubDate = itemXml.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || "";
    const source = itemXml.match(/<source.*?>(.*?)<\/source>/)?.[1] || "Google News";
    const description = itemXml.match(/<description>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/description>/)?.[1] || "";
    
    if (title && link) {
      items.push({
        title: title.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"),
        link,
        pubDate,
        source,
        description: description.replace(/<[^>]*>/g, "").substring(0, 500),
      });
    }
  }
  
  return items;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { candidateName, candidateId, userId } = await req.json();

    if (!candidateName) {
      return new Response(JSON.stringify({ error: "candidateName is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Searching Google News for: ${candidateName}`);

    // Build Google News RSS URL
    const query = encodeURIComponent(`"${candidateName}" OR ${candidateName.split(" ")[0]}`);
    const googleNewsUrl = `https://news.google.com/rss/search?q=${query}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;

    const response = await fetch(googleNewsUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ClimaPolitico/1.0)",
      },
    });

    if (!response.ok) {
      console.error(`Google News returned status: ${response.status}`);
      return new Response(JSON.stringify({ 
        error: "Failed to fetch Google News",
        news: [],
        total: 0 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const xmlText = await response.text();
    const newsItems = parseRSSFeed(xmlText);

    console.log(`Found ${newsItems.length} news items for ${candidateName}`);

    // If candidateId and userId provided, save to social_interactions
    if (candidateId && userId) {
      const interactions = newsItems.slice(0, 50).map((item) => ({
        user_id: userId,
        candidate_id: candidateId,
        social_network: "google_news",
        interaction_type: "news",
        comment_text: `${item.title}\n\n${item.description}`,
        comment_author: item.source,
        author_profile_url: item.link,
        original_posted_at: item.pubDate ? new Date(item.pubDate).toISOString() : null,
        collected_at: new Date().toISOString(),
      }));

      if (interactions.length > 0) {
        const { error: insertError } = await supabase
          .from("social_interactions")
          .insert(interactions);

        if (insertError) {
          console.error("Error saving news to database:", insertError);
        } else {
          console.log(`Saved ${interactions.length} news items to database`);
        }
      }
    }

    return new Response(JSON.stringify({
      news: newsItems,
      total: newsItems.length,
      source: "google_news",
      candidateName,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: unknown) {
    console.error("Error in search-google-news:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});