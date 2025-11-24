// Types for the traceability and social media analysis system

export interface NetworkOrigin {
  network: string;
  totalProfiles: number;
  uniqueProfiles: number;
  percentageOfTotal: number;
}

export interface StateOrigin {
  state: string;
  stateCode: string;
  profiles: number;
  percentage: number;
}

export interface NetworkProfileCount {
  network: string;
  total: number;
  unique: number;
  percentageOfTotal: number;
}

export interface KeywordCount {
  keyword: string;
  count: number;
  percentage: number;
}

export interface NetworkEngagement {
  network: string;
  engagementRate: number;
  avgInteractionsPerPost: number;
}

export interface SentimentDistribution {
  positive: number;
  neutral: number;
  negative: number;
}

export interface NetworkSentiment {
  network: string;
  sentiment: SentimentDistribution;
}

export interface IdeologyDistribution {
  left: number;
  center: number;
  right: number;
}

export interface Theme {
  name: string;
  count: number;
  percentage: number;
}

export interface ThemeRelation {
  theme1: string;
  theme2: string;
  coOccurrenceCount: number;
}

export interface StateData {
  state: string;
  stateCode: string;
  mentions: number;
  profiles: number;
  dominantSentiment: string;
  sentimentScore: number;
}

export interface RegionData {
  region: string;
  mentions: number;
  profiles: number;
  averageSentiment: number;
  states: string[];
}

export interface HeatmapPoint {
  state: string;
  value: number;
}

export interface TemporalData {
  date: string;
  mentions: number;
  sentiment: number;
}

export interface ComparisonData {
  network: string;
  value: number;
  category: string;
}

export interface DemographicData {
  ageGroup: string;
  percentage: number;
  network?: string;
}

export interface HeatmapData {
  hour: number;
  day: string;
  value: number;
}

export interface ReportMetadata {
  candidateName: string;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  dataQuality: 'high' | 'medium' | 'low';
}

export interface QuantitativeMetrics {
  profiles: {
    total: number;
    unique: number;
    byNetwork: NetworkProfileCount[];
  };
  content: {
    totalPosts: number;
    totalComments: number;
    mentions: number;
    topHashtags: KeywordCount[];
    postsPerDay: number;
  };
  interactions: {
    total: number;
    avgPerPost: number;
    engagementRateByNetwork: NetworkEngagement[];
  };
}

export interface QualitativeAnalysis {
  sentiment: {
    overall: SentimentDistribution;
    byNetwork: NetworkSentiment[];
  };
  ideology: {
    dominant: string;
    polarizationScore: number;
    distribution: IdeologyDistribution;
  };
  themes: {
    topKeywords: KeywordCount[];
    dominantThemes: Theme[];
    coOccurrence: ThemeRelation[];
  };
}

export interface GeographicData {
  byState: StateData[];
  byRegion: RegionData[];
  heatmapData: HeatmapPoint[];
}

export interface VisualizationData {
  temporal: TemporalData[];
  comparison: ComparisonData[];
  demographics: DemographicData[];
  peakHours: HeatmapData[];
}

export interface TraceabilityReportData {
  metadata: ReportMetadata;
  origin: {
    networks: NetworkOrigin[];
    states: StateOrigin[];
    collectionMethod: string;
  };
  quantitative: QuantitativeMetrics;
  qualitative: QualitativeAnalysis;
  geographic: GeographicData;
  visualizations: VisualizationData;
  summary: string[];
}

export interface CollectionConfig {
  periodStart: Date;
  periodEnd: Date;
  networks: string[];
  regions: string[];
  maxProfilesPerNetwork: number;
  verifiedOnly: boolean;
  frequency: 'once' | 'daily' | 'weekly';
}

export interface UniqueProfile {
  id: string;
  global_profile_id: string;
  profile_username: string;
  platforms: string[];
  total_appearances: number;
  first_seen_at: string;
  last_seen_at: string;
}
