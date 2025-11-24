export interface StateOpportunityData {
  state: string;
  stateCode: string;
  opportunityScore: number;
  undecidedPercentage: number;
  avgSentiment: number;
  totalMentions: number;
  totalInteractions: number;
  uniqueProfiles: number;
  recommendedActions: string[];
  dataQuality: "high" | "medium" | "low" | "none";
  undecidedIndex: number;
  sentimentIndex: number;
  engagementIndex: number;
}

export interface OpportunityMapData {
  states: StateOpportunityData[];
  topStates: StateOpportunityData[];
  lastUpdated: string;
}

export const calculateUndecidedIndex = (undecidedPercentage: number): number => {
  // Higher undecided percentage = higher opportunity
  // Normalize to 0-100 scale (assuming max 40% undecided is the ceiling)
  return Math.min((undecidedPercentage / 40) * 100, 100);
};

export const calculateSentimentIndex = (avgSentiment: number): number => {
  // Convert sentiment from -1 to 1 range into 0-100 scale
  // Positive sentiment = high opportunity
  // Neutral = medium opportunity
  // Negative = low opportunity
  return ((avgSentiment + 1) / 2) * 100;
};

export const calculateEngagementIndex = (
  interactions: number,
  maxInteractions: number
): number => {
  // Normalize engagement based on max interactions across all states
  if (maxInteractions === 0) return 0;
  return (interactions / maxInteractions) * 100;
};

export const calculateOpportunityScore = (
  undecidedIndex: number,
  sentimentIndex: number,
  engagementIndex: number
): number => {
  // Weighted formula: 40% undecided + 30% sentiment + 30% engagement
  const score = 
    undecidedIndex * 0.4 +
    sentimentIndex * 0.3 +
    engagementIndex * 0.3;
  
  return Math.round(score);
};

export const determineDataQuality = (
  mentions: number,
  profiles: number
): "high" | "medium" | "low" | "none" => {
  if (mentions === 0 && profiles === 0) return "none";
  if (mentions > 500 && profiles > 100) return "high";
  if (mentions > 100 && profiles > 20) return "medium";
  return "low";
};

export const getDataQualityLabel = (quality: "high" | "medium" | "low" | "none"): string => {
  const labels = {
    high: "🟢 Alta Confiança",
    medium: "🟡 Média Confiança",
    low: "🔴 Baixa Confiança",
    none: "⚪ Sem Dados"
  };
  return labels[quality];
};

export const getScoreLabel = (score: number): string => {
  if (score >= 80) return "Alto Potencial";
  if (score >= 60) return "Bom Potencial";
  if (score >= 40) return "Médio Potencial";
  if (score >= 20) return "Baixo Potencial";
  return "Muito Baixo";
};
