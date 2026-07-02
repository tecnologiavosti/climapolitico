import type { LucideIcon } from "lucide-react";

/**
 * MetricIcon — ícone circular padrão dos cards de métrica.
 * 40x40 fixo, posicionado absolutamente no canto superior direito do card.
 * O card pai precisa ter `position: relative`.
 */
export function MetricIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <div
      className="absolute flex items-center justify-center rounded-full shrink-0"
      style={{
        top: 12,
        right: 12,
        width: 40,
        height: 40,
        minWidth: 40,
        minHeight: 40,
        maxWidth: 40,
        maxHeight: 40,
        aspectRatio: "1 / 1",
        flexShrink: 0,
        background: "linear-gradient(135deg, #0ea5e9, #2563eb)",
        boxShadow: "0 8px 24px rgba(37,99,235,0.25)",
      }}
    >
      <Icon style={{ width: 18, height: 18, flexShrink: 0 }} className="text-white" />
    </div>
  );
}
