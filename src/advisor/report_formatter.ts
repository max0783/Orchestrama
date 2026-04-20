/**
 * ReportFormatter — pure formatting functions for the RecommendationReport.
 *
 * All functions are stateless and produce human-readable strings from
 * structured data. No I/O is performed here.
 */

import type {
  BenchmarkRunResult,
  HardwareInfo,
  MemoryMode,
  Recommendation,
  RecommendationCategory,
  RecommendationReport,
} from "./types.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Format a number with thousands separators (e.g. 131072 → "131,072").
 */
function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

/**
 * Pad a string to a given width (left-aligned).
 */
function padRight(s: string, width: number): string {
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

/**
 * Convert a MemoryMode value to a display label.
 */
function formatMemoryMode(mode: MemoryMode | "gpu_native" | "ram_assisted"): string {
  switch (mode) {
    case "vram_only":
      return "VRAM-only";
    case "ram_assisted":
      return "RAM-assisted";
    case "gpu_native":
      return "GPU-native";
    default:
      return String(mode);
  }
}

/**
 * Convert a RecommendationCategory to a display label.
 */
function formatCategory(category: RecommendationCategory): string {
  switch (category) {
    case "fastest":
      return "Fastest";
    case "most_context":
      return "Most Context";
    case "fa":
      return "FA";
    case "best_overall":
      return "Best Overall";
    case "most_parameters":
      return "Most Parameters";
    default:
      return String(category);
  }
}

/**
 * Format a parameter count in billions for display.
 * e.g. 7.5 → "7.5B", 0 → "?"
 */
function formatParams(paramB: number): string {
  if (!paramB || paramB === 0) return "?";
  return `${paramB % 1 === 0 ? paramB.toFixed(0) : paramB.toFixed(1)}B`;
}

// ---------------------------------------------------------------------------
// 6.1 formatHardwareSummary
// ---------------------------------------------------------------------------

/**
 * Format a hardware summary block.
 *
 * Example output:
 * ```
 * Hardware Summary
 * ================
 * GPU:           NVIDIA RTX 4090
 * Total VRAM:    24576 MB
 * Safety Margin: 10%
 * VRAM Budget:   22118 MB
 * System RAM:    65536 MB
 * Memory Mode:   VRAM-only
 * ```
 *
 * @param hardware - Hardware info from the detection phase.
 * @param mode     - Selected memory mode.
 * @returns Formatted hardware summary string.
 */
export function formatHardwareSummary(hardware: HardwareInfo, mode: MemoryMode): string {
  const lines: string[] = [
    "Hardware Summary",
    "================",
    `GPU:           ${hardware.gpuName}`,
    `Total VRAM:    ${formatNumber(hardware.totalVramMb)} MB`,
    `Safety Margin: ${hardware.safetyMarginPct}%`,
    `VRAM Budget:   ${formatNumber(hardware.vramBudgetMb)} MB`,
    `System RAM:    ${formatNumber(hardware.systemRamMb)} MB`,
    `Memory Mode:   ${formatMemoryMode(mode)}`,
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// 6.2 formatRecommendationTable
// ---------------------------------------------------------------------------

/**
 * Format a recommendation table with all 8 columns.
 *
 * The Best Overall row is prefixed with `★`.
 *
 * Columns: Category | Model | Context Window | Throughput | Latency | VRAM | FA | Memory Mode
 *
 * @param recommendations - Record of all four recommendation categories.
 * @returns Formatted table string.
 */
export function formatRecommendationTable(
  recommendations: Record<RecommendationCategory, Recommendation>
): string {
  // Define the display order
  const order: RecommendationCategory[] = ["fastest", "most_context", "fa", "best_overall", "most_parameters"];

  // Build rows: [category, model, params, context, throughput, latency, vram, fa, memMode]
  type Row = [string, string, string, string, string, string, string, string, string];

  const dataRows: Row[] = order.map((cat) => {
    const rec = recommendations[cat];
    const categoryLabel =
      cat === "best_overall"
        ? `★ ${formatCategory(cat)}`
        : formatCategory(cat);

    return [
      categoryLabel,
      rec.modelName,
      formatParams(rec.parametersBillions),
      formatNumber(rec.contextWindow),
      `${rec.throughputTokensPerSec.toFixed(1)} tok/s`,
      `${Math.round(rec.latencyMs)} ms`,
      `${formatNumber(rec.vramEstimateMb)} MB`,
      rec.flashAttentionEnabled ? "Yes" : "No",
      formatMemoryMode(rec.memoryMode),
    ];
  });

  const headers: Row = [
    "Category",
    "Model",
    "Params",
    "Context Window",
    "Throughput",
    "Latency",
    "VRAM",
    "FA",
    "Memory Mode",
  ];

  // Compute column widths
  const allRows: Row[] = [headers, ...dataRows];
  const colWidths = headers.map((_, colIdx) =>
    Math.max(...allRows.map((row) => row[colIdx].length))
  );

  // Build header row
  const headerRow = headers.map((h, i) => padRight(h, colWidths[i]!)).join(" | ");

  // Build separator row
  const separatorRow = colWidths.map((w) => "-".repeat(w)).join("-|-");

  // Build data rows
  const formattedDataRows = dataRows.map((row) =>
    row.map((cell, i) => padRight(cell, colWidths[i]!)).join(" | ")
  );

  const lines: string[] = [
    "Recommendations",
    "===============",
    headerRow,
    separatorRow,
    ...formattedDataRows,
  ];

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// 6.3 formatExclusionSummary
// ---------------------------------------------------------------------------

/**
 * Format a summary of excluded models.
 *
 * Example output:
 * ```
 * Excluded Models
 * ===============
 * - llama3:70b: Requires 37376 MB VRAM; exceeds VRAM budget of 22118 MB
 * ```
 *
 * If no exclusions, shows "(none)".
 *
 * @param exclusions - Array of excluded model names and reasons.
 * @returns Formatted exclusion summary string.
 */
export function formatExclusionSummary(
  exclusions: Array<{ modelName: string; reason: string }>
): string {
  const lines: string[] = ["Excluded Models", "==============="];

  if (exclusions.length === 0) {
    lines.push("(none)");
  } else {
    for (const { modelName, reason } of exclusions) {
      lines.push(`- ${modelName}: ${reason}`);
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// 6.4 formatRamAssistedSection
// ---------------------------------------------------------------------------

/**
 * Format a dedicated section for RAM-assisted model results.
 *
 * Returns an empty string if there are no RAM-assisted results.
 *
 * Example output:
 * ```
 * RAM-Assisted Models (CPU Offload)
 * ==================================
 * Note: These models exceed the VRAM budget and run with CPU offloading.
 * Throughput is not directly comparable to GPU-native models.
 *
 * - llama3:13b  Context: 8,192  Throughput: 12.3 tok/s  Latency: 810 ms  VRAM: 7168 MB
 * ```
 *
 * @param results - All benchmark run results (only RAM-assisted ones are shown).
 * @returns Formatted RAM-assisted section string, or empty string if none.
 */
export function formatRamAssistedSection(results: BenchmarkRunResult[]): string {
  const ramResults = results.filter((r) => r.memoryMode === "ram_assisted");

  if (ramResults.length === 0) {
    return "";
  }

  const lines: string[] = [
    "RAM-Assisted Models (CPU Offload)",
    "==================================",
    "Note: These models exceed the VRAM budget and run with CPU offloading.",
    "Throughput is not directly comparable to GPU-native models.",
    "",
  ];

  for (const r of ramResults) {
    lines.push(
      `- ${r.modelName}  Context: ${formatNumber(r.contextWindow)}  ` +
        `Throughput: ${r.throughputTokensPerSec.toFixed(1)} tok/s  ` +
        `Latency: ${Math.round(r.latencyMs)} ms  ` +
        `VRAM: ${formatNumber(r.vramEstimateMb)} MB`
    );
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// 6.5 formatRecommendationReport
// ---------------------------------------------------------------------------

/**
 * Compose all sections into the full recommendation report string.
 *
 * Sections (separated by blank lines):
 *   1. Title + timestamp
 *   2. Hardware summary
 *   3. Recommendation table
 *   4. Exclusion summary
 *   5. RAM-assisted section (omitted if empty)
 *
 * @param report - The complete RecommendationReport.
 * @returns Full formatted report string.
 */
export function formatRecommendationReport(report: RecommendationReport): string {
  const title = [
    "Benchmark Advisor Report",
    "========================",
    `Generated: ${report.generatedAt}`,
  ].join("\n");

  const hardware = formatHardwareSummary(report.hardware, report.memoryMode);
  const table = formatRecommendationTable(report.recommendations);
  const exclusions = formatExclusionSummary(report.exclusions);
  const ramAssisted = formatRamAssistedSection(report.allResults);

  const sections = [title, hardware, table, exclusions];

  if (ramAssisted.length > 0) {
    sections.push(ramAssisted);
  }

  return sections.join("\n\n");
}
