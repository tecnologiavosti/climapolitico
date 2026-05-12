
-- Heuristic reclassification of default Neutros (score = 0.5) — single-pass set-based update
WITH scored AS (
  SELECT
    id,
    (
      (CASE WHEN comment_text ~* '(parab[eé]ns|melhor|[oó]tim[oa]|excelente|maravilh|perfeit|mito|her[oó]i|orgulho|apoio|votarei|voto\s+em|te\s+amo|amo\s+voc|presidente|for[cç]a|estamos\s+juntos|vai\s+ganhar|vencer|vit[oó]ria|sucesso|deus\s+aben|gigante|honesto|verdadeiro|trabalhador|competente|sensacional|incr[ií]vel|brilhante|admiro|respeito|salvou|melhorou|gosto|gostei|maravilhoso|fant[aá]stico|top|fenomenal)' THEN 1 ELSE 0 END)
      + (CASE WHEN comment_text ~ '(❤|👏|🙏|✊|🇧🇷|💚|💛|🥰|😍|🤩|👍|💪|🫡|❤️)' THEN 1 ELSE 0 END)
    ) AS pos,
    (
      (CASE WHEN comment_text ~* '(ladr[aã]o|corrupt|mentiros|vagabund|bandido|\bfora\b|jamais|nunca|safad|canalha|vergonha|nojo|p[eé]ssim|horr[ií]vel|[oó]dio|fracass|incompetente|idiota|burro|imbecil|lixo|merda|fdp|gado|petralha|bolsominion|destru|enganador|farsa|hip[oó]crita|trai[cç][aã]o|escroto|absurdo|cad[eé]ia|preso|impeachment|renuncia|criminoso|pilantra|in[uú]til|p[eé]ssimo|horror|decep[cç][aã]o|odiei|mentira)' THEN 1 ELSE 0 END)
      + (CASE WHEN comment_text ~ '(🤮|👎|😡|💩|🤡|🤬|🙄|😤|🖕)' THEN 1 ELSE 0 END)
    ) AS neg
  FROM public.social_interactions
  WHERE sentiment_label = 'Neutro'
    AND sentiment_score = 0.5
    AND comment_text IS NOT NULL
    AND length(trim(comment_text)) > 0
)
UPDATE public.social_interactions si
SET
  sentiment_label = CASE WHEN s.pos > s.neg THEN 'Positivo' ELSE 'Negativo' END,
  sentiment_score = CASE
    WHEN s.pos > s.neg THEN LEAST(0.95, 0.65 + 0.08 * (s.pos - s.neg))
    ELSE GREATEST(0.05, 0.35 - 0.08 * (s.neg - s.pos))
  END,
  sentiment_confidence = LEAST(0.9, 0.55 + 0.08 * ABS(s.pos - s.neg))
FROM scored s
WHERE si.id = s.id
  AND s.pos <> s.neg
  AND (s.pos + s.neg) >= 1;
