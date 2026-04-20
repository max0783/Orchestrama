# Orchestrama — AI Instructions

Local Ollama inference bridge. Use for privacy-sensitive, repetitive, or large-payload tasks.

## Tools

| Tool | Use when |
|---|---|
| `declare_working_dirs` | Declare additional working directories at session start |
| `query_local_model` | Send a prompt to the local model |
| `ping_model` | Verify model is warm before a latency-sensitive query |
| `get_bridge_limits` | Check file/token limits before attaching context files |
| `run_command` | Run a shell command and have the model interpret output |
| `list_patterns` | List available intent patterns |
| `register_pattern` | Create a reusable pattern for a recurring task |

## `declare_working_dirs` parameters

- `paths` (required) — array of absolute directory paths to add to this session's allowed directories

**Security model**: When `BRIDGE_ALLOWED_DIRS` is set, dynamic directories are constrained to subdirectories of the static allowed directories. When `BRIDGE_ALLOWED_DIRS` is not set (defaulting to current working directory), any existing directory can be declared.

**Behavior**: Idempotent — calling multiple times merges paths without duplicates. Call once at session start before issuing `run_command` or `query_local_model` calls that reference project directories.

## `query_local_model` parameters

- `prompt` (required)
- `intent` — selects a pre-tuned system prompt; **use whenever it fits**
- `context_files` — file/dir paths; call `get_bridge_limits` first
- `model` — override default model; omit if capability map routing covers it
- `options` — `temperature`, `seed`, `top_p`, `num_predict`, etc.

## Intent patterns

| Intent | Keywords | Output |
|---|---|---|
| `code_review` | review, refactor, lint | Bullet findings only |
| `explain_code` | explain, what does, how does | ≤5 sentence explanation |
| `find_bugs` | bugs, defects, issues | Confirmed bugs with location |
| `find_ts_errors` | typescript, ts errors, type errors | TS errors and missing imports |
| `generate_tests` | generate tests, write tests | Test code only |
| `log_analysis` | log, logs, error log, trace | Anomalies and errors only |
| `replace_text` | replace, substitution | Modified text only |
| `summarize` | summarize, summary, tldr | 3–5 line dense summary |

## `run_command` examples

Common repo-inspection commands (always use flags to limit output):

- `rg "TODO" --type ts -l` — list TypeScript files containing TODO
- `git log --oneline --max-count=20 -- src/` — last 20 commits touching src/
- `git diff HEAD~1 --stat` — files changed in the last commit
- `git blame -L 10,20 src/config.ts` — line-by-line authorship for lines 10-20
- `gh pr list --limit 10` — recent pull requests
- `git show HEAD:src/config.ts` — file content at HEAD

Always pipe or flag commands to limit output (`--max-count`, `--oneline`, `-l`, `--stat`, `-L`) before the token budget is exceeded.

## Behaviours to know

- **Working directories** — call `declare_working_dirs` once at session start to register project directories before running commands or reading files in those locations.
- **Chunking** — large payloads are split and reduced automatically. Works best with `summarize`/`log_analysis`. Avoid prompts requiring global reasoning across the full input.
- **Capability map** — prompts are auto-routed to models by keyword. Only pass `model` to override.
- **`run_command`** — limit output with `grep`/`head`/`--oneline`; refused if output exceeds token budget.
- **File access** — restricted to allowed directories; out-of-scope paths are rejected.

## Options

`temperature: 0.0–0.2` + fixed `seed` for structured/extractive tasks. `temperature: 0.7–1.0` for generative tasks.

## Workflow

1. Session start → `declare_working_dirs` with project directories
2. Before large task → `get_bridge_limits`, then `ping_model` if latency matters
3. Structured task → use `intent`; run `list_patterns` if unsure which fits
4. Recurring task → `register_pattern` once, reuse by name
5. Shell output → use `run_command` rather than constructing the prompt manually
