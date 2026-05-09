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
      nitter_instances: {
        Row: {
          created_at: string
          health_score: number
          id: string
          is_active: boolean
          last_checked: string | null
          last_error_at: string | null
          last_error_message: string | null
          updated_at: string
          url: string
        }
        Insert: {
          created_at?: string
          health_score?: number
          id?: string
          is_active?: boolean
          last_checked?: string | null
          last_error_at?: string | null
          last_error_message?: string | null
          updated_at?: string
          url: string
        }
        Update: {
          created_at?: string
          health_score?: number
          id?: string
          is_active?: boolean
          last_checked?: string | null
          last_error_at?: string | null
          last_error_message?: string | null
          updated_at?: string
          url?: string
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
      profiles: {
        Row: {
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
      social_interactions: {
        Row: {
          analysis_attempts: number
          analysis_id: string | null
          author_profile_url: string | null
          candidate_id: string
          collected_at: string | null
          comment_author: string | null
          comment_text: string | null
          created_at: string | null
          id: string
          interaction_type: string
          likes_count: number | null
          original_posted_at: string | null
          region: string | null
          replies_count: number | null
          sentiment_confidence: number | null
          sentiment_label: string | null
          sentiment_score: number | null
          shares_count: number | null
          social_network: string
          user_id: string
        }
        Insert: {
          analysis_attempts?: number
          analysis_id?: string | null
          author_profile_url?: string | null
          candidate_id: string
          collected_at?: string | null
          comment_author?: string | null
          comment_text?: string | null
          created_at?: string | null
          id?: string
          interaction_type?: string
          likes_count?: number | null
          original_posted_at?: string | null
          region?: string | null
          replies_count?: number | null
          sentiment_confidence?: number | null
          sentiment_label?: string | null
          sentiment_score?: number | null
          shares_count?: number | null
          social_network: string
          user_id: string
        }
        Update: {
          analysis_attempts?: number
          analysis_id?: string | null
          author_profile_url?: string | null
          candidate_id?: string
          collected_at?: string | null
          comment_author?: string | null
          comment_text?: string | null
          created_at?: string | null
          id?: string
          interaction_type?: string
          likes_count?: number | null
          original_posted_at?: string | null
          region?: string | null
          replies_count?: number | null
          sentiment_confidence?: number | null
          sentiment_label?: string | null
          sentiment_score?: number | null
          shares_count?: number | null
          social_network?: string
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
      check_rate_limit: {
        Args: {
          _endpoint: string
          _identifier: string
          _max_per_minute?: number
        }
        Returns: boolean
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
      cleanup_analysis_cache: { Args: never; Returns: number }
      cleanup_old_notifications: { Args: never; Returns: number }
      cleanup_pipeline_data: { Args: never; Returns: undefined }
      cleanup_rate_limits: { Args: never; Returns: undefined }
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
      dlq_summary: {
        Args: never
        Returns: {
          dead_count: number
          job_type: string
          newest: string
          oldest: string
        }[]
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
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      prune_edge_function_logs: { Args: never; Returns: undefined }
      reactivate_youtube_keys: { Args: never; Returns: undefined }
      record_collector_call: {
        Args: { _had_error?: boolean; _items?: number; _name: string }
        Returns: undefined
      }
      record_provider_call: {
        Args: { _latency_ms?: number; _provider: string; _success: boolean }
        Returns: undefined
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
      refresh_pipeline_metrics_hourly: { Args: never; Returns: undefined }
      requeue_dead_jobs: {
        Args: { _job_type?: string; _limit?: number }
        Returns: number
      }
      reset_provider_circuits: { Args: never; Returns: undefined }
      should_skip_collector: { Args: { _name: string }; Returns: boolean }
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
