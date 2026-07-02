import type { LucideIcon } from "lucide-react";

/**
 * MetricIcon — ícone circular padrão dos cards de métrica.
 * Tamanho fixo (44x44) com aspect-ratio 1/1 e flex-shrink 0
 * para nunca deformar em telas pequenas.
 */
export function MetricIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <div
      className="flex items-center justify-center rounded-full shrink-0"
      style={{
        width: 44,
        height: 44,
        minWidth: 44,
        minHeight: 44,
        maxWidth: 44,
        maxHeight: 44,
        aspectRatio: "1 / 1",
        flexShrink: 0,
        background: "linear-gradient(135deg, #0ea5e9, #2563eb)",
        boxShadow: "0 10px 30px rgba(37,99,235,0.25)",
      }}
    >
      <Icon style={{ width: 20, height: 20, flexShrink: 0 }} className="text-white" />
    </div>
  );
}
