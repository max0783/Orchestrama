/**
 * Menu rendering and selection parsing for the Human Console.
 *
 * Pure module — no I/O, no side effects — making it independently testable.
 *
 * Requirements: 2.2, 2.3
 */

// ---------------------------------------------------------------------------
// MenuAction union type
// ---------------------------------------------------------------------------

export type MenuAction =
  | "list_models"
  | "ping_model"
  | "set_default_model"
  | "run_benchmark"
  | "view_config"
  | "view_capability_map"
  | "view_reduction_stats"
  | "test_config"
  | "test_config_dry"
  | "edit_bridge_limits"
  | "edit_model_options"
  | "manage_dynamic_dirs"
  | "run_benchmark_advisor"
  | "exit";

// ---------------------------------------------------------------------------
// renderMenu
// ---------------------------------------------------------------------------

/**
 * Returns the full menu string with all 13 numbered entries.
 */
export function renderMenu(): string {
  return [
    "Orchestrama Console",
    "───────────────────",
    "1. List Models",
    "2. Ping Model",
    "3. Set Default Model",
    "4. Run Benchmark",
    "5. View Configuration",
    "6. View Capability Map",
    "7. View Reduction Stats",
    "8. Test Configuration",
    "9. Test Configuration (dry run)",
    "10. Edit Bridge Limits",
    "11. Edit Model Options",
    "12. Manage Dynamic Allowed Directories",
    "13. Run Benchmark Advisor",
    "0. Exit",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// parseSelection
// ---------------------------------------------------------------------------

const SELECTION_MAP: Record<string, MenuAction> = {
  "1": "list_models",
  "2": "ping_model",
  "3": "set_default_model",
  "4": "run_benchmark",
  "5": "view_config",
  "6": "view_capability_map",
  "7": "view_reduction_stats",
  "8": "test_config",
  "9": "test_config_dry",
  "10": "edit_bridge_limits",
  "11": "edit_model_options",
  "12": "manage_dynamic_dirs",
  "13": "run_benchmark_advisor",
  "0": "exit",
};

/**
 * Maps a user input string to a MenuAction.
 * Returns null for any input that is not a valid selection.
 */
export function parseSelection(input: string): MenuAction | null {
  return SELECTION_MAP[input] ?? null;
}
