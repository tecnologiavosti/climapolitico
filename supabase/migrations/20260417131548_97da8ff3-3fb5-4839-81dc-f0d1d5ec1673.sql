DELETE FROM public.social_interactions
WHERE social_network = 'Twitter/X'
  AND (
    comment_author IS NULL
    OR comment_author = 'unknown'
    OR comment_text ILIKE '%xcancel%'
    OR comment_text ILIKE '%Open in X%'
    OR comment_text ILIKE '%RSS Feed%'
    OR comment_text ILIKE '%Preferences%'
    OR comment_text ILIKE '%abs.twimg.com%'
    OR comment_text ILIKE '%pbs.twimg.com/profile_images%'
    OR comment_text ~ '^\s*\[[^\]]+\]\(http'
    OR LENGTH(REGEXP_REPLACE(comment_text, '\[[^\]]*\]\([^)]*\)', '', 'g')) < 25
  );