-- Add new JSONB columns to undecided_analyses table for advanced visualizations
ALTER TABLE public.undecided_analyses 
ADD COLUMN IF NOT EXISTS social_media_breakdown jsonb DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS temporal_evolution jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS candidates_comparison jsonb DEFAULT '[]'::jsonb;

-- Add comments for documentation
COMMENT ON COLUMN public.undecided_analyses.social_media_breakdown IS 'Detalhamento das redes sociais analisadas (posts, comentários, interações por rede)';
COMMENT ON COLUMN public.undecided_analyses.temporal_evolution IS 'Evolução temporal da indecisão ao longo do período analisado';
COMMENT ON COLUMN public.undecided_analyses.candidates_comparison IS 'Comparação de intenção positiva/negativa entre todos os candidatos do usuário';