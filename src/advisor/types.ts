/**
 * Shared type definitions for the Benchmark Advisor module.
 */

export interface HardwareInfo {
  gpuName: string;           // e.g. "NVIDIA RTX 4090" or "CPU-only"
  totalVramMb: number;       // sum of all GPU VRAM in MB; 0 if no GPU
  safetyMarginPct: number;   // default 10
  vramBudgetMb: number;      // totalVramMb * (1 - safetyMarginPct / 100)
  systemRamMb: number;       // total physical RAM in MB
  cpuOnly: boolean;          // true when no GPU detected
}

export type MemoryMode = "vram_only" | "ram_assisted";

export interface ModelVramEstimate {
  modelName: string;
  parametersBillions: number;
  quantizationBits: number;
  estimatedVramMb: number;
  memoryClass: "gpu_native" | "ram_assisted" | "excluded";
  exclusionReason?: string;
}

export type RecommendationCategory = "fastest" | "most_context" | "fa" | "best_overall" | "most_parameters";

export interface BenchmarkRunResult {
  modelName: string;
  contextWindow: number;
  throughputTokensPerSec: number;
  latencyMs: number;
  vramEstimateMb: number;
  flashAttentionEnabled: boolean;
  memoryMode: "gpu_native" | "ram_assisted";
  offloadingDetected?: boolean;
  /** Model size in billions of parameters (0 if unknown) */
  parametersBillions: number;
}

export interface Recommendation {
  category: RecommendationCategory;
  modelName: string;
  contextWindow: number;
  throughputTokensPerSec: number;
  latencyMs: number;
  vramEstimateMb: number;
  flashAttentionEnabled: boolean;
  memoryMode: "gpu_native" | "ram_assisted";
  score?: number;             // for best_overall
  ramAssistedNotice?: string;
  /** Model size in billions of parameters (0 if unknown) */
  parametersBillions: number;
}

export interface RecommendationReport {
  hardware: HardwareInfo;
  memoryMode: MemoryMode;
  recommendations: Record<RecommendationCategory, Recommendation>;
  exclusions: Array<{ modelName: string; reason: string }>;
  allResults: BenchmarkRunResult[];
  generatedAt: string;        // ISO 8601
}

export interface ContextWindowResult {
  modelName: string;
  maxSafeContextTokens: number | null;  // null if no size fits
  safeContextSizes: number[];
}

// Serialization interfaces

export interface SerializedRecommendation {
  category: string;
  modelName: string;
  contextWindow: number;
  throughputTokensPerSec: number;
  latencyMs: number;
  vramEstimateMb: number;
  flashAttentionEnabled: boolean;
  memoryMode: "gpu_native" | "ram_assisted";
  score?: number;
  ramAssistedNotice?: string;
  parametersBillions: number;
}

export interface SerializedRecommendationReport {
  version: "1";
  generatedAt: string;
  hardware: {
    gpuName: string;
    totalVramMb: number;
    safetyMarginPct: number;
    vramBudgetMb: number;
    systemRamMb: number;
    cpuOnly: boolean;
  };
  memoryMode: "vram_only" | "ram_assisted";
  recommendations: {
    fastest: SerializedRecommendation;
    most_context: SerializedRecommendation;
    fa: SerializedRecommendation;
    best_overall: SerializedRecommendation;
    most_parameters: SerializedRecommendation;
  };
  exclusions: Array<{ modelName: string; reason: string }>;
  allResults: Array<{
    modelName: string;
    contextWindow: number;
    throughputTokensPerSec: number;
    latencyMs: number;
    vramEstimateMb: number;
    flashAttentionEnabled: boolean;
    memoryMode: "gpu_native" | "ram_assisted";
    parametersBillions: number;
  }>;
}
