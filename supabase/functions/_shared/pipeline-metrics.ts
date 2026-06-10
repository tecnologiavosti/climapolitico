// Helper compartilhado de telemetria do pipeline de coleta (F1).
// Cada coletor deve criar um PipelineRecorder, incrementar contadores por etapa
// e chamar `flush()` no final para gravar uma linha em collector_pipeline_metrics.
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

export type DiscardReason =
  | "http_error" | "empty_response" | "parse_error"
  | "political_filter" | "semantic_mismatch" | "language_filter"
  | "duplicate_db" | "duplicate_local" | "invalid_payload" | "other";

export class PipelineRecorder {
  private startedAt = Date.now();
  private collected = 0;
  private parsed = 0;
  private filtered = 0;
  private deduped = 0;
  private inserted = 0;
  private discardReasons: Record<string, number> = {};
  private sourceBreakdown: Record<string, number> = {};
  private hadError = false;
  private errorMessage: string | null = null;

  constructor(
    private collectorName: string,
    private candidateId: string | null = null,
  ) {}

  addCollected(n = 1, source?: string) {
    this.collected += n;
    if (source) this.sourceBreakdown[source] = (this.sourceBreakdown[source] ?? 0) + n;
  }
  addParsed(n = 1) { this.parsed += n; }
  addFiltered(n = 1, reason: DiscardReason = "other") {
    this.filtered += n;
    this.discardReasons[reason] = (this.discardReasons[reason] ?? 0) + n;
  }
  addDeduped(n = 1, kind: "local" | "db" = "db") {
    this.deduped += n;
    const k = kind === "local" ? "duplicate_local" : "duplicate_db";
    this.discardReasons[k] = (this.discardReasons[k] ?? 0) + n;
  }
  addInserted(n = 1) { this.inserted += n; }
  setError(msg: string) { this.hadError = true; this.errorMessage = msg; }

  async flush(): Promise<void> {
    try {
      await admin().rpc("record_pipeline_stage", {
        _collector: this.collectorName,
        _candidate_id: this.candidateId,
        _collected: this.collected,
        _parsed: this.parsed,
        _filtered: this.filtered,
        _deduped: this.deduped,
        _inserted: this.inserted,
        _execution_ms: Date.now() - this.startedAt,
        _discard_reasons: this.discardReasons,
        _source_breakdown: this.sourceBreakdown,
        _had_error: this.hadError,
        _error_message: this.errorMessage,
      });
    } catch (e) {
      console.warn(`[pipeline-metrics] flush(${this.collectorName}) falhou:`, (e as Error).message);
    }
  }
}

export function newPipelineRecorder(collector: string, candidateId?: string | null) {
  return new PipelineRecorder(collector, candidateId ?? null);
}
