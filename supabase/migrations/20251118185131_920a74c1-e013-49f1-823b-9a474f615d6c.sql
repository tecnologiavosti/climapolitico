-- Adicionar índices compostos para otimizar consultas por região
CREATE INDEX IF NOT EXISTS idx_candidate_analyses_candidate_region 
ON candidate_analyses(candidate_id, geographic_scope);

-- Índice para fontes por região
CREATE INDEX IF NOT EXISTS idx_analysis_sources_region 
ON analysis_sources(inferred_region, profile_location_state);

-- Adicionar comentários para documentação
COMMENT ON COLUMN candidate_analyses.geographic_scope IS 'Escopo geográfico da análise: nacional ou regional_[estado]. Deve corresponder à região do candidato.';
COMMENT ON COLUMN analysis_sources.inferred_region IS 'Região inferida da fonte de dados. Deve corresponder à região do candidato para análises regionais.';
COMMENT ON COLUMN candidates.region IS 'Região eleitoral do candidato (ex: DF, SÃO PAULO, BRASIL). Define o escopo geográfico das análises.';