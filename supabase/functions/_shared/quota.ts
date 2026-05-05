// Shared quota / advisory-lock helpers for collector edge functions.
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

let cachedAdmin: SupabaseClient | null = null;
function admin(): SupabaseClient {
  if (cachedAdmin) return cachedAdmin;
  cachedAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  return cachedAdmin;
}

/** Checks if the collector should be skipped (paused / quota exhausted). */
export async function shouldSkipCollector(name: string): Promise<boolean> {
  const { data, error } = await admin().rpc("should_skip_collector", { _name: name });
  if (error) {
    console.warn(`[quota] should_skip_collector(${name}) failed:`, error.message);
    return false;
  }
  return data === true;
}

/** Records a collector call with item count + error flag. */
export async function recordCollectorCall(
  name: string,
  items: number = 0,
  hadError: boolean = false,
): Promise<void> {
  const { error } = await admin().rpc("record_collector_call", {
    _name: name,
    _items: items,
    _had_error: hadError,
  });
  if (error) console.warn(`[quota] record_collector_call(${name}) failed:`, error.message);
}

/** Logs an edge function execution to edge_function_logs. */
export async function logExecution(opts: {
  functionName: string;
  status: "success" | "error" | "partial";
  errorMessage?: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await admin().from("edge_function_logs").insert({
      function_name: opts.functionName,
      status: opts.status,
      error_message: opts.errorMessage ?? null,
      duration_ms: opts.durationMs ?? null,
      metadata: opts.metadata ?? {},
    });
  } catch (e) {
    console.warn(`[quota] logExecution failed:`, (e as Error).message);
  }
}
