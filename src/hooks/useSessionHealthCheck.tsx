import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";

const HEALTH_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes (was 2)

/**
 * Periodically validates the Supabase session on the server.
 * Refs prevent duplicate timers in StrictMode double-mount.
 */
export const useSessionHealthCheck = () => {
  const navigate = useNavigate();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const checkingRef = useRef(false);

  useEffect(() => {
    const checkSession = async () => {
      if (checkingRef.current) return;
      checkingRef.current = true;
      try {
        const { data: { user }, error } = await supabase.auth.getUser();
        if (error || !user) {
          const { error: refreshError } = await supabase.auth.refreshSession();
          if (refreshError) {
            await supabase.auth.signOut();
            navigate("/auth");
          }
        }
      } catch (e) {
        console.warn("[health-check] failed:", e);
      } finally {
        checkingRef.current = false;
      }
    };

    checkSession();
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(checkSession, HEALTH_CHECK_INTERVAL_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
  }, [navigate]);
};
