import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.80.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface DeduplicateRequest {
  profiles: {
    username: string;
    network: string;
    url?: string;
    location_city?: string;
    location_state?: string;
  }[];
}

interface DeduplicateResponse {
  success: boolean;
  deduplicatedProfiles: {
    username: string;
    network: string;
    globalProfileId: string;
    isNew: boolean;
  }[];
}

function generateGlobalProfileId(username: string, network: string): string {
  // Normalize to lowercase and remove special characters for consistent matching
  const normalizedUsername = username.toLowerCase().trim().replace(/[@\s]/g, '');
  const normalizedNetwork = network.toLowerCase().trim();
  return `${normalizedNetwork}_${normalizedUsername}`;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    // Verify user
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      throw new Error('Unauthorized');
    }

    const { profiles }: DeduplicateRequest = await req.json();

    if (!profiles || !Array.isArray(profiles) || profiles.length === 0) {
      throw new Error('Invalid profiles array');
    }

    console.log(`Processing ${profiles.length} profiles for deduplication`);

    const deduplicatedProfiles: DeduplicateResponse['deduplicatedProfiles'] = [];

    for (const profile of profiles) {
      const { username, network, url, location_city, location_state } = profile;

      if (!username || !network) {
        console.warn('Skipping profile with missing username or network', profile);
        continue;
      }

      const globalProfileId = generateGlobalProfileId(username, network);

      // Check if profile already exists
      const { data: existingProfile, error: fetchError } = await supabase
        .from('unique_profiles')
        .select('*')
        .eq('global_profile_id', globalProfileId)
        .maybeSingle();

      if (fetchError) {
        console.error('Error fetching existing profile:', fetchError);
        throw fetchError;
      }

      let isNew = false;

      if (existingProfile) {
        // Update existing profile
        const platforms = existingProfile.platforms || [];
        const updatedPlatforms = Array.from(new Set([...platforms, network]));

        const { error: updateError } = await supabase
          .from('unique_profiles')
          .update({
            platforms: updatedPlatforms,
            total_appearances: existingProfile.total_appearances + 1,
            last_seen_at: new Date().toISOString(),
          })
          .eq('id', existingProfile.id);

        if (updateError) {
          console.error('Error updating profile:', updateError);
          throw updateError;
        }

        console.log(`Updated existing profile: ${globalProfileId}`);
      } else {
        // Insert new profile
        const { error: insertError } = await supabase
          .from('unique_profiles')
          .insert({
            global_profile_id: globalProfileId,
            profile_username: username,
            platforms: [network],
            total_appearances: 1,
          });

        if (insertError) {
          console.error('Error inserting profile:', insertError);
          throw insertError;
        }

        isNew = true;
        console.log(`Created new profile: ${globalProfileId}`);
      }

      deduplicatedProfiles.push({
        username,
        network,
        globalProfileId,
        isNew,
      });
    }

    // Refresh the materialized view for updated stats
    const { error: refreshError } = await supabase.rpc('refresh_network_profiles_deduplicated');
    if (refreshError) {
      console.error('Error refreshing materialized view:', refreshError);
      // Don't throw - this is not critical
    }

    console.log(`Successfully processed ${deduplicatedProfiles.length} profiles`);

    return new Response(
      JSON.stringify({
        success: true,
        deduplicatedProfiles,
      } as DeduplicateResponse),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Error in deduplicate-profiles:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    );
  }
});
