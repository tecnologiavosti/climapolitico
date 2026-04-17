import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type CollectionFrequency = "hourly" | "every_6_hours" | "every_12_hours" | "daily";

type GlobalCollectionConfig = {
  frequency?: CollectionFrequency;
  lastCollectionAt?: string | null;
  nextCollectionAt?: string | null;
  totalCommentsCollected?: number;
  networks?: string[];
  source?: string;
};

const CHECK_INTERVAL_MS = 60_000;
const AUTO_TWITTER_MAX_TWEETS = 200;
const AUTO_TWITTER_MAX_PAGES = 4;

const FREQUENCY_MS: Record<CollectionFrequency, number> = {
  hourly: 60 * 60 * 1000,
  every_6_hours: 6 * 60 * 60 * 1000,
  every_12_hours: 12 * 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
};

const isFrequency = (value: string): value is CollectionFrequency => value in FREQUENCY_MS;

const getNextCollectionAt = (frequency: CollectionFrequency) =>
  new Date(Date.now() + FREQUENCY_MS[frequency]).toISOString();

export function useAutomaticCollection() {
  const queryClient = useQueryClient();
  const isRunningRef = useRef(false);
  const lastTriggeredAtRef = useRef<string>("");

  useEffect(() => {
    let disposed = false;

    const checkAndCollect = async () => {
      if (disposed || isRunningRef.current) return;

      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data: configs, error: configError } = await supabase
          .from("collection_configs")
          .select("id, status, config, candidate_id, updated_at")
          .eq("user_id", user.id)
          .is("candidate_id", null)
          .order("updated_at", { ascending: false })
          .limit(5);

        if (configError) throw configError;

        const configRow = configs?.find((row) => {
          const config = (row.config ?? {}) as GlobalCollectionConfig;
          return config.source === "global_social_collection" || Array.isArray(config.networks);
        });

        if (!configRow || configRow.status !== "active") return;

        const config = (configRow.config ?? {}) as GlobalCollectionConfig;
        const frequency = isFrequency(String(config.frequency ?? "")) ? String(config.frequency) as CollectionFrequency : "daily";
        const lastCollectionAt = config.lastCollectionAt ? new Date(config.lastCollectionAt) : null;

        if (lastCollectionAt && Date.now() - lastCollectionAt.getTime() < FREQUENCY_MS[frequency]) {
          return;
        }

        const lastTriggerKey = `${configRow.id}:${config.lastCollectionAt ?? "never"}:${frequency}`;
        if (lastTriggeredAtRef.current === lastTriggerKey) return;

        lastTriggeredAtRef.current = lastTriggerKey;
        isRunningRef.current = true;

        const nowIso = new Date().toISOString();
        const nextCollectionAt = getNextCollectionAt(frequency);

        await supabase
          .from("collection_configs")
          .update({
            config: {
              ...config,
              frequency,
              networks: ["twitter"],
              source: "global_social_collection",
              lastCollectionAt: nowIso,
              nextCollectionAt,
            },
            updated_at: nowIso,
          })
          .eq("id", configRow.id);

        const { data: candidates, error: candidatesError } = await supabase
          .from("candidates")
          .select("id, full_name")
          .eq("user_id", user.id);

        if (candidatesError) throw candidatesError;
        if (!candidates?.length) return;

        const results = await Promise.allSettled(
          candidates.map((candidate) =>
            supabase.functions.invoke("search-twitter-mentions", {
              body: {
                candidateId: candidate.id,
                candidateName: candidate.full_name,
                maxTweets: AUTO_TWITTER_MAX_TWEETS,
                maxPages: AUTO_TWITTER_MAX_PAGES,
              },
            })
          )
        );

        const inserted = results.reduce((sum, result) => {
          if (result.status !== "fulfilled") return sum;
          return sum + Number(result.value.data?.inserted ?? 0);
        }, 0);

        await supabase
          .from("collection_configs")
          .update({
            config: {
              ...config,
              frequency,
              networks: ["twitter"],
              source: "global_social_collection",
              lastCollectionAt: nowIso,
              nextCollectionAt,
              totalCommentsCollected: Number(config.totalCommentsCollected ?? 0) + inserted,
            },
            updated_at: new Date().toISOString(),
          })
          .eq("id", configRow.id);

        queryClient.invalidateQueries({ queryKey: ["candidates"] });
        queryClient.invalidateQueries({ queryKey: ["candidate-consolidated-metrics"] });
        queryClient.invalidateQueries({ queryKey: ["social-interactions-overview"] });

        if (inserted > 0) {
          toast.success(`Coleta automática do Twitter concluída: ${inserted} novos tweets.`);
        }
      } catch (error) {
        console.error("[AUTO_TWITTER_COLLECTION]", error);
      } finally {
        isRunningRef.current = false;
      }
    };

    checkAndCollect();
    const intervalId = window.setInterval(checkAndCollect, CHECK_INTERVAL_MS);

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
    };
  }, [queryClient]);
}
