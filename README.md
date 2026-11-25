# nuytek-harness-observatory

Claude Code plugin that captures session, agent, tool-verdict and cost telemetry into a local, append-only store under `~/.claude/observability/`. It runs as function hooks only: no model calls, no tool-call interception, no network.

## Install

From the marketplace, with no configuration:

```
/plugin marketplace add Andr3xDev/nuytek-harness-observatory
/plugin install nuytek-harness-observatory@nuytek-harness-observatory
```

Without any option set, the plugin captures the generic data: tokens, cost, agent spawn and report, tool verdicts, skills, MCP usage, commands, compactions, reconciliation and git branch.

## Local development

Run a session with the plugin loaded from a checkout:

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

## Options

Set through `/config` or `pluginConfigs` in Claude Code settings.

| Option | Type | Default | Effect |
|--------|------|---------|--------|
| `retentionDays` | string `30`, `60`, `90` | `30` | Files older than this are pruned at session start. The current session's files are kept. Other values fall back to `30`. |
| `harnessProfile` | boolean | `false` | Adds harness-specific fields. The value is read once when the plugin loads. |

`harnessProfile` adds these fields, which are `null` (or absent for `estimates`) when it is off:

- `agent.spawn.skillsInjected`: skills parsed from the `SKILLS:` block of the delegation prompt.
- `agent.report.status` and `parserVersion`: the `status:` line of the report envelope.
- `tool.verdict.guard`: the guard name parsed from a `Blocked by <guard>:` reason.
- `session.end.estimates`: the estimated Bash prompt-hook cost.

Record shape and `schema` do not change between modes.

## Code constants

- `CLASSIC_PERMISSION_HOOKS_ENABLED` in `capture/flags.ts` (default `false`): registers the classic `PermissionRequest`, `PermissionDenied`, `PostToolUse` and `PostToolUseFailure` hooks and writes `permission.outcome` events. Flip it only after the manual smoke test in the change's task 9.1 passes.
- `BASH_PROMPT_HOOK_COST_USD_PER_CALL` in `capture/estimates.ts` (default `null`): per-call cost of the Bash prompt hook. While `null`, `session.end.estimates` carries only the call count. Calibrate it with the A/B run in task 9.6.
