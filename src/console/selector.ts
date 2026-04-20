/**
 * Interactive arrow-key selector for the ollama-mcp-bridge console.
 *
 * Provides `selectOne` and `selectMany` functions that render an inline
 * terminal list driven by arrow keys (↑/↓), Space (multi-select toggle),
 * Enter (confirm), and Escape (cancel).
 *
 * Uses ANSI escape codes and raw stdin mode; no external dependencies.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11
 */

import readline from "readline";

// ---------------------------------------------------------------------------
// Task 3.1 — Exported types
// ---------------------------------------------------------------------------

/**
 * A single item in a selector list.
 * `checked` is used by `selectMany`; ignored by `selectOne`.
 */
export interface SelectItem<T> {
  label: string;
  value: T;
  checked?: boolean;
}

/**
 * Options shared by both `selectOne` and `selectMany`.
 */
export interface SelectorOptions<T> {
  title?: string;
  defaultValue?: T;
}

/**
 * Thrown by `selectOne` / `selectMany` when the user presses Escape and no
 * `defaultValue` was provided.
 */
export class SelectorCancelledError extends Error {
  constructor(message = "Selection cancelled") {
    super(message);
    this.name = "SelectorCancelledError";
    // Restore prototype chain for `instanceof` checks across compilation targets
    Object.setPrototypeOf(this, SelectorCancelledError.prototype);
  }
}

// ---------------------------------------------------------------------------
// Module-level readline interface (set once at startup)
// ---------------------------------------------------------------------------

let activeRl: readline.Interface | null = null;

/**
 * Register the active readline interface so the selector can pause/resume it
 * around raw-mode interactions. Call this once at startup before using
 * `selectOne` or `selectMany`.
 */
export function setReadlineInterface(rl: readline.Interface): void {
  activeRl = rl;
}

// ---------------------------------------------------------------------------
// Task 3.2 — renderList helper
// ---------------------------------------------------------------------------

/**
 * Tracks whether the list has been rendered at least once so that subsequent
 * renders know to clear the previous output first.
 *
 * This is a per-invocation flag managed by the caller (passed by reference via
 * a wrapper object so it can be mutated across calls).
 */
interface RenderState {
  firstRender: boolean;
}

/**
 * Render the selector list to stdout.
 *
 * On the first render no clearing is performed. On subsequent renders the
 * previous N lines are erased using ANSI sequences before reprinting.
 *
 * Single-select format:
 *   `> label`  (focused)
 *   `  label`  (unfocused)
 *
 * Multi-select format:
 *   `> [x] label`  (focused + checked)
 *   `> [ ] label`  (focused + unchecked)
 *   `  [x] label`  (unfocused + checked)
 *   `  [ ] label`  (unfocused + unchecked)
 *
 * Uses `process.stdout.write` exclusively — no `console.log`.
 */
function renderList<T>(
  items: SelectItem<T>[],
  focusIdx: number,
  multi: boolean,
  state: RenderState
): void {
  const n = items.length;

  // On re-renders: move cursor up N lines and clear each line
  if (!state.firstRender) {
    const clearLine = "\x1b[1A\x1b[2K";
    process.stdout.write(clearLine.repeat(n));
  }
  state.firstRender = false;

  // Print each item
  for (let i = 0; i < n; i++) {
    const item = items[i]!;
    const focused = i === focusIdx;
    const cursor = focused ? ">" : " ";

    let line: string;
    if (multi) {
      const box = item.checked ? "[x]" : "[ ]";
      line = `${cursor} ${box} ${item.label}`;
    } else {
      line = `${cursor} ${item.label}`;
    }

    // Write line followed by carriage-return + newline so the cursor stays at
    // the start of the next line (important for the clear-upward logic).
    process.stdout.write(line + "\r\n");
  }
}

// ---------------------------------------------------------------------------
// Task 3.3 — Raw-mode lifecycle helpers
// ---------------------------------------------------------------------------

/**
 * Enter raw mode: pause the readline interface, enable raw stdin, and resume
 * stdin so data events fire.
 */
function enterRawMode(): void {
  if (activeRl) {
    activeRl.pause();
  }
  process.stdin.setRawMode(true);
  process.stdin.resume();
}

/**
 * Exit raw mode: remove the given data listener, disable raw stdin, pause
 * stdin, then resume the readline interface.
 */
function exitRawMode(listener: (chunk: Buffer) => void): void {
  process.stdin.removeListener("data", listener);
  process.stdin.setRawMode(false);
  process.stdin.pause();
  if (activeRl) {
    activeRl.resume();
  }
}

// ---------------------------------------------------------------------------
// Task 3.4 — Keypress handling (shared core)
// ---------------------------------------------------------------------------

/**
 * Attach a raw-mode keypress listener and return a Promise that resolves or
 * rejects based on user input.
 *
 * @param items   The mutable item array (Space toggles `checked` in place).
 * @param multi   Whether Space-toggling is enabled.
 * @param opts    Selector options (for `defaultValue` on Escape).
 * @param state   Render state shared with `renderList`.
 * @param onEnter Called when Enter is pressed; receives the current focusIdx.
 * @param onEscape Called when Escape is pressed; receives the current focusIdx.
 */
function attachKeypressLoop<T>(
  items: SelectItem<T>[],
  multi: boolean,
  opts: SelectorOptions<T> | undefined,
  state: RenderState,
  onEnter: (focusIdx: number) => void,
  onEscape: () => void
): { promise: Promise<void>; cleanup: () => void } {
  let focusIdx = 0;
  const n = items.length;

  let resolve!: () => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  const listener = (chunk: Buffer): void => {
    const key = chunk.toString();

    if (key === "\x1b[A") {
      // ↑ arrow
      focusIdx = (focusIdx - 1 + n) % n;
      renderList(items, focusIdx, multi, state);
    } else if (key === "\x1b[B") {
      // ↓ arrow
      focusIdx = (focusIdx + 1) % n;
      renderList(items, focusIdx, multi, state);
    } else if (key === "\r" || key === "\n") {
      // Enter — confirm
      exitRawMode(listener);
      onEnter(focusIdx);
      resolve();
    } else if (key === "\x1b") {
      // Escape — cancel
      exitRawMode(listener);
      onEscape();
      resolve();
    } else if (multi && key === "\x20") {
      // Space — toggle checked (selectMany only)
      const item = items[focusIdx];
      if (item) {
        item.checked = !item.checked;
      }
      renderList(items, focusIdx, multi, state);
    }
  };

  process.stdin.on("data", listener);

  const cleanup = (): void => {
    exitRawMode(listener);
    reject(new SelectorCancelledError());
  };

  return { promise, cleanup };
}

// ---------------------------------------------------------------------------
// Task 3.7 — Non-TTY fallback helpers
// ---------------------------------------------------------------------------

/**
 * Fallback for non-TTY environments: display a numbered list and read a
 * response via `readline.question`.
 */
async function fallbackSelectOne<T>(
  items: SelectItem<T>[],
  opts?: SelectorOptions<T>
): Promise<T> {
  // Display numbered list
  process.stdout.write("\n");
  items.forEach((item, i) => {
    process.stdout.write(`  ${i + 1}. ${item.label}\r\n`);
  });

  return new Promise<T>((resolve, reject) => {
    const rl = activeRl;
    if (!rl) {
      // No readline interface — resolve with defaultValue or reject
      if (opts && "defaultValue" in opts && opts.defaultValue !== undefined) {
        resolve(opts.defaultValue);
      } else {
        reject(new SelectorCancelledError("No readline interface available for fallback"));
      }
      return;
    }

    rl.question("Enter number: ", (answer) => {
      const idx = parseInt(answer.trim(), 10) - 1;
      if (idx >= 0 && idx < items.length) {
        resolve(items[idx]!.value);
      } else if (opts && "defaultValue" in opts && opts.defaultValue !== undefined) {
        resolve(opts.defaultValue);
      } else {
        reject(new SelectorCancelledError("Invalid selection"));
      }
    });
  });
}

/**
 * Fallback for non-TTY environments: display a numbered list and read
 * comma-separated numbers via `readline.question`.
 */
async function fallbackSelectMany<T>(
  items: SelectItem<T>[],
  _opts?: SelectorOptions<T>
): Promise<T[]> {
  // Display numbered list
  process.stdout.write("\n");
  items.forEach((item, i) => {
    process.stdout.write(`  ${i + 1}. ${item.label}\r\n`);
  });

  return new Promise<T[]>((resolve) => {
    const rl = activeRl;
    if (!rl) {
      resolve([]);
      return;
    }

    rl.question("Enter numbers (comma-separated): ", (answer) => {
      const trimmed = answer.trim();
      if (!trimmed) {
        resolve([]);
        return;
      }
      const selected = trimmed
        .split(",")
        .map((s) => parseInt(s.trim(), 10) - 1)
        .filter((idx) => idx >= 0 && idx < items.length)
        .map((idx) => items[idx]!.value);
      resolve(selected);
    });
  });
}

// ---------------------------------------------------------------------------
// Task 3.5 — selectOne<T>
// ---------------------------------------------------------------------------

/**
 * Present a single-select list and return the value of the chosen item.
 *
 * - If `items` is empty: resolves immediately with `opts?.defaultValue`.
 * - Prints `opts.title` if provided.
 * - Uses raw stdin mode; pauses/resumes the active readline interface.
 * - On Enter: resolves with `items[focusIdx].value`.
 * - On Escape with `defaultValue`: resolves with `defaultValue`.
 * - On Escape without `defaultValue`: rejects with `SelectorCancelledError`.
 *
 * Requirements: 3.1, 3.11
 */
export async function selectOne<T>(
  items: SelectItem<T>[],
  opts?: SelectorOptions<T>
): Promise<T> {
  // Empty list — resolve immediately
  if (items.length === 0) {
    if (opts && "defaultValue" in opts && opts.defaultValue !== undefined) {
      return opts.defaultValue;
    }
    return undefined as unknown as T;
  }

  // Print title if provided
  if (opts?.title) {
    process.stdout.write(opts.title + "\r\n");
  }

  // Attempt to enter raw mode; fall back to readline.question on error
  try {
    enterRawMode();
  } catch {
    // Non-TTY fallback (Task 3.7)
    return fallbackSelectOne(items, opts);
  }

  const state: RenderState = { firstRender: true };
  renderList(items, 0, false, state);

  return new Promise<T>((resolve, reject) => {
    let result: T | undefined;
    let cancelled = false;

    const { promise } = attachKeypressLoop(
      items,
      false,
      opts,
      state,
      (focusIdx) => {
        result = items[focusIdx]!.value;
      },
      () => {
        if (opts && "defaultValue" in opts && opts.defaultValue !== undefined) {
          result = opts.defaultValue;
        } else {
          cancelled = true;
        }
      }
    );

    promise.then(() => {
      if (cancelled) {
        reject(new SelectorCancelledError());
      } else {
        resolve(result as T);
      }
    }).catch(reject);
  });
}

// ---------------------------------------------------------------------------
// Task 3.6 — selectMany<T>
// ---------------------------------------------------------------------------

/**
 * Present a multi-select list and return the values of all checked items.
 *
 * - If `items` is empty: resolves immediately with `[]`.
 * - Prints `opts.title` if provided.
 * - Uses raw stdin mode; pauses/resumes the active readline interface.
 * - Space toggles `checked` on the focused item.
 * - On Enter: resolves with `items.filter(i => i.checked).map(i => i.value)`.
 * - On Escape with `defaultValue`: resolves with `defaultValue` (as T[]).
 * - On Escape without `defaultValue`: rejects with `SelectorCancelledError`.
 *
 * Requirements: 3.2, 3.8, 3.11
 */
export async function selectMany<T>(
  items: SelectItem<T>[],
  opts?: SelectorOptions<T>
): Promise<T[]> {
  // Empty list — resolve immediately
  if (items.length === 0) {
    return [];
  }

  // Print title if provided
  if (opts?.title) {
    process.stdout.write(opts.title + "\r\n");
  }

  // Attempt to enter raw mode; fall back to readline.question on error
  try {
    enterRawMode();
  } catch {
    // Non-TTY fallback (Task 3.7)
    return fallbackSelectMany(items, opts);
  }

  const state: RenderState = { firstRender: true };
  renderList(items, 0, true, state);

  return new Promise<T[]>((resolve, reject) => {
    let result: T[] | undefined;
    let cancelled = false;

    const { promise } = attachKeypressLoop(
      items,
      true,
      opts,
      state,
      (_focusIdx) => {
        result = items.filter((i) => i.checked).map((i) => i.value);
      },
      () => {
        if (opts && "defaultValue" in opts && opts.defaultValue !== undefined) {
          // defaultValue for selectMany is typed as T, but callers may pass T[]
          // We cast to T[] here; the type system allows this via the generic.
          result = opts.defaultValue as unknown as T[];
        } else {
          cancelled = true;
        }
      }
    );

    promise.then(() => {
      if (cancelled) {
        reject(new SelectorCancelledError());
      } else {
        resolve(result ?? []);
      }
    }).catch(reject);
  });
}
