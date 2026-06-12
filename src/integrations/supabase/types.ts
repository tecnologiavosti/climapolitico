export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      ai_insights: {
        Row: {
          affected_candidates: Json
          candidate_id: string | null
          confidence_score: number | null
          created_at: string | null
          description: string
          dismissed_at: string | null
          id: string
          insight_type: string
          is_active: boolean
          priority: string
          recommended_actions: Json
          supporting_data: Json
          title: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          affected_candidates?: Json
          candidate_id?: string | null
          confidence_score?: number | null
          created_at?: string | null
          description: string
          dismissed_at?: string | null
          id?: string
          insight_type: string
          is_active?: boolean
          priority: string
          recommended_actions?: Json
          supporting_data?: Json
          title: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          affected_candidates?: Json
          candidate_id?: string | null
          confidence_score?: number | null
          created_at?: string | null
          description?: string
          dismissed_at?: string | null
          id?: string
          insight_type?: string
          is_active?: boolean
          priority?: string
          recommended_actions?: Json
          supporting_data?: Json
          title?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_insights_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
        ]
      }
      analysis_cache: {
        Row: {
          analysis_type: string
          cache_key: string
          created_at: string
          expires_at: string
          hit_count: number
          last_hit_at: string
          provider: string | null
          result: Json
        }
        Insert: {
          analysis_type?: string
          cache_key: string
          created_at?: string
          expires_at?: string
          hit_count?: number
          last_hit_at?: string
          provider?: string | null
          result: Json
        }
        Update: {
          analysis_type?: string
          cache_key?: string
          created_at?: string
          expires_at?: string
          hit_count?: number
          last_hit_at?: string
          provider?: string | null
          result?: Json
        }
        Relationships: []
      }
      analysis_jobs: {
        Row: {
          attempts: number
          candidate_id: string | null
          completed_at: string | null
          created_at: string
          id: string
          job_type: string
          last_error: string | null
          lease_expires_at: string | null
          leased_at: string | null
          max_attempts: number
          payload: Json
          priority: number
          related_id: string | null
          result: Json | null
          scheduled_at: string
          status: string
          updated_at: string
          user_id: string | null
          worker_id: string | null
        }
        Insert: {
          attempts?: number
          candidate_id?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          job_type: string
          last_error?: string | null
          lease_expires_at?: string | null
          leased_at?: string | null
          max_attempts?: number
          payload?: Json
          priority?: number
          related_id?: string | null
          result?: Json | null
          scheduled_at?: string
          status?: string
          updated_at?: string
          user_id?: string | null
          worker_id?: string | null
        }
        Update: {
          attempts?: number
          candidate_id?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          job_type?: string
          last_error?: string | null
          lease_expires_at?: string | null
          leased_at?: string | null
          max_attempts?: number
          payload?: Json
          priority?: number
          related_id?: string | null
          result?: Json | null
          scheduled_at?: string
          status?: string
          updated_at?: string
          user_id?: string | null
          worker_id?: string | null
        }
        Relationships: []
      }
      analysis_sources: {
        Row: {
          analysis_id: string
          collection_date: string | null
          collection_method: string | null
          comments_collected: number | null
          created_at: string | null
          data_quality_score: number | null
          followers_at_collection: number | null
          id: string
          inferred_region: string | null
          interactions_count: number | null
          posts_collected: number | null
          profile_global_id: string | null
          profile_location_city: string | null
          profile_location_state: string | null
          profile_unique_id: string
          profile_url: string | null
          profile_username: string | null
          social_network: string
          source_type: string
        }
        Insert: {
          analysis_id: string
          collection_date?: string | null
          collection_method?: string | null
          comments_collected?: number | null
          created_at?: string | null
          data_quality_score?: number | null
          followers_at_collection?: number | null
          id?: string
          inferred_region?: string | null
          interactions_count?: number | null
          posts_collected?: number | null
          profile_global_id?: string | null
          profile_location_city?: string | null
          profile_location_state?: string | null
          profile_unique_id: string
          profile_url?: string | null
          profile_username?: string | null
          social_network: string
          source_type: string
        }
        Update: {
          analysis_id?: string
          collection_date?: string | null
          collection_method?: string | null
          comments_collected?: number | null
          created_at?: string | null
          data_quality_score?: number | null
          followers_at_collection?: number | null
          id?: string
          inferred_region?: string | null
          interactions_count?: number | null
          posts_collected?: number | null
          profile_global_id?: string | null
          profile_location_city?: string | null
          profile_location_state?: string | null
          profile_unique_id?: string
          profile_url?: string | null
          profile_username?: string | null
          social_network?: string
          source_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "analysis_sources_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "candidate_analyses"
            referencedColumns: ["id"]
          },
        ]
      }
      api_configurations: {
        Row: {
          access_token: string | null
          api_key: string | null
          api_secret: string | null
          created_at: string | null
          error_message: string | null
          id: string
          is_active: boolean | null
          last_verified_at: string | null
          platform: string
          updated_at: string | null
          verified_status: string | null
        }
        Insert: {
          access_token?: string | null
          api_key?: string | null
          api_secret?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          is_active?: boolean | null
          last_verified_at?: string | null
          platform: string
          updated_at?: string | null
          verified_status?: string | null
        }
        Update: {
          access_token?: string | null
          api_key?: string | null
          api_secret?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          is_active?: boolean | null
          last_verified_at?: string | null
          platform?: string
          updated_at?: string | null
          verified_status?: string | null
        }
        Relationships: []
      }
      api_keys: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          rate_limit_per_minute: number
          revoked_at: string | null
          scopes: string[]
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          rate_limit_per_minute?: number
          revoked_at?: string | null
          scopes?: string[]
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          rate_limit_per_minute?: number
          revoked_at?: string | null
          scopes?: string[]
          user_id?: string
        }
        Relationships: []
      }
      apify_runs: {
        Row: {
          actor_id: string
          candidate_id: string
          created_at: string
          error_message: string | null
          finished_at: string | null
          id: string
          items_collected: number
          platform: string
          run_id: string | null
          status: string
          user_id: string
        }
        Insert: {
          actor_id: string
          candidate_id: string
          created_at?: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          items_collected?: number
          platform: string
          run_id?: string | null
          status?: string
          user_id: string
        }
        Update: {
          actor_id?: string
          candidate_id?: string
          created_at?: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          items_collected?: number
          platform?: string
          run_id?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "apify_runs_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_analyses: {
        Row: {
          age_distribution: Json | null
          ai_models_used: string[] | null
          analysis_status: string | null
          candidate_id: string
          created_at: string | null
          data_quality_score: number | null
          error_message: string | null
          followers_count: string | null
          gemini_3_pro_result: Json | null
          gemini_flash_result: Json | null
          gemini_pro_result: Json | null
          gender_distribution: Json | null
          geographic_scope: string | null
          gpt_5_nano_result: Json | null
          gpt_5_result: Json | null
          gpt5_mini_result: Json | null
          id: string
          ideology_confidence: number | null
          ideology_label: string | null
          keywords: string[] | null
          mentions_count: number | null
          posts_analyzed: number | null
          primary_data_source: string | null
          region_distribution: Json | null
          sentiment_confidence: number | null
          sentiment_label: string | null
          sentiment_score: number | null
          social_network: string | null
          topics: string[] | null
          total_profiles_analyzed: number | null
          trend: string | null
          unique_profiles_count: number | null
          user_id: string
        }
        Insert: {
          age_distribution?: Json | null
          ai_models_used?: string[] | null
          analysis_status?: string | null
          candidate_id: string
          created_at?: string | null
          data_quality_score?: number | null
          error_message?: string | null
          followers_count?: string | null
          gemini_3_pro_result?: Json | null
          gemini_flash_result?: Json | null
          gemini_pro_result?: Json | null
          gender_distribution?: Json | null
          geographic_scope?: string | null
          gpt_5_nano_result?: Json | null
          gpt_5_result?: Json | null
          gpt5_mini_result?: Json | null
          id?: string
          ideology_confidence?: number | null
          ideology_label?: string | null
          keywords?: string[] | null
          mentions_count?: number | null
          posts_analyzed?: number | null
          primary_data_source?: string | null
          region_distribution?: Json | null
          sentiment_confidence?: number | null
          sentiment_label?: string | null
          sentiment_score?: number | null
          social_network?: string | null
          topics?: string[] | null
          total_profiles_analyzed?: number | null
          trend?: string | null
          unique_profiles_count?: number | null
          user_id: string
        }
        Update: {
          age_distribution?: Json | null
          ai_models_used?: string[] | null
          analysis_status?: string | null
          candidate_id?: string
          created_at?: string | null
          data_quality_score?: number | null
          error_message?: string | null
          followers_count?: string | null
          gemini_3_pro_result?: Json | null
          gemini_flash_result?: Json | null
          gemini_pro_result?: Json | null
          gender_distribution?: Json | null
          geographic_scope?: string | null
          gpt_5_nano_result?: Json | null
          gpt_5_result?: Json | null
          gpt5_mini_result?: Json | null
          id?: string
          ideology_confidence?: number | null
          ideology_label?: string | null
          keywords?: string[] | null
          mentions_count?: number | null
          posts_analyzed?: number | null
          primary_data_source?: string | null
          region_distribution?: Json | null
          sentiment_confidence?: number | null
          sentiment_label?: string | null
          sentiment_score?: number | null
          social_network?: string | null
          topics?: string[] | null
          total_profiles_analyzed?: number | null
          trend?: string | null
          unique_profiles_count?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidate_analyses_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_metrics_cache: {
        Row: {
          average_sentiment: number | null
          candidate_id: string
          created_at: string
          followers_count: string | null
          id: string
          last_calculated_at: string
          negative_count: number
          network_breakdown: Json
          neutral_count: number
          positive_count: number
          total_engagement: number
          total_likes: number
          total_mentions: number
          total_replies: number
          total_shares: number
          unique_authors: number
          updated_at: string
          user_id: string
        }
        Insert: {
          average_sentiment?: number | null
          candidate_id: string
          created_at?: string
          followers_count?: string | null
          id?: string
          last_calculated_at?: string
          negative_count?: number
          network_breakdown?: Json
          neutral_count?: number
          positive_count?: number
          total_engagement?: number
          total_likes?: number
          total_mentions?: number
          total_replies?: number
          total_shares?: number
          unique_authors?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          average_sentiment?: number | null
          candidate_id?: string
          created_at?: string
          followers_count?: string | null
          id?: string
          last_calculated_at?: string
          negative_count?: number
          network_breakdown?: Json
          neutral_count?: number
          positive_count?: number
          total_engagement?: number
          total_likes?: number
          total_mentions?: number
          total_replies?: number
          total_shares?: number
          unique_authors?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidate_metrics_cache_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_rankings: {
        Row: {
          candidate_id: string
          created_at: string | null
          engagement_score: number
          id: string
          negative_perception: number
          overall_score: number
          period_end: string
          period_start: string
          positive_perception: number
          rank_change: number | null
          rank_position: number
          reach_score: number
          speech_impact_score: number | null
          trend_score: number
          user_id: string
        }
        Insert: {
          candidate_id: string
          created_at?: string | null
          engagement_score: number
          id?: string
          negative_perception: number
          overall_score: number
          period_end: string
          period_start: string
          positive_perception: number
          rank_change?: number | null
          rank_position: number
          reach_score: number
          speech_impact_score?: number | null
          trend_score: number
          user_id: string
        }
        Update: {
          candidate_id?: string
          created_at?: string | null
          engagement_score?: number
          id?: string
          negative_perception?: number
          overall_score?: number
          period_end?: string
          period_start?: string
          positive_perception?: number
          rank_change?: number | null
          rank_position?: number
          reach_score?: number
          speech_impact_score?: number | null
          trend_score?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidate_rankings_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_social_links: {
        Row: {
          candidate_id: string
          created_at: string
          handle: string | null
          id: string
          platform: string
          updated_at: string
          url: string
          user_id: string
        }
        Insert: {
          candidate_id: string
          created_at?: string
          handle?: string | null
          id?: string
          platform: string
          updated_at?: string
          url: string
          user_id: string
        }
        Update: {
          candidate_id?: string
          created_at?: string
          handle?: string | null
          id?: string
          platform?: string
          updated_at?: string
          url?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidate_social_links_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
        ]
      }
      candidates: {
        Row: {
          analysis_count: number | null
          created_at: string | null
          followers: string | null
          full_name: string
          id: string
          last_analysis_at: string | null
          mentions: number | null
          party: string | null
          region: string | null
          sentiment: number | null
          social_media_link: string | null
          status: string | null
          trend: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          analysis_count?: number | null
          created_at?: string | null
          followers?: string | null
          full_name: string
          id?: string
          last_analysis_at?: string | null
          mentions?: number | null
          party?: string | null
          region?: string | null
          sentiment?: number | null
          social_media_link?: string | null
          status?: string | null
          trend?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          analysis_count?: number | null
          created_at?: string | null
          followers?: string | null
          full_name?: string
          id?: string
          last_analysis_at?: string | null
          mentions?: number | null
          party?: string | null
          region?: string | null
          sentiment?: number | null
          social_media_link?: string | null
          status?: string | null
          trend?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      collection_configs: {
        Row: {
          candidate_id: string | null
          config: Json
          created_at: string | null
          id: string
          status: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          candidate_id?: string | null
          config?: Json
          created_at?: string | null
          id?: string
          status?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          candidate_id?: string | null
          config?: Json
          created_at?: string | null
          id?: string
          status?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "collection_configs_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
        ]
      }
      collector_pipeline_metrics: {
        Row: {
          candidate_id: string | null
          collected_count: number
          collector_name: string
          deduped_count: number
          discard_reasons: Json
          error_message: string | null
          executed_at: string
          execution_time_ms: number | null
          filtered_count: number
          had_error: boolean
          id: string
          inserted_count: number
          parsed_count: number
          source_breakdown: Json
        }
        Insert: {
          candidate_id?: string | null
          collected_count?: number
          collector_name: string
          deduped_count?: number
          discard_reasons?: Json
          error_message?: string | null
          executed_at?: string
          execution_time_ms?: number | null
          filtered_count?: number
          had_error?: boolean
          id?: string
          inserted_count?: number
          parsed_count?: number
          source_breakdown?: Json
        }
        Update: {
          candidate_id?: string | null
          collected_count?: number
          collector_name?: string
          deduped_count?: number
          discard_reasons?: Json
          error_message?: string | null
          executed_at?: string
          execution_time_ms?: number | null
          filtered_count?: number
          had_error?: boolean
          id?: string
          inserted_count?: number
          parsed_count?: number
          source_breakdown?: Json
        }
        Relationships: []
      }
      collector_quota_state: {
        Row: {
          collector_name: string
          created_at: string
          daily_calls: number
          daily_errors: number
          daily_items_collected: number
          id: string
          last_call_at: string | null
          last_reset_at: string
          max_daily_calls: number
          notes: string | null
          paused_until: string | null
          updated_at: string
        }
        Insert: {
          collector_name: string
          created_at?: string
          daily_calls?: number
          daily_errors?: number
          daily_items_collected?: number
          id?: string
          last_call_at?: string | null
          last_reset_at?: string
          max_daily_calls?: number
          notes?: string | null
          paused_until?: string | null
          updated_at?: string
        }
        Update: {
          collector_name?: string
          created_at?: string
          daily_calls?: number
          daily_errors?: number
          daily_items_collected?: number
          id?: string
          last_call_at?: string | null
          last_reset_at?: string
          max_daily_calls?: number
          notes?: string | null
          paused_until?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      collector_snapshots: {
        Row: {
          collector_name: string
          daily_calls: number
          daily_errors: number
          daily_items_collected: number
          id: string
          last_call_at: string | null
          max_daily_calls: number
          notes: string | null
          paused_until: string | null
          snapshot_label: string
          taken_at: string
        }
        Insert: {
          collector_name: string
          daily_calls?: number
          daily_errors?: number
          daily_items_collected?: number
          id?: string
          last_call_at?: string | null
          max_daily_calls?: number
          notes?: string | null
          paused_until?: string | null
          snapshot_label: string
          taken_at?: string
        }
        Update: {
          collector_name?: string
          daily_calls?: number
          daily_errors?: number
          daily_items_collected?: number
          id?: string
          last_call_at?: string | null
          max_daily_calls?: number
          notes?: string | null
          paused_until?: string | null
          snapshot_label?: string
          taken_at?: string
        }
        Relationships: []
      }
      collector_volume_snapshots: {
        Row: {
          id: string
          snapshot_label: string
          social_network: string
          taken_at: string
          volume_24h: number
          volume_30d: number
          volume_30d_previous: number
          volume_7d: number
        }
        Insert: {
          id?: string
          snapshot_label: string
          social_network: string
          taken_at?: string
          volume_24h?: number
          volume_30d?: number
          volume_30d_previous?: number
          volume_7d?: number
        }
        Update: {
          id?: string
          snapshot_label?: string
          social_network?: string
          taken_at?: string
          volume_24h?: number
          volume_30d?: number
          volume_30d_previous?: number
          volume_7d?: number
        }
        Relationships: []
      }
      daily_candidate_metrics: {
        Row: {
          candidate_id: string
          created_at: string
          engagement: number
          likes: number
          mentions: number
          metric_date: string
          negative_count: number
          neutral_count: number
          positive_count: number
          replies: number
          shares: number
          unique_authors: number
          unknown_count: number
          updated_at: string
          user_id: string
        }
        Insert: {
          candidate_id: string
          created_at?: string
          engagement?: number
          likes?: number
          mentions?: number
          metric_date: string
          negative_count?: number
          neutral_count?: number
          positive_count?: number
          replies?: number
          shares?: number
          unique_authors?: number
          unknown_count?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          candidate_id?: string
          created_at?: string
          engagement?: number
          likes?: number
          mentions?: number
          metric_date?: string
          negative_count?: number
          neutral_count?: number
          positive_count?: number
          replies?: number
          shares?: number
          unique_authors?: number
          unknown_count?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      daily_hashtag_metrics: {
        Row: {
          candidate_id: string
          created_at: string
          mentions: number
          metric_date: string
          negative_count: number
          network: string
          neutral_count: number
          positive_count: number
          tag: string
          updated_at: string
          user_id: string
        }
        Insert: {
          candidate_id: string
          created_at?: string
          mentions?: number
          metric_date: string
          negative_count?: number
          network: string
          neutral_count?: number
          positive_count?: number
          tag: string
          updated_at?: string
          user_id: string
        }
        Update: {
          candidate_id?: string
          created_at?: string
          mentions?: number
          metric_date?: string
          negative_count?: number
          network?: string
          neutral_count?: number
          positive_count?: number
          tag?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      daily_heatmap_metrics: {
        Row: {
          candidate_id: string
          created_at: string
          dow: number
          hr: number
          mentions: number
          metric_date: string
          network: string
          updated_at: string
          user_id: string
        }
        Insert: {
          candidate_id: string
          created_at?: string
          dow: number
          hr: number
          mentions?: number
          metric_date: string
          network: string
          updated_at?: string
          user_id: string
        }
        Update: {
          candidate_id?: string
          created_at?: string
          dow?: number
          hr?: number
          mentions?: number
          metric_date?: string
          network?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      daily_network_metrics: {
        Row: {
          candidate_id: string
          created_at: string
          engagement: number
          likes: number
          mentions: number
          metric_date: string
          negative_count: number
          network: string
          neutral_count: number
          positive_count: number
          replies: number
          shares: number
          unique_authors: number
          unknown_count: number
          updated_at: string
          user_id: string
        }
        Insert: {
          candidate_id: string
          created_at?: string
          engagement?: number
          likes?: number
          mentions?: number
          metric_date: string
          negative_count?: number
          network: string
          neutral_count?: number
          positive_count?: number
          replies?: number
          shares?: number
          unique_authors?: number
          unknown_count?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          candidate_id?: string
          created_at?: string
          engagement?: number
          likes?: number
          mentions?: number
          metric_date?: string
          negative_count?: number
          network?: string
          neutral_count?: number
          positive_count?: number
          replies?: number
          shares?: number
          unique_authors?: number
          unknown_count?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      daily_sentiment_metrics: {
        Row: {
          candidate_id: string
          created_at: string
          engagement: number
          mentions: number
          metric_date: string
          network: string
          sentiment: string
          updated_at: string
          user_id: string
        }
        Insert: {
          candidate_id: string
          created_at?: string
          engagement?: number
          mentions?: number
          metric_date: string
          network: string
          sentiment: string
          updated_at?: string
          user_id: string
        }
        Update: {
          candidate_id?: string
          created_at?: string
          engagement?: number
          mentions?: number
          metric_date?: string
          network?: string
          sentiment?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      daily_topic_metrics: {
        Row: {
          candidate_id: string
          created_at: string
          mentions: number
          metric_date: string
          negative_count: number
          network: string
          neutral_count: number
          positive_count: number
          theme: string
          updated_at: string
          user_id: string
        }
        Insert: {
          candidate_id: string
          created_at?: string
          mentions?: number
          metric_date: string
          negative_count?: number
          network: string
          neutral_count?: number
          positive_count?: number
          theme: string
          updated_at?: string
          user_id: string
        }
        Update: {
          candidate_id?: string
          created_at?: string
          mentions?: number
          metric_date?: string
          negative_count?: number
          network?: string
          neutral_count?: number
          positive_count?: number
          theme?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      data_consistency_audit_logs: {
        Row: {
          actual_count: number
          candidate_id: string | null
          check_name: string
          corrected_at: string | null
          created_at: string
          days: number
          details: Json
          diff_pct: number
          expected_count: number
          id: string
          network: string | null
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          actual_count?: number
          candidate_id?: string | null
          check_name: string
          corrected_at?: string | null
          created_at?: string
          days: number
          details?: Json
          diff_pct?: number
          expected_count?: number
          id?: string
          network?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          actual_count?: number
          candidate_id?: string | null
          check_name?: string
          corrected_at?: string | null
          created_at?: string
          days?: number
          details?: Json
          diff_pct?: number
          expected_count?: number
          id?: string
          network?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      edge_function_logs: {
        Row: {
          duration_ms: number | null
          error_message: string | null
          executed_at: string
          function_name: string
          id: string
          metadata: Json | null
          status: string
        }
        Insert: {
          duration_ms?: number | null
          error_message?: string | null
          executed_at?: string
          function_name: string
          id?: string
          metadata?: Json | null
          status: string
        }
        Update: {
          duration_ms?: number | null
          error_message?: string | null
          executed_at?: string
          function_name?: string
          id?: string
          metadata?: Json | null
          status?: string
        }
        Relationships: []
      }
      email_otp_codes: {
        Row: {
          attempts: number
          code_hash: string
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          purpose: string
          user_id: string
        }
        Insert: {
          attempts?: number
          code_hash: string
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          purpose?: string
          user_id: string
        }
        Update: {
          attempts?: number
          code_hash?: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          purpose?: string
          user_id?: string
        }
        Relationships: []
      }
      event_detection_jobs: {
        Row: {
          completed_at: string | null
          created_at: string
          error_message: string | null
          events_created: number | null
          id: string
          params: Json | null
          result: Json | null
          status: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          events_created?: number | null
          id: string
          params?: Json | null
          result?: Json | null
          status?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          events_created?: number | null
          id?: string
          params?: Json | null
          result?: Json | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      event_sources: {
        Row: {
          created_at: string
          credibility_score: number
          event_id: string
          id: string
          is_institutional: boolean
          is_major_media: boolean
          published_at: string | null
          raw: Json
          snippet: string | null
          source_name: string
          source_type: string
          title: string | null
          url: string
        }
        Insert: {
          created_at?: string
          credibility_score?: number
          event_id: string
          id?: string
          is_institutional?: boolean
          is_major_media?: boolean
          published_at?: string | null
          raw?: Json
          snippet?: string | null
          source_name: string
          source_type: string
          title?: string | null
          url: string
        }
        Update: {
          created_at?: string
          credibility_score?: number
          event_id?: string
          id?: string
          is_institutional?: boolean
          is_major_media?: boolean
          published_at?: string | null
          raw?: Json
          snippet?: string | null
          source_name?: string
          source_type?: string
          title?: string | null
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_sources_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "political_events"
            referencedColumns: ["id"]
          },
        ]
      }
      export_jobs: {
        Row: {
          completed_at: string | null
          created_at: string
          download_expires_at: string | null
          download_url: string | null
          error_message: string | null
          export_type: string
          file_size_bytes: number | null
          filters: Json
          id: string
          progress: number
          resource: string
          rows_exported: number | null
          status: string
          storage_path: string | null
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          download_expires_at?: string | null
          download_url?: string | null
          error_message?: string | null
          export_type: string
          file_size_bytes?: number | null
          filters?: Json
          id?: string
          progress?: number
          resource: string
          rows_exported?: number | null
          status?: string
          storage_path?: string | null
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          download_expires_at?: string | null
          download_url?: string | null
          error_message?: string | null
          export_type?: string
          file_size_bytes?: number | null
          filters?: Json
          id?: string
          progress?: number
          resource?: string
          rows_exported?: number | null
          status?: string
          storage_path?: string | null
          user_id?: string
        }
        Relationships: []
      }
      failed_analyses: {
        Row: {
          attempts: number
          candidate_id: string | null
          comment_text: string | null
          first_failed_at: string
          id: string
          interaction_id: string | null
          last_error: string | null
          last_failed_at: string
          metadata: Json
          provider_used: string | null
          resolved_at: string | null
          user_id: string | null
        }
        Insert: {
          attempts?: number
          candidate_id?: string | null
          comment_text?: string | null
          first_failed_at?: string
          id?: string
          interaction_id?: string | null
          last_error?: string | null
          last_failed_at?: string
          metadata?: Json
          provider_used?: string | null
          resolved_at?: string | null
          user_id?: string | null
        }
        Update: {
          attempts?: number
          candidate_id?: string | null
          comment_text?: string | null
          first_failed_at?: string
          id?: string
          interaction_id?: string | null
          last_error?: string | null
          last_failed_at?: string
          metadata?: Json
          provider_used?: string | null
          resolved_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      historical_mentions: {
        Row: {
          candidate_id: string
          created_at: string
          date: string
          engagement: number
          fetched_at: string
          id: string
          mentions: number
          platform: string
          region: string | null
          sentiment_negative: number
          sentiment_neutral: number
          sentiment_positive: number
          source: string
          themes: string[]
          user_id: string
        }
        Insert: {
          candidate_id: string
          created_at?: string
          date: string
          engagement?: number
          fetched_at?: string
          id?: string
          mentions?: number
          platform?: string
          region?: string | null
          sentiment_negative?: number
          sentiment_neutral?: number
          sentiment_positive?: number
          source?: string
          themes?: string[]
          user_id: string
        }
        Update: {
          candidate_id?: string
          created_at?: string
          date?: string
          engagement?: number
          fetched_at?: string
          id?: string
          mentions?: number
          platform?: string
          region?: string | null
          sentiment_negative?: number
          sentiment_neutral?: number
          sentiment_positive?: number
          source?: string
          themes?: string[]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "historical_mentions_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
        ]
      }
      historical_metrics: {
        Row: {
          average_sentiment: number | null
          candidate_id: string
          created_at: string
          data_source: string
          engagement: number
          id: string
          mentions: number
          metric_date: string
          negative_count: number
          network_breakdown: Json
          neutral_count: number
          positive_count: number
          region_breakdown: Json
          top_topics: Json
          user_id: string
        }
        Insert: {
          average_sentiment?: number | null
          candidate_id: string
          created_at?: string
          data_source?: string
          engagement?: number
          id?: string
          mentions?: number
          metric_date: string
          negative_count?: number
          network_breakdown?: Json
          neutral_count?: number
          positive_count?: number
          region_breakdown?: Json
          top_topics?: Json
          user_id: string
        }
        Update: {
          average_sentiment?: number | null
          candidate_id?: string
          created_at?: string
          data_source?: string
          engagement?: number
          id?: string
          mentions?: number
          metric_date?: string
          negative_count?: number
          network_breakdown?: Json
          neutral_count?: number
          positive_count?: number
          region_breakdown?: Json
          top_topics?: Json
          user_id?: string
        }
        Relationships: []
      }
      job_execution_history: {
        Row: {
          duration_ms: number | null
          error_message: string | null
          finished_at: string | null
          id: string
          job_id: string
          metadata: Json
          started_at: string
          status: string
          worker_id: string | null
        }
        Insert: {
          duration_ms?: number | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          job_id: string
          metadata?: Json
          started_at?: string
          status: string
          worker_id?: string | null
        }
        Update: {
          duration_ms?: number | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          job_id?: string
          metadata?: Json
          started_at?: string
          status?: string
          worker_id?: string | null
        }
        Relationships: []
      }
      narrative_alerts: {
        Row: {
          affected_groups: Json
          alternative_narrative: string | null
          candidate_id: string
          confidence: number | null
          created_at: string
          detected_bubble: string | null
          dominant_sentiment: string | null
          dominant_theme: string | null
          id: string
          is_dismissed: boolean
          metadata: Json
          opportunities: Json
          region: string | null
          risks: Json
          spike_volume: number | null
          suggested_action: string | null
          trigger_reason: string
          user_id: string
        }
        Insert: {
          affected_groups?: Json
          alternative_narrative?: string | null
          candidate_id: string
          confidence?: number | null
          created_at?: string
          detected_bubble?: string | null
          dominant_sentiment?: string | null
          dominant_theme?: string | null
          id?: string
          is_dismissed?: boolean
          metadata?: Json
          opportunities?: Json
          region?: string | null
          risks?: Json
          spike_volume?: number | null
          suggested_action?: string | null
          trigger_reason: string
          user_id: string
        }
        Update: {
          affected_groups?: Json
          alternative_narrative?: string | null
          candidate_id?: string
          confidence?: number | null
          created_at?: string
          detected_bubble?: string | null
          dominant_sentiment?: string | null
          dominant_theme?: string | null
          id?: string
          is_dismissed?: boolean
          metadata?: Json
          opportunities?: Json
          region?: string | null
          risks?: Json
          spike_volume?: number | null
          suggested_action?: string | null
          trigger_reason?: string
          user_id?: string
        }
        Relationships: []
      }
      network_view_cache: {
        Row: {
          cache_key: string
          candidate_id: string | null
          created_at: string
          days: number
          duration_ms: number
          expires_at: string
          hit_count: number
          last_hit_at: string
          network: string | null
          plan: Json
          result: Json
          section: string
          source_rows: number
          updated_at: string
          user_id: string
        }
        Insert: {
          cache_key: string
          candidate_id?: string | null
          created_at?: string
          days: number
          duration_ms?: number
          expires_at: string
          hit_count?: number
          last_hit_at?: string
          network?: string | null
          plan?: Json
          result: Json
          section: string
          source_rows?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          cache_key?: string
          candidate_id?: string | null
          created_at?: string
          days?: number
          duration_ms?: number
          expires_at?: string
          hit_count?: number
          last_hit_at?: string
          network?: string | null
          plan?: Json
          result?: Json
          section?: string
          source_rows?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      network_view_query_logs: {
        Row: {
          cache_hit: boolean
          candidate_id: string | null
          created_at: string
          days: number | null
          duration_ms: number
          error_message: string | null
          id: string
          network: string | null
          plan: Json
          records_read: number
          records_returned: number
          section: string
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          cache_hit?: boolean
          candidate_id?: string | null
          created_at?: string
          days?: number | null
          duration_ms?: number
          error_message?: string | null
          id?: string
          network?: string | null
          plan?: Json
          records_read?: number
          records_returned?: number
          section: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          cache_hit?: boolean
          candidate_id?: string | null
          created_at?: string
          days?: number | null
          duration_ms?: number
          error_message?: string | null
          id?: string
          network?: string | null
          plan?: Json
          records_read?: number
          records_returned?: number
          section?: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      nitter_instances: {
        Row: {
          blacklisted_until: string | null
          consecutive_failures: number
          created_at: string
          failure_count: number
          health_score: number
          id: string
          is_active: boolean
          items_collected: number
          last_checked: string | null
          last_error_at: string | null
          last_error_message: string | null
          latency_ms_avg: number
          success_count: number
          updated_at: string
          url: string
        }
        Insert: {
          blacklisted_until?: string | null
          consecutive_failures?: number
          created_at?: string
          failure_count?: number
          health_score?: number
          id?: string
          is_active?: boolean
          items_collected?: number
          last_checked?: string | null
          last_error_at?: string | null
          last_error_message?: string | null
          latency_ms_avg?: number
          success_count?: number
          updated_at?: string
          url: string
        }
        Update: {
          blacklisted_until?: string | null
          consecutive_failures?: number
          created_at?: string
          failure_count?: number
          health_score?: number
          id?: string
          is_active?: boolean
          items_collected?: number
          last_checked?: string | null
          last_error_at?: string | null
          last_error_message?: string | null
          latency_ms_avg?: number
          success_count?: number
          updated_at?: string
          url?: string
        }
        Relationships: []
      }
      non_political_keywords: {
        Row: {
          active: boolean
          category: string
          created_at: string
          id: string
          keyword: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          category?: string
          created_at?: string
          id?: string
          keyword: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          category?: string
          created_at?: string
          id?: string
          keyword?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          candidate_id: string | null
          created_at: string
          id: string
          is_read: boolean
          message: string
          metadata: Json
          severity: string
          title: string
          type: string
          user_id: string
        }
        Insert: {
          candidate_id?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          message: string
          metadata?: Json
          severity?: string
          title: string
          type?: string
          user_id: string
        }
        Update: {
          candidate_id?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string
          metadata?: Json
          severity?: string
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_metrics: {
        Row: {
          id: number
          labels: Json
          metric_name: string
          metric_value: number
          recorded_at: string
        }
        Insert: {
          id?: number
          labels?: Json
          metric_name: string
          metric_value: number
          recorded_at?: string
        }
        Update: {
          id?: number
          labels?: Json
          metric_name?: string
          metric_value?: number
          recorded_at?: string
        }
        Relationships: []
      }
      political_events: {
        Row: {
          ai_cause: string | null
          ai_impact: string | null
          ai_sentiment: number | null
          ai_summary: string | null
          ai_summary_v2: string | null
          ai_tags: string[]
          ai_why_peak: string | null
          baseline_mentions: number
          candidate_id: string
          category: string | null
          category_v2: string | null
          city: string | null
          confidence_band: string
          confidence_level: string | null
          confidence_score: number
          confidence_v2: number
          created_at: string
          cross_platform_score: number
          description: string | null
          detection_source: string | null
          detectors_triggered: string[]
          distinct_outlets: number
          dynamic_threshold: number
          end_date: string | null
          event_date: string
          event_name: string
          event_score: number | null
          event_type: string
          evidence_quality: string | null
          id: string
          importance: number
          importance_score: number
          institutional_confirmations: number
          institutional_sources: number
          is_externally_validated: boolean
          is_social_only: boolean
          keywords: string[]
          large_media_confirmations: number
          location: string | null
          low_coverage: boolean
          major_media_sources: number
          metadata: Json
          narratives: Json
          peak_date: string | null
          peak_hourly_mentions: number
          publications_count: number
          relevance_score: number | null
          significance_score: number | null
          social_score: number | null
          source_authority_avg: number
          source_count: number
          source_diversity_score: number
          sources_json: Json
          start_date: string | null
          state: string | null
          status: string
          summary: string | null
          themes: string[]
          title: string | null
          title_canonical: string | null
          top_headlines: Json
          total_sources: number
          updated_at: string
          user_id: string
          validation_sources: Json
        }
        Insert: {
          ai_cause?: string | null
          ai_impact?: string | null
          ai_sentiment?: number | null
          ai_summary?: string | null
          ai_summary_v2?: string | null
          ai_tags?: string[]
          ai_why_peak?: string | null
          baseline_mentions?: number
          candidate_id: string
          category?: string | null
          category_v2?: string | null
          city?: string | null
          confidence_band?: string
          confidence_level?: string | null
          confidence_score?: number
          confidence_v2?: number
          created_at?: string
          cross_platform_score?: number
          description?: string | null
          detection_source?: string | null
          detectors_triggered?: string[]
          distinct_outlets?: number
          dynamic_threshold?: number
          end_date?: string | null
          event_date: string
          event_name: string
          event_score?: number | null
          event_type?: string
          evidence_quality?: string | null
          id?: string
          importance?: number
          importance_score?: number
          institutional_confirmations?: number
          institutional_sources?: number
          is_externally_validated?: boolean
          is_social_only?: boolean
          keywords?: string[]
          large_media_confirmations?: number
          location?: string | null
          low_coverage?: boolean
          major_media_sources?: number
          metadata?: Json
          narratives?: Json
          peak_date?: string | null
          peak_hourly_mentions?: number
          publications_count?: number
          relevance_score?: number | null
          significance_score?: number | null
          social_score?: number | null
          source_authority_avg?: number
          source_count?: number
          source_diversity_score?: number
          sources_json?: Json
          start_date?: string | null
          state?: string | null
          status?: string
          summary?: string | null
          themes?: string[]
          title?: string | null
          title_canonical?: string | null
          top_headlines?: Json
          total_sources?: number
          updated_at?: string
          user_id: string
          validation_sources?: Json
        }
        Update: {
          ai_cause?: string | null
          ai_impact?: string | null
          ai_sentiment?: number | null
          ai_summary?: string | null
          ai_summary_v2?: string | null
          ai_tags?: string[]
          ai_why_peak?: string | null
          baseline_mentions?: number
          candidate_id?: string
          category?: string | null
          category_v2?: string | null
          city?: string | null
          confidence_band?: string
          confidence_level?: string | null
          confidence_score?: number
          confidence_v2?: number
          created_at?: string
          cross_platform_score?: number
          description?: string | null
          detection_source?: string | null
          detectors_triggered?: string[]
          distinct_outlets?: number
          dynamic_threshold?: number
          end_date?: string | null
          event_date?: string
          event_name?: string
          event_score?: number | null
          event_type?: string
          evidence_quality?: string | null
          id?: string
          importance?: number
          importance_score?: number
          institutional_confirmations?: number
          institutional_sources?: number
          is_externally_validated?: boolean
          is_social_only?: boolean
          keywords?: string[]
          large_media_confirmations?: number
          location?: string | null
          low_coverage?: boolean
          major_media_sources?: number
          metadata?: Json
          narratives?: Json
          peak_date?: string | null
          peak_hourly_mentions?: number
          publications_count?: number
          relevance_score?: number | null
          significance_score?: number | null
          social_score?: number | null
          source_authority_avg?: number
          source_count?: number
          source_diversity_score?: number
          sources_json?: Json
          start_date?: string | null
          state?: string | null
          status?: string
          summary?: string | null
          themes?: string[]
          title?: string | null
          title_canonical?: string | null
          top_headlines?: Json
          total_sources?: number
          updated_at?: string
          user_id?: string
          validation_sources?: Json
        }
        Relationships: []
      }
      profiles: {
        Row: {
          active_session_id: string | null
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
          language: string
          notification_preferences: Json | null
          onboarding_completed_at: string | null
          organization: string | null
          party: string | null
          party_visible: boolean
          phone: string | null
          role_title: string | null
          show_tooltips: boolean
          theme: string
          two_factor_enabled: boolean
          updated_at: string
        }
        Insert: {
          active_session_id?: string | null
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          language?: string
          notification_preferences?: Json | null
          onboarding_completed_at?: string | null
          organization?: string | null
          party?: string | null
          party_visible?: boolean
          phone?: string | null
          role_title?: string | null
          show_tooltips?: boolean
          theme?: string
          two_factor_enabled?: boolean
          updated_at?: string
        }
        Update: {
          active_session_id?: string | null
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          language?: string
          notification_preferences?: Json | null
          onboarding_completed_at?: string | null
          organization?: string | null
          party?: string | null
          party_visible?: boolean
          phone?: string | null
          role_title?: string | null
          show_tooltips?: boolean
          theme?: string
          two_factor_enabled?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      provider_health: {
        Row: {
          avg_latency_ms: number
          consecutive_failures: number
          consecutive_successes: number
          cooldown_until: string | null
          health_score: number
          last_failure_at: string | null
          last_success_at: string | null
          provider: string
          state: string
          total_calls: number
          total_failures: number
          updated_at: string
        }
        Insert: {
          avg_latency_ms?: number
          consecutive_failures?: number
          consecutive_successes?: number
          cooldown_until?: string | null
          health_score?: number
          last_failure_at?: string | null
          last_success_at?: string | null
          provider: string
          state?: string
          total_calls?: number
          total_failures?: number
          updated_at?: string
        }
        Update: {
          avg_latency_ms?: number
          consecutive_failures?: number
          consecutive_successes?: number
          cooldown_until?: string | null
          health_score?: number
          last_failure_at?: string | null
          last_success_at?: string | null
          provider?: string
          state?: string
          total_calls?: number
          total_failures?: number
          updated_at?: string
        }
        Relationships: []
      }
      public_candidates_catalog: {
        Row: {
          category: string | null
          created_at: string
          description: string | null
          full_name: string
          id: string
          is_active: boolean
          party: string | null
          region: string | null
          social_media_link: string | null
          updated_at: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          description?: string | null
          full_name: string
          id?: string
          is_active?: boolean
          party?: string | null
          region?: string | null
          social_media_link?: string | null
          updated_at?: string
        }
        Update: {
          category?: string | null
          created_at?: string
          description?: string | null
          full_name?: string
          id?: string
          is_active?: boolean
          party?: string | null
          region?: string | null
          social_media_link?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      rate_limits: {
        Row: {
          blocked_until: string | null
          endpoint: string
          id: number
          identifier: string
          request_count: number
          window_start: string
        }
        Insert: {
          blocked_until?: string | null
          endpoint: string
          id?: number
          identifier: string
          request_count?: number
          window_start?: string
        }
        Update: {
          blocked_until?: string | null
          endpoint?: string
          id?: number
          identifier?: string
          request_count?: number
          window_start?: string
        }
        Relationships: []
      }
      report_templates: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          is_default: boolean | null
          name: string
          sections: Json
          styling: Json | null
          template_type: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_default?: boolean | null
          name: string
          sections?: Json
          styling?: Json | null
          template_type?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_default?: boolean | null
          name?: string
          sections?: Json
          styling?: Json | null
          template_type?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      scheduled_reports: {
        Row: {
          candidate_id: string | null
          created_at: string | null
          export_format: string
          frequency: string
          id: string
          is_active: boolean | null
          last_run_at: string | null
          name: string
          next_run_at: string | null
          recipients: Json | null
          template_id: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          candidate_id?: string | null
          created_at?: string | null
          export_format: string
          frequency: string
          id?: string
          is_active?: boolean | null
          last_run_at?: string | null
          name: string
          next_run_at?: string | null
          recipients?: Json | null
          template_id?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          candidate_id?: string | null
          created_at?: string | null
          export_format?: string
          frequency?: string
          id?: string
          is_active?: boolean | null
          last_run_at?: string | null
          name?: string
          next_run_at?: string | null
          recipients?: Json | null
          template_id?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_reports_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_reports_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "report_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      slo_targets: {
        Row: {
          comparator: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          metric_name: string
          name: string
          severity: string
          target_value: number
          updated_at: string
          window_minutes: number
        }
        Insert: {
          comparator?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          metric_name: string
          name: string
          severity?: string
          target_value: number
          updated_at?: string
          window_minutes?: number
        }
        Update: {
          comparator?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          metric_name?: string
          name?: string
          severity?: string
          target_value?: number
          updated_at?: string
          window_minutes?: number
        }
        Relationships: []
      }
      social_event_metrics: {
        Row: {
          computed_at: string
          engagement: number
          event_id: string
          id: string
          mentions: number
          platform: string
          polarization: number | null
          sentiment_avg: number | null
          unique_authors: number
          velocity: number
          window_end: string | null
          window_start: string | null
        }
        Insert: {
          computed_at?: string
          engagement?: number
          event_id: string
          id?: string
          mentions?: number
          platform: string
          polarization?: number | null
          sentiment_avg?: number | null
          unique_authors?: number
          velocity?: number
          window_end?: string | null
          window_start?: string | null
        }
        Update: {
          computed_at?: string
          engagement?: number
          event_id?: string
          id?: string
          mentions?: number
          platform?: string
          polarization?: number | null
          sentiment_avg?: number | null
          unique_authors?: number
          velocity?: number
          window_end?: string | null
          window_start?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "social_event_metrics_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "political_events"
            referencedColumns: ["id"]
          },
        ]
      }
      social_interactions: {
        Row: {
          analysis_attempts: number
          analysis_id: string | null
          author_handle: string | null
          author_name: string | null
          author_profile_url: string | null
          candidate_id: string
          city: string | null
          collected_at: string | null
          comment_author: string | null
          comment_text: string | null
          created_at: string | null
          engagement_score: number | null
          event_id: string | null
          external_id: string | null
          id: string
          interaction_type: string
          invalidated_at: string | null
          invalidation_reason: string | null
          is_political_content: boolean
          latitude: number | null
          likes_count: number | null
          longitude: number | null
          original_posted_at: string | null
          parent_comment_id: string | null
          platform: string | null
          political_relevance_score: number
          political_validation_reason: string | null
          post_description: string | null
          post_id: string | null
          post_title: string | null
          post_url: string | null
          region: string | null
          replies_count: number | null
          root_comment_id: string | null
          sentiment_confidence: number | null
          sentiment_label: string | null
          sentiment_score: number | null
          shares_count: number | null
          social_network: string
          state: string | null
          thumbnail_url: string | null
          user_id: string
        }
        Insert: {
          analysis_attempts?: number
          analysis_id?: string | null
          author_handle?: string | null
          author_name?: string | null
          author_profile_url?: string | null
          candidate_id: string
          city?: string | null
          collected_at?: string | null
          comment_author?: string | null
          comment_text?: string | null
          created_at?: string | null
          engagement_score?: number | null
          event_id?: string | null
          external_id?: string | null
          id?: string
          interaction_type?: string
          invalidated_at?: string | null
          invalidation_reason?: string | null
          is_political_content?: boolean
          latitude?: number | null
          likes_count?: number | null
          longitude?: number | null
          original_posted_at?: string | null
          parent_comment_id?: string | null
          platform?: string | null
          political_relevance_score?: number
          political_validation_reason?: string | null
          post_description?: string | null
          post_id?: string | null
          post_title?: string | null
          post_url?: string | null
          region?: string | null
          replies_count?: number | null
          root_comment_id?: string | null
          sentiment_confidence?: number | null
          sentiment_label?: string | null
          sentiment_score?: number | null
          shares_count?: number | null
          social_network: string
          state?: string | null
          thumbnail_url?: string | null
          user_id: string
        }
        Update: {
          analysis_attempts?: number
          analysis_id?: string | null
          author_handle?: string | null
          author_name?: string | null
          author_profile_url?: string | null
          candidate_id?: string
          city?: string | null
          collected_at?: string | null
          comment_author?: string | null
          comment_text?: string | null
          created_at?: string | null
          engagement_score?: number | null
          event_id?: string | null
          external_id?: string | null
          id?: string
          interaction_type?: string
          invalidated_at?: string | null
          invalidation_reason?: string | null
          is_political_content?: boolean
          latitude?: number | null
          likes_count?: number | null
          longitude?: number | null
          original_posted_at?: string | null
          parent_comment_id?: string | null
          platform?: string | null
          political_relevance_score?: number
          political_validation_reason?: string | null
          post_description?: string | null
          post_id?: string | null
          post_title?: string | null
          post_url?: string | null
          region?: string | null
          replies_count?: number | null
          root_comment_id?: string | null
          sentiment_confidence?: number | null
          sentiment_label?: string | null
          sentiment_score?: number | null
          shares_count?: number | null
          social_network?: string
          state?: string | null
          thumbnail_url?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_interactions_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "candidate_analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_interactions_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
        ]
      }
      social_metrics_daily: {
        Row: {
          candidate_id: string
          comments: number
          created_at: string
          date: string
          likes: number
          mentions: number
          negative: number
          network: string
          neutral: number
          positive: number
          shares: number
          unique_authors: number
          updated_at: string
          user_id: string
        }
        Insert: {
          candidate_id: string
          comments?: number
          created_at?: string
          date: string
          likes?: number
          mentions?: number
          negative?: number
          network: string
          neutral?: number
          positive?: number
          shares?: number
          unique_authors?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          candidate_id?: string
          comments?: number
          created_at?: string
          date?: string
          likes?: number
          mentions?: number
          negative?: number
          network?: string
          neutral?: number
          positive?: number
          shares?: number
          unique_authors?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      social_posts: {
        Row: {
          apify_run_id: string | null
          author: string | null
          candidate_id: string
          collected_at: string
          comments_count: number
          content: string | null
          id: string
          likes: number
          platform: string
          post_id: string | null
          posted_at: string | null
          shares_count: number
          type: string
          url: string | null
          user_id: string
        }
        Insert: {
          apify_run_id?: string | null
          author?: string | null
          candidate_id: string
          collected_at?: string
          comments_count?: number
          content?: string | null
          id?: string
          likes?: number
          platform: string
          post_id?: string | null
          posted_at?: string | null
          shares_count?: number
          type?: string
          url?: string | null
          user_id: string
        }
        Update: {
          apify_run_id?: string | null
          author?: string | null
          candidate_id?: string
          collected_at?: string
          comments_count?: number
          content?: string | null
          id?: string
          likes?: number
          platform?: string
          post_id?: string | null
          posted_at?: string | null
          shares_count?: number
          type?: string
          url?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_posts_apify_run_id_fkey"
            columns: ["apify_run_id"]
            isOneToOne: false
            referencedRelation: "apify_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_posts_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
        ]
      }
      source_registry: {
        Row: {
          created_at: string
          credibility_weight: number
          id: string
          is_active: boolean
          metadata: Json
          rss_url: string | null
          source_domain: string | null
          source_name: string
          source_type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          credibility_weight?: number
          id?: string
          is_active?: boolean
          metadata?: Json
          rss_url?: string | null
          source_domain?: string | null
          source_name: string
          source_type: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          credibility_weight?: number
          id?: string
          is_active?: boolean
          metadata?: Json
          rss_url?: string | null
          source_domain?: string | null
          source_name?: string
          source_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      speech_analyses: {
        Row: {
          affected_voter_profiles: Json | null
          ai_model_used: string | null
          analysis_confidence: number | null
          analysis_period_end: string | null
          analysis_period_start: string | null
          candidate_id: string | null
          communication_suggestions: Json | null
          created_at: string | null
          emotional_analysis: Json | null
          id: string
          individual_speeches: Json | null
          media_type: string | null
          media_url: string | null
          negative_perception_score: number | null
          period_summary: Json | null
          problematic_segments: Json | null
          psychological_impact: string | null
          recommended_actions: Json | null
          risk_level: number | null
          source_analysis_id: string | null
          source_type: string | null
          speech_date: string | null
          speech_duration: number | null
          speech_text: string
          speech_title: string
          speech_type: string | null
          transcription_status: string | null
          trigger_words: Json | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          affected_voter_profiles?: Json | null
          ai_model_used?: string | null
          analysis_confidence?: number | null
          analysis_period_end?: string | null
          analysis_period_start?: string | null
          candidate_id?: string | null
          communication_suggestions?: Json | null
          created_at?: string | null
          emotional_analysis?: Json | null
          id?: string
          individual_speeches?: Json | null
          media_type?: string | null
          media_url?: string | null
          negative_perception_score?: number | null
          period_summary?: Json | null
          problematic_segments?: Json | null
          psychological_impact?: string | null
          recommended_actions?: Json | null
          risk_level?: number | null
          source_analysis_id?: string | null
          source_type?: string | null
          speech_date?: string | null
          speech_duration?: number | null
          speech_text: string
          speech_title: string
          speech_type?: string | null
          transcription_status?: string | null
          trigger_words?: Json | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          affected_voter_profiles?: Json | null
          ai_model_used?: string | null
          analysis_confidence?: number | null
          analysis_period_end?: string | null
          analysis_period_start?: string | null
          candidate_id?: string | null
          communication_suggestions?: Json | null
          created_at?: string | null
          emotional_analysis?: Json | null
          id?: string
          individual_speeches?: Json | null
          media_type?: string | null
          media_url?: string | null
          negative_perception_score?: number | null
          period_summary?: Json | null
          problematic_segments?: Json | null
          psychological_impact?: string | null
          recommended_actions?: Json | null
          risk_level?: number | null
          source_analysis_id?: string | null
          source_type?: string | null
          speech_date?: string | null
          speech_duration?: number | null
          speech_text?: string
          speech_title?: string
          speech_type?: string | null
          transcription_status?: string | null
          trigger_words?: Json | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "speech_analyses_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "speech_analyses_source_analysis_id_fkey"
            columns: ["source_analysis_id"]
            isOneToOne: false
            referencedRelation: "candidate_analyses"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          cancelled_at: string | null
          created_at: string
          current_period_end: string
          current_period_start: string
          id: string
          max_candidates: number
          max_updates_per_month: number
          status: string
          tier: Database["public"]["Enums"]["subscription_tier"]
          updated_at: string
          updates_used_this_month: number
          user_id: string
        }
        Insert: {
          cancelled_at?: string | null
          created_at?: string
          current_period_end?: string
          current_period_start?: string
          id?: string
          max_candidates?: number
          max_updates_per_month?: number
          status?: string
          tier?: Database["public"]["Enums"]["subscription_tier"]
          updated_at?: string
          updates_used_this_month?: number
          user_id: string
        }
        Update: {
          cancelled_at?: string | null
          created_at?: string
          current_period_end?: string
          current_period_start?: string
          id?: string
          max_candidates?: number
          max_updates_per_month?: number
          status?: string
          tier?: Database["public"]["Enums"]["subscription_tier"]
          updated_at?: string
          updates_used_this_month?: number
          user_id?: string
        }
        Relationships: []
      }
      system_alerts: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          alert_type: string
          created_at: string
          id: string
          message: string
          metadata: Json
          resolved_at: string | null
          severity: string
          title: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          alert_type: string
          created_at?: string
          id?: string
          message: string
          metadata?: Json
          resolved_at?: string | null
          severity?: string
          title: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          alert_type?: string
          created_at?: string
          id?: string
          message?: string
          metadata?: Json
          resolved_at?: string | null
          severity?: string
          title?: string
        }
        Relationships: []
      }
      trending_candidates_cache: {
        Row: {
          candidate_id: string | null
          full_name: string
          mentions_count: number
          party: string | null
          photo_url: string | null
          rank: number
          region: string | null
          role: string
          search_score: number
          updated_at: string
        }
        Insert: {
          candidate_id?: string | null
          full_name: string
          mentions_count?: number
          party?: string | null
          photo_url?: string | null
          rank?: number
          region?: string | null
          role: string
          search_score?: number
          updated_at?: string
        }
        Update: {
          candidate_id?: string | null
          full_name?: string
          mentions_count?: number
          party?: string | null
          photo_url?: string | null
          rank?: number
          region?: string | null
          role?: string
          search_score?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trending_candidates_cache_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
        ]
      }
      undecided_analyses: {
        Row: {
          ai_model_used: string | null
          analysis_period_end: string | null
          analysis_period_start: string | null
          behavioral_patterns: Json | null
          candidate_id: string
          candidates_comparison: Json | null
          confidence_score: number | null
          created_at: string | null
          decision_triggers: Json | null
          demographic_profile: Json | null
          id: string
          key_topics: string[] | null
          neutral_profiles_count: number | null
          persuasion_strategies: Json | null
          sentiment_fluctuation_score: number | null
          social_media_breakdown: Json | null
          temporal_evolution: Json | null
          total_profiles_analyzed: number | null
          undecided_percentage: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          ai_model_used?: string | null
          analysis_period_end?: string | null
          analysis_period_start?: string | null
          behavioral_patterns?: Json | null
          candidate_id: string
          candidates_comparison?: Json | null
          confidence_score?: number | null
          created_at?: string | null
          decision_triggers?: Json | null
          demographic_profile?: Json | null
          id?: string
          key_topics?: string[] | null
          neutral_profiles_count?: number | null
          persuasion_strategies?: Json | null
          sentiment_fluctuation_score?: number | null
          social_media_breakdown?: Json | null
          temporal_evolution?: Json | null
          total_profiles_analyzed?: number | null
          undecided_percentage?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          ai_model_used?: string | null
          analysis_period_end?: string | null
          analysis_period_start?: string | null
          behavioral_patterns?: Json | null
          candidate_id?: string
          candidates_comparison?: Json | null
          confidence_score?: number | null
          created_at?: string | null
          decision_triggers?: Json | null
          demographic_profile?: Json | null
          id?: string
          key_topics?: string[] | null
          neutral_profiles_count?: number | null
          persuasion_strategies?: Json | null
          sentiment_fluctuation_score?: number | null
          social_media_breakdown?: Json | null
          temporal_evolution?: Json | null
          total_profiles_analyzed?: number | null
          undecided_percentage?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "undecided_analyses_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
        ]
      }
      unique_profiles: {
        Row: {
          created_at: string | null
          first_seen_at: string | null
          global_profile_id: string
          id: string
          last_seen_at: string | null
          platforms: Json | null
          profile_username: string
          total_appearances: number | null
        }
        Insert: {
          created_at?: string | null
          first_seen_at?: string | null
          global_profile_id: string
          id?: string
          last_seen_at?: string | null
          platforms?: Json | null
          profile_username: string
          total_appearances?: number | null
        }
        Update: {
          created_at?: string | null
          first_seen_at?: string | null
          global_profile_id?: string
          id?: string
          last_seen_at?: string | null
          platforms?: Json | null
          profile_username?: string
          total_appearances?: number | null
        }
        Relationships: []
      }
      usage_events: {
        Row: {
          cost_units: number
          event_type: string
          id: number
          metadata: Json
          occurred_at: string
          quantity: number
          resource: string | null
          user_id: string
        }
        Insert: {
          cost_units?: number
          event_type: string
          id?: number
          metadata?: Json
          occurred_at?: string
          quantity?: number
          resource?: string | null
          user_id: string
        }
        Update: {
          cost_units?: number
          event_type?: string
          id?: number
          metadata?: Json
          occurred_at?: string
          quantity?: number
          resource?: string | null
          user_id?: string
        }
        Relationships: []
      }
      usage_limits: {
        Row: {
          created_at: string
          event_type: string
          hard_block: boolean
          id: string
          monthly_limit: number
          tier: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          event_type: string
          hard_block?: boolean
          id?: string
          monthly_limit: number
          tier: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          event_type?: string
          hard_block?: boolean
          id?: string
          monthly_limit?: number
          tier?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      webhook_deliveries: {
        Row: {
          attempts: number
          created_at: string
          delivered_at: string | null
          endpoint_id: string
          event_type: string
          id: number
          payload: Json
          response_body: string | null
          status: string
          status_code: number | null
        }
        Insert: {
          attempts?: number
          created_at?: string
          delivered_at?: string | null
          endpoint_id: string
          event_type: string
          id?: number
          payload: Json
          response_body?: string | null
          status?: string
          status_code?: number | null
        }
        Update: {
          attempts?: number
          created_at?: string
          delivered_at?: string | null
          endpoint_id?: string
          event_type?: string
          id?: number
          payload?: Json
          response_body?: string | null
          status?: string
          status_code?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "webhook_deliveries_endpoint_id_fkey"
            columns: ["endpoint_id"]
            isOneToOne: false
            referencedRelation: "webhook_endpoints"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_endpoints: {
        Row: {
          consecutive_failures: number
          created_at: string
          events: string[]
          id: string
          is_active: boolean
          last_failure_at: string | null
          last_success_at: string | null
          name: string
          secret: string
          updated_at: string
          url: string
          user_id: string
        }
        Insert: {
          consecutive_failures?: number
          created_at?: string
          events?: string[]
          id?: string
          is_active?: boolean
          last_failure_at?: string | null
          last_success_at?: string | null
          name: string
          secret: string
          updated_at?: string
          url: string
          user_id: string
        }
        Update: {
          consecutive_failures?: number
          created_at?: string
          events?: string[]
          id?: string
          is_active?: boolean
          last_failure_at?: string | null
          last_success_at?: string | null
          name?: string
          secret?: string
          updated_at?: string
          url?: string
          user_id?: string
        }
        Relationships: []
      }
      worker_api_tokens: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          last_used_at: string | null
          name: string
          revoked_at: string | null
          scopes: string[]
          token_hash: string
          token_prefix: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          last_used_at?: string | null
          name: string
          revoked_at?: string | null
          scopes?: string[]
          token_hash: string
          token_prefix: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          last_used_at?: string | null
          name?: string
          revoked_at?: string | null
          scopes?: string[]
          token_hash?: string
          token_prefix?: string
        }
        Relationships: []
      }
      worker_heartbeats: {
        Row: {
          current_job_id: string | null
          jobs_failed: number
          jobs_processed: number
          last_heartbeat_at: string
          metadata: Json
          started_at: string
          worker_id: string
          worker_type: string
        }
        Insert: {
          current_job_id?: string | null
          jobs_failed?: number
          jobs_processed?: number
          last_heartbeat_at?: string
          metadata?: Json
          started_at?: string
          worker_id: string
          worker_type: string
        }
        Update: {
          current_job_id?: string | null
          jobs_failed?: number
          jobs_processed?: number
          last_heartbeat_at?: string
          metadata?: Json
          started_at?: string
          worker_id?: string
          worker_type?: string
        }
        Relationships: []
      }
      youtube_api_keys: {
        Row: {
          api_key: string
          created_at: string
          id: string
          is_active: boolean
          label: string | null
          last_quota_exceeded_at: string | null
          last_used_at: string | null
          quota_exceeded_count: number
          updated_at: string
        }
        Insert: {
          api_key: string
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string | null
          last_quota_exceeded_at?: string | null
          last_used_at?: string | null
          quota_exceeded_count?: number
          updated_at?: string
        }
        Update: {
          api_key?: string
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string | null
          last_quota_exceeded_at?: string | null
          last_used_at?: string | null
          quota_exceeded_count?: number
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      network_profiles_deduplicated: {
        Row: {
          analyses_count: number | null
          profile_location_state: string | null
          social_network: string | null
          total_profiles: number | null
          unique_profiles: number | null
        }
        Relationships: []
      }
      observability_overview: {
        Row: {
          avg_duration_ms_1h: number | null
          calls_1h: number | null
          dlq_pending: number | null
          errors_1h: number | null
          low_confidence_neutrals: number | null
          total_interactions: number | null
          unlabeled_count: number | null
          unread_notifications: number | null
        }
        Relationships: []
      }
      operations_overview: {
        Row: {
          active_workers: number | null
          dead: number | null
          failed: number | null
          leased: number | null
          open_alerts: number | null
          queued: number | null
          running: number | null
          succeeded_last_hour: number | null
        }
        Relationships: []
      }
      pipeline_health: {
        Row: {
          candidate_id: string | null
          dead_letter: number | null
          low_conf_neutrals: number | null
          pct_unlabeled: number | null
          total: number | null
          unlabeled: number | null
        }
        Relationships: [
          {
            foreignKeyName: "social_interactions_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_metrics_hourly: {
        Row: {
          avg_value: number | null
          bucket: string | null
          max_value: number | null
          metric_name: string | null
          p50: number | null
          p95: number | null
          p99: number | null
          samples: number | null
          sum_value: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      _region_from_uf: { Args: { uf: string }; Returns: string }
      _regional_city_dict: {
        Args: never
        Returns: {
          city: string
          norm: string
          region: string
          uf: string
        }[]
      }
      candidates_comparison_timeline: {
        Args: { _candidate_ids: string[]; _days?: number }
        Returns: {
          candidate_id: string
          day: string
          mentions: number
        }[]
      }
      check_api_rate_limit: {
        Args: { _key_id: string; _limit: number }
        Returns: boolean
      }
      check_rate_limit: {
        Args: {
          _endpoint: string
          _identifier: string
          _max_per_minute?: number
        }
        Returns: boolean
      }
      check_usage_limit: {
        Args: { _event_type: string; _user_id: string }
        Returns: {
          allowed: boolean
          hard_block: boolean
          monthly_limit: number
          remaining: number
          tier: string
          used: number
        }[]
      }
      claim_jobs: {
        Args: {
          _batch_size?: number
          _job_type: string
          _lease_seconds?: number
          _worker_id: string
        }
        Returns: {
          attempts: number
          candidate_id: string | null
          completed_at: string | null
          created_at: string
          id: string
          job_type: string
          last_error: string | null
          lease_expires_at: string | null
          leased_at: string | null
          max_attempts: number
          payload: Json
          priority: number
          related_id: string | null
          result: Json | null
          scheduled_at: string
          status: string
          updated_at: string
          user_id: string | null
          worker_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "analysis_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      clean_external_content: { Args: { input: string }; Returns: string }
      cleanup_analysis_cache: { Args: never; Returns: number }
      cleanup_old_notifications: { Args: never; Returns: number }
      cleanup_pipeline_data: { Args: never; Returns: undefined }
      cleanup_rate_limits: { Args: never; Returns: undefined }
      collection_status_summary: {
        Args: never
        Returns: {
          last_collected_at: string
          last24h_count: number
          network: string
          total_30d: number
        }[]
      }
      collector_health_snapshot: { Args: never; Returns: Json }
      compute_slo_status: {
        Args: never
        Returns: {
          comparator: string
          current_value: number
          is_compliant: boolean
          metric_name: string
          name: string
          samples: number
          severity: string
          slo_id: string
          target_value: number
          window_minutes: number
        }[]
      }
      create_api_key: {
        Args: {
          _expires_days?: number
          _name: string
          _rate_limit_per_minute?: number
          _scopes?: string[]
        }
        Returns: Json
      }
      create_worker_token: {
        Args: { _expires_days?: number; _name: string; _scopes?: string[] }
        Returns: Json
      }
      data_consistency_diagnostics: {
        Args: { p_candidate_id?: string; p_days?: number }
        Returns: Json
      }
      dlq_summary: {
        Args: never
        Returns: {
          dead_count: number
          job_type: string
          newest: string
          oldest: string
        }[]
      }
      enforce_retention_policies: { Args: never; Returns: Json }
      enforce_usage_limit: {
        Args: {
          _cost_units?: number
          _event_type: string
          _metadata?: Json
          _quantity?: number
          _resource?: string
          _user_id: string
        }
        Returns: Json
      }
      enqueue_pending_sentiment_jobs: {
        Args: {
          _batch_size?: number
          _candidate_id?: string
          _period_end?: string
          _period_start?: string
          _user_id: string
        }
        Returns: Json
      }
      event_ssot_correlation: {
        Args: { p_candidate_id: string; p_end: string; p_start: string }
        Returns: Json
      }
      get_cities_ranking_summary: {
        Args: { _candidate_id: string; _user_id: string }
        Returns: Json
      }
      get_historical_period_aggregate: {
        Args: {
          _candidate_id: string
          _period_end: string
          _period_start: string
          _user_id: string
        }
        Returns: Json
      }
      get_network_profiles_stats: {
        Args: { _user_id?: string }
        Returns: {
          analyses_count: number
          profile_location_state: string
          social_network: string
          total_profiles: number
          unique_profiles: number
        }[]
      }
      get_pipeline_metrics_hourly: {
        Args: { _hours?: number; _metric?: string }
        Returns: {
          avg_value: number
          bucket: string
          max_value: number
          metric_name: string
          p50: number
          p95: number
          p99: number
          samples: number
          sum_value: number
        }[]
      }
      get_reactions_activity_hour_week: {
        Args: {
          _candidate_id?: string
          _period_end?: string
          _period_start?: string
          _user_id: string
        }
        Returns: Json
      }
      get_reactions_dominant_topics: {
        Args: {
          _candidate_id?: string
          _period_end?: string
          _period_start?: string
          _sample_limit?: number
          _user_id: string
        }
        Returns: Json
      }
      get_reactions_engagement_by_network: {
        Args: {
          _candidate_id?: string
          _period_end?: string
          _period_start?: string
          _user_id: string
        }
        Returns: Json
      }
      get_reactions_per_post_summary: {
        Args: {
          _candidate_id?: string
          _period_end?: string
          _period_start?: string
          _user_id: string
        }
        Returns: Json
      }
      get_reactions_sentiment_by_network: {
        Args: {
          _candidate_id?: string
          _period_end?: string
          _period_start?: string
          _user_id: string
        }
        Returns: Json
      }
      get_reactions_top_posts: {
        Args: {
          _candidate_id?: string
          _limit?: number
          _period_end?: string
          _period_start?: string
          _user_id: string
        }
        Returns: Json
      }
      get_reactions_totals: {
        Args: {
          _candidate_id?: string
          _period_end?: string
          _period_start?: string
          _user_id: string
        }
        Returns: Json
      }
      get_regional_map_summary: {
        Args: { _candidate_id: string; _user_id: string }
        Returns: Json
      }
      get_tenant_analytics: {
        Args: { _days?: number; _limit?: number }
        Returns: {
          ai_analyses: number
          exports: number
          full_name: string
          last_active: string
          tier: string
          total_cost: number
          total_events: number
          user_id: string
        }[]
      }
      get_user_usage_summary: {
        Args: { _days?: number }
        Returns: {
          event_type: string
          last_event: string
          total_cost: number
          total_quantity: number
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      log_network_view_query: {
        Args: {
          p_cache_hit: boolean
          p_candidate_id: string
          p_days: number
          p_duration_ms: number
          p_error_message?: string
          p_network: string
          p_plan?: Json
          p_records_read: number
          p_records_returned: number
          p_section: string
          p_status: string
          p_user_id: string
        }
        Returns: undefined
      }
      network_view_aggregate: {
        Args: { p_candidate_id?: string; p_days?: number; p_network?: string }
        Returns: Json
      }
      network_view_content_metrics: {
        Args: { p_candidate_id?: string; p_days?: number; p_network?: string }
        Returns: Json
      }
      network_view_core_metrics: {
        Args: { p_candidate_id?: string; p_days?: number; p_network?: string }
        Returns: Json
      }
      network_view_core_metrics_v12_impl: {
        Args: { p_candidate_id?: string; p_days?: number; p_network?: string }
        Returns: Json
      }
      network_view_sentiment:
        | { Args: { _label: string }; Returns: string }
        | {
            Args: { _label: string; _score?: number; _text?: string }
            Returns: string
          }
      network_view_top_posts: {
        Args: { p_candidate_id?: string; p_days?: number; p_network?: string }
        Returns: Json
      }
      norm_text: { Args: { _value: string }; Returns: string }
      normalize_social_platform: { Args: { _network: string }; Returns: string }
      nv_canonical_timestamp: {
        Args: {
          _collected_at: string
          _created_at: string
          _original_posted_at: string
        }
        Returns: string
      }
      nv_clean_text: { Args: { _text: string }; Returns: string }
      nv_fast_sentiment: {
        Args: { _label: string; _score?: number }
        Returns: string
      }
      nv_hashtag_display: { Args: { _tag: string }; Returns: string }
      nv_hashtag_normalization_audit: {
        Args: { p_days?: number }
        Returns: {
          consolidated_mentions: number
          display_tag: string
          normalized_tag: string
          variant_count: number
          variants: string[]
        }[]
      }
      nv_is_political_text: {
        Args: { _candidate_name?: string; _text: string }
        Returns: boolean
      }
      nv_is_valid_hashtag: { Args: { _tag: string }; Returns: boolean }
      nv_network_key: { Args: { _network: string }; Returns: string }
      nv_non_political_regex: { Args: never; Returns: string }
      nv_normalize_hashtag: { Args: { _tag: string }; Returns: string }
      nv_political_relevance_score: {
        Args: { _candidate_name?: string; _text: string }
        Returns: number
      }
      nv_subject_dedup_audit: {
        Args: { p_days?: number }
        Returns: {
          dedup_count: number
          inflation_pct: number
          raw_count: number
          theme: string
        }[]
      }
      nv_visible_networks: { Args: never; Returns: string[] }
      overview_summary: { Args: { p_days?: number }; Returns: Json }
      prune_edge_function_logs: { Args: never; Returns: undefined }
      reactivate_youtube_keys: { Args: never; Returns: undefined }
      record_collector_call: {
        Args: { _had_error?: boolean; _items?: number; _name: string }
        Returns: undefined
      }
      record_pipeline_stage: {
        Args: {
          _candidate_id: string
          _collected: number
          _collector: string
          _deduped: number
          _discard_reasons?: Json
          _error_message?: string
          _execution_ms: number
          _filtered: number
          _had_error?: boolean
          _inserted: number
          _parsed: number
          _source_breakdown?: Json
        }
        Returns: string
      }
      record_provider_call: {
        Args: { _latency_ms?: number; _provider: string; _success: boolean }
        Returns: undefined
      }
      record_usage_event: {
        Args: {
          _cost_units?: number
          _event_type: string
          _metadata?: Json
          _quantity?: number
          _resource?: string
          _user_id: string
        }
        Returns: number
      }
      record_worker_heartbeat: {
        Args: {
          _current_job_id?: string
          _failed_delta?: number
          _processed_delta?: number
          _worker_id: string
          _worker_type: string
        }
        Returns: undefined
      }
      recover_stuck_jobs: { Args: never; Returns: number }
      refresh_network_profiles_deduplicated: { Args: never; Returns: undefined }
      refresh_network_view_daily_metrics: {
        Args: { p_since?: string }
        Returns: Json
      }
      refresh_network_view_daily_metrics_range: {
        Args: { p_since: string; p_until: string }
        Returns: Json
      }
      refresh_pipeline_metrics_hourly: { Args: never; Returns: undefined }
      refresh_social_metrics_daily: {
        Args: { p_since?: string; p_until?: string }
        Returns: Json
      }
      reprocess_social_interactions_political_validation: {
        Args: { _batch_size?: number }
        Returns: Json
      }
      requeue_dead_jobs: {
        Args: { _job_type?: string; _limit?: number }
        Returns: number
      }
      reset_provider_circuits: { Args: never; Returns: undefined }
      run_network_view_consistency_audit: {
        Args: { p_days?: number }
        Returns: Json
      }
      should_skip_collector: { Args: { _name: string }; Returns: boolean }
      social_interaction_political_score: {
        Args: {
          _author?: string
          _candidate_id: string
          _network?: string
          _text: string
        }
        Returns: Json
      }
      unaccent: { Args: { "": string }; Returns: string }
      verify_api_key: {
        Args: { _required_scope: string; _token: string }
        Returns: {
          key_id: string
          rate_limit_per_minute: number
          user_id: string
        }[]
      }
      verify_worker_token: {
        Args: { _required_scope?: string; _token: string }
        Returns: {
          name: string
          scopes: string[]
          token_id: string
        }[]
      }
      youtube_key_stats: {
        Args: never
        Returns: {
          hours_since_exceeded: number
          id: string
          is_active: boolean
          label: string
          last_quota_exceeded_at: string
          last_used_at: string
          next_reset_at: string
          quota_exceeded_count: number
        }[]
      }
    }
    Enums: {
      app_role: "admin" | "analyst" | "subscriber"
      subscription_tier: "basic" | "pro" | "enterprise"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "analyst", "subscriber"],
      subscription_tier: ["basic", "pro", "enterprise"],
    },
  },
} as const
