# nuytek-harness-observatory

Claude Code plugin that records session, agent, tool-verdict and cost telemetry to local files under `~/.claude/observability/` and shows it in a live panel and a text report. It runs as hooks only: no model calls, no tool-call interception, no network, zero model tokens.

Read [Privacy](#privacy) before installing: prompts and Bash commands are stored unredacted.

## Install

From the marketplace:

```
/plugin install nuytek-harness-observatory --marketplace Andr3xDev/nuytek-harness-observatory
```

Answer `y` to add the marketplace, then pick a scope. With no option set, the plugin captures the generic data: tokens, cost, agent spawn and report, tool verdicts, skills, MCP usage, commands, compactions, reconciliation and git branch.

## Local development

Load the plugin from a checkout for one session:

```
claude --plugin-dir /path/to/nuytek-harness-observatory
```

The first interactive `--plugin-dir` load lays `.claude-plugin/types/` (gitignored). Type checking needs it:

```
tsc -p /path/to/nuytek-harness-observatory
claude plugin validate /path/to/nuytek-harness-observatory
claude plugin test /path/to/nuytek-harness-observatory
```

`.claude-plugin/types/` is not created by `-p`, `plugin validate` or `plugin test`.

Layout: `src/core` (schema, constants, formatting), `src/capture` (event capture), `src/store` (`write/` and `read/`), `src/report` (`/obs report` and its analysis), `src/panel` (band, tabs and `/obs`). `hooks/register.tsx` is the composition root; `capture` and `panel` each have a `register.ts`, and `report/run.ts` runs the report for the panel's `/obs`. Tests sit next to their sources.

## Commands

| Command | Effect |
|---------|--------|
| `/obs` | Opens or closes the observatory panel. |
| `/obs report` | Prints a text report of recorded sessions: agent types, models, issues and anomalies. |

The observatory lives in the band above the prompt; there is no side pane. Closed, it draws nothing. Open (`/obs`), it is a bordered box titled `◆ obs` with four tabs: Session, Agents, Tools and History. Click a tab, or focus the band (click it, or `ctrl+x` then the tab) and press `1` to `4`. Close it with `/obs`. Figures update as events arrive, and the open panel re-reads the store every few seconds.

The Agents tab starts with the main loop (`main · opus-4-7`, or the session agent's name when it runs with `--agent`), then one row per agent. Below that, one row per agent type, model and effort with spawns, tokens and estimated cost, for example `code-reviewer · sonnet-5-5 ◔ medium   3×   42k   $0.08`. A model that was not recorded shows as `?`. The effort is the one set for the agent (its definition's or the call's) and is left out when the agent takes the session's. Icons: `○ low`, `◔ medium`, `◑ high`, `◕ xhigh`, `● max`, and `◇ <n>` for a numeric budget. The main row shows no effort: the host does not expose the session's.

In the History scope the Agents tab shows the same grouped totals across the window's sessions, plus a "Recent runs" list of the last 20 agent runs (newest first) with start time (UTC), agent, model and effort, tokens and cost.

## Options

Set through `/config` or `pluginConfigs` in Claude Code settings.

| Option | Type | Default | Effect |
|--------|------|---------|--------|
| `retentionDays` | string `30`, `60`, `90` | `30` | Files older than this are deleted at session start. The current session's files are kept. Other values fall back to `30`. |
| `harnessProfile` | boolean | `false` | Adds harness-specific fields. The value is read once when the plugin loads. |
| `anomalyDelegationCostUsd` | number | `1` | Flags a delegation tree whose estimated cost exceeds this amount. |
| `anomalyCacheRatioMin` | number | `0.6` | Flags a tree or session whose cache ratio is below this value (0 to 1). |
| `anomalyDeniesPerSessionMax` | number | `5` | Flags a session with more tool denies than this. |

### Harness profile

`harnessProfile` adds these fields, which are `null` (or absent for `estimates`) when it is off:

- `agent.spawn.skillsInjected`: skills parsed from the `SKILLS:` block of the delegation prompt.
- `agent.report.status` and `parserVersion`: the `status:` line of the report envelope.
- `tool.verdict.guard`: the guard name parsed from a `Blocked by <guard>:` reason.
- `session.end.estimates`: the estimated Bash prompt-hook cost.

Record shape and `schema` do not change between modes.

## Stored data

Everything lives under `~/.claude/observability/`. Directories are created with mode `0700` and files with `0600`.

| Path | Content | Write mode |
|------|---------|------------|
| `events/<sessionId>.jsonl` | One event per line for the session. | Appended |
| `snapshots/<sessionId>.json` | Latest state of the session. | Replaced in place |
| `rollup/<sessionId>.json` | Per-session aggregates used by the panel and report. | Replaced in place |
| `prompts-YYYY-MM-DD.jsonl` | Full text of each subagent prompt, one file per day. | Appended |

Retention deletes regular files older than `retentionDays` from these locations at session start. It never touches the current session's files or anything outside them.

## Privacy

The plugin does not redact anything. By design it stores, as-is:

- The full text of every subagent prompt (`prompts-*.jsonl`).
- The full Bash command of every tool verdict (`events/`).
- Agent report excerpts, up to 3 KB each.
- The top Bash commands, shown in rollups and the report.

Secrets typed into a prompt or a command (tokens, passwords, keys) end up in these files. The only protection is the file modes (`0600` files, `0700` directories). Nothing leaves your machine.

To remove the data, delete `~/.claude/observability/` yourself. The plugin never deletes it as a whole, and recreates it on the next session.

## Code constants

- `CLASSIC_PERMISSION_HOOKS_ENABLED` in `src/capture/flags.ts` (default `false`): registers the classic `PermissionRequest`, `PermissionDenied`, `PostToolUse` and `PostToolUseFailure` hooks and writes `permission.outcome` events. Flip it only after the manual smoke test in the change's task 9.1 passes.
- `BASH_PROMPT_HOOK_COST_USD_PER_CALL` in `src/capture/cost/estimates.ts` (default `null`): per-call cost of the Bash prompt hook. While `null`, `session.end.estimates` carries only the call count. Calibrate it with the A/B run in task 9.6.
