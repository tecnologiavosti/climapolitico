/**
 * cleanContent — sanitizador obrigatório aplicado ANTES de gravar
 * qualquer texto vindo de feeds externos (RSS, Google News, NewsAPI,
 * YouTube, TikTok, Facebook, Instagram, Telegram, Bluesky, LinkedIn,
 * Twitter/Nitter, Reddit, etc.).
 *
 * Etapas:
 *   1. Remove blocos perigosos inteiros (<script>, <style>, <iframe>, CDATA).
 *   2. Remove qualquer tag HTML/XML restante.
 *   3. Decodifica entidades HTML (&amp;, &quot;, &#39;, &nbsp;, &#x27;, numéricas...).
 *   4. Colapsa espaços/whitespace.
 *
 * Sempre retorna texto puro, pronto para o React renderizar com `{texto}`.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  laquo: "«",
  raquo: "»",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
  copy: "©",
  reg: "®",
  trade: "™",
  middot: "·",
  bull: "•",
};

function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (_m, raw: string) => {
    if (raw[0] === "#") {
      const isHex = raw[1] === "x" || raw[1] === "X";
      const code = parseInt(raw.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      if (Number.isFinite(code) && code > 0 && code < 0x110000) {
        try { return String.fromCodePoint(code); } catch { return ""; }
      }
      return "";
    }
    const key = raw.toLowerCase();
    return NAMED_ENTITIES[key] ?? "";
  });
}

export function cleanContent(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = String(value);

  // 1. blocos perigosos
  text = text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  text = text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ");
  text = text.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
  text = text.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, " ");
  text = text.replace(/<!--[\s\S]*?-->/g, " ");

  // 2. todas as tags restantes (<a>, <img>, <p>, <div>, <span>, <strong>, <em>, <font>, etc.)
  text = text.replace(/<\/?[a-zA-Z][^>]*>/g, " ");

  // 3. entidades
  text = decodeEntities(text);

  // 4. whitespace
  text = text.replace(/\s+/g, " ").trim();
  return text;
}

const HTML_DETECTOR = /<\/?[a-z][\s\S]*?>|&(?:#x?[0-9a-f]+|[a-z][a-z0-9]+);/i;
export function containsHtml(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  return HTML_DETECTOR.test(String(value));
}

const TEXT_FIELDS = [
  "title", "description", "summary", "snippet",
  "content", "body", "raw_content", "raw_html",
  "rss_content", "rss_description",
  "post_title", "post_description", "post_content",
  "comment_text",
] as const;

/**
 * Limpa in-place os campos de texto conhecidos de um objeto.
 * Útil para chamar logo antes do `.insert()` no Supabase.
 *
 * @param source identifica a origem (collector name) p/ log de validação.
 */
export function cleanContentFields<T extends Record<string, any>>(
  row: T,
  source?: string,
): T {
  for (const field of TEXT_FIELDS) {
    const v = row[field];
    if (typeof v === "string" && v.length > 0) {
      if (containsHtml(v)) {
        console.log(`[cleanContent] HTML removido origem=${source ?? "?"} campo=${field} len=${v.length}`);
      }
      (row as any)[field] = cleanContent(v);
    }
  }
  return row;
}
