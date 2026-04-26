# Orchestrama MCP

Local Ollama bridge. Use for private, repetitive, or large-context work.

## Start

1. Call `declare_working_dirs` once with project dirs.
2. Use `get_bridge_limits` before large file context.
3. Use `ping_model` only when latency/model warmth matters.
4. Use MCP tools first. Wait for the MCP result before deciding. If MCP fails or lacks detail, call `feedback`, then use the real command as fallback.

## Pick Tools

- `query_local_model`: direct model prompt. Add `context_files` for known files/dirs.
- `get_content`: read files/dirs, then answer from them.
- `rg_search`: find code/context by `pattern`; add `globs`, `context_lines`, `max_output_chars`.
- `gh_command`: GitHub CLI; pass `args` after `gh`.
- `*_command`: run a known executable with `prompt` + `command` args.
- `run_command`: fallback shell command only when no specific tool fits.
- `feedback`: report MCP failure/inefficiency and get a rule to improve next use.
- `list_patterns` / `register_pattern`: inspect or add reusable intents.

Command tools include: `git`, `npm`, `npx`, `node`, `pnpm`, `yarn`, `tsc`, `eslint`, `prettier`, `vitest`, `jest`, `playwright`, `python`, `pip`, `pytest`, `uv`, `poetry`, `docker`, `docker_compose`, `curl`, `jq`, `fd`, `ls`, `dir`, `powershell`, `task`, `make`, `just`, `cargo`, `go`, `dotnet`, `mvn`, `gradle`, `kubectl`, `ollama`.

## Efficiency Rules

- For validation/status commands, set `interpret: false`: builds, tests, `git status`, `git diff --check`.
- Limit output: use `--stat`, `--oneline`, `-l`, `--max-count`, `tail`, or `max_output_chars`.
- For verbose tests/builds: redirect to a log, return only exit code + tail.
- Prefer specific tools over `run_command`; they use less prompt and safer defaults.
- If a tool fails from quoting, path, or token budget, call `feedback` with `issue`, `tool`, `command`, `observed`, `expected`.
- Pass `intent` when it fits: `code_review`, `find_bugs`, `find_ts_errors`, `generate_tests`, `log_analysis`, `summarize`, `explain_code`, `replace_text`.

## Access/Safety

- File and cwd access must be inside effective dirs: static + declared dirs.
- Declared dirs are session-scoped and idempotent.
- Avoid attaching huge dirs blindly; search first, then read targeted files.
