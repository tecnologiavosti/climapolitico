// Helpers globais de formatação seguros contra null/undefined/NaN.
// Use estes utilitários em vez de chamar `.toLocaleString()` diretamente
// em valores vindos de API, banco, feeds externos ou cálculos.

const toSafeNumber = (value: unknown): number => {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export function formatNumber(
  value: unknown,
  options?: Intl.NumberFormatOptions,
): string {
  return toSafeNumber(value).toLocaleString("pt-BR", options);
}

export function formatCurrency(value: unknown): string {
  return toSafeNumber(value).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export function formatPercent(value: unknown, digits = 1): string {
  return `${toSafeNumber(value).toFixed(digits)}%`;
}

export function formatCompact(value: unknown): string {
  return toSafeNumber(value).toLocaleString("pt-BR", {
    notation: "compact",
    maximumFractionDigits: 1,
  });
}
