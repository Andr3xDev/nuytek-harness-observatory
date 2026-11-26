import { describe, expect, test } from 'claude-code/testing'
import { PARSER_VERSION, REPORT_EXCERPT_MAX_BYTES } from '../../core/constants'
import {
  buildReportRecord,
  buildSpawnRecord,
  buildTurnComplete,
  buildVerdictRecord,
  createEnvelope,
  sha256Hex,
  type EnvelopeContext,
} from './records'

const CTX: EnvelopeContext = { sessionId: 's1', branch: 'main', now: 1_700_000_000_123 }
const NULL_BRANCH_CTX: EnvelopeContext = { ...CTX, branch: null }
const ENVELOPE_KEYS = ['schema', 'id', 'type', 'ts', 'sessionId', 'agentId', 'branch']
const SKILLS_PROMPT = 'SKILLS:\n- /a/skills/foo/SKILL.md\n- /a/skills/bar/SKILL.md\n\nDo the task.'
const GUARD_REASON = 'Blocked by infra-agent-bash-guard: rm denied'
const encodedBytes = (text: string): number => new TextEncoder().encode(text).length

const SPAWN_INPUT = { prompt: SKILLS_PROMPT, subagentType: 'builder', parentAgentId: undefined }
const REPORT_INPUT = {
  agentId: 'a1',
  parentAgentId: undefined,
  subagentType: 'builder',
  status: 'completed' as const,
  text: 'done\nstatus: done',
}
const BASH_INPUT = { tool: 'Bash', input: { command: 'rm -rf x' }, tool_use_id: 'tu1', agentId: 'a1' }
const DENY_RESULT = { decision: 'deny' as const, reason: GUARD_REASON, rule: 'r', hook: 'h', plugin: 'p' }

describe('envelope', () => {
  test('carries every envelope field with schema 1 and an integer ts', () => {
    const envelope = createEnvelope('session.compact', CTX, null)
    expect(Object.keys(envelope).sort()).toEqual([...ENVELOPE_KEYS].sort())
    expect(envelope.schema).toBe(1)
    expect(envelope.ts).toBe(CTX.now)
    expect(envelope.sessionId).toBe('s1')
  })

  test('ids are unique per event', () => {
    expect(createEnvelope('session.compact', CTX, null).id).not.toBe(createEnvelope('session.compact', CTX, null).id)
  })

  test('branch null is allowed and kept', () => {
    expect(createEnvelope('session.compact', NULL_BRANCH_CTX, null).branch).toBeNull()
  })
})

describe('sha256Hex', () => {
  test('matches the SHA-256 known vector for "abc"', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})

describe('buildSpawnRecord', () => {
  test('event and prompt record agree on promptId, sha and bytes', async () => {
    const { event, prompt } = await buildSpawnRecord(SPAWN_INPUT, { agentId: 'a1' }, true, CTX)
    expect(event.promptId).toBe('pr-a1')
    expect(prompt.promptId).toBe(event.promptId)
    expect(prompt.sha).toBe(event.promptSha)
    expect(prompt.sha).toBe(await sha256Hex(SKILLS_PROMPT))
    expect(prompt.bytes).toBe(event.promptBytes)
    expect(event.promptBytes).toBe(encodedBytes(SKILLS_PROMPT))
  })

  test('prompt text stays out of the event and in the prompt record', async () => {
    const { event, prompt } = await buildSpawnRecord(SPAWN_INPUT, { agentId: 'a1' }, true, CTX)
    expect(JSON.stringify(event)).not.toContain('Do the task.')
    expect(prompt.text).toBe(SKILLS_PROMPT)
  })

  test('skillsInjected lists the SKILLS block with the profile on', async () => {
    const { event } = await buildSpawnRecord(SPAWN_INPUT, { agentId: 'a1' }, true, CTX)
    expect(event.skillsInjected).toEqual(['/a/skills/foo/SKILL.md', '/a/skills/bar/SKILL.md'])
  })

  test('skillsInjected is [] with the profile on and no block', async () => {
    const { event } = await buildSpawnRecord({ ...SPAWN_INPUT, prompt: 'plain' }, { agentId: 'a1' }, true, CTX)
    expect(event.skillsInjected).toEqual([])
  })

  test('skillsInjected is null with the profile off but sha and bytes remain', async () => {
    const { event } = await buildSpawnRecord(SPAWN_INPUT, { agentId: 'a1' }, false, CTX)
    expect(event.skillsInjected).toBeNull()
    expect(event.promptSha).toBe(await sha256Hex(SKILLS_PROMPT))
    expect(event.promptBytes).toBe(encodedBytes(SKILLS_PROMPT))
  })
})

describe('buildReportRecord', () => {
  test('truncates a 10 KB report to the byte cap without splitting a code point', () => {
    const boundaryText = 'a'.repeat(REPORT_EXCERPT_MAX_BYTES - 1) + '€'.repeat(3000)
    const event = buildReportRecord({ ...REPORT_INPUT, text: boundaryText }, true, CTX)
    expect(encodedBytes(boundaryText)).toBeGreaterThan(10_000)
    expect(encodedBytes(event.reportExcerpt)).toBeLessThanOrEqual(REPORT_EXCERPT_MAX_BYTES)
    expect(event.reportExcerpt).toBe('a'.repeat(REPORT_EXCERPT_MAX_BYTES - 1))
    expect(event.reportExcerpt).not.toContain('�')
  })

  test('a short report is kept whole', () => {
    expect(buildReportRecord(REPORT_INPUT, true, CTX).reportExcerpt).toBe(REPORT_INPUT.text)
  })

  test('engineStatus is the host status with the profile off', () => {
    expect(buildReportRecord({ ...REPORT_INPUT, status: 'failed' }, false, CTX).engineStatus).toBe('failed')
  })

  test('profile on parses status and stamps the parser version', () => {
    const event = buildReportRecord(REPORT_INPUT, true, CTX)
    expect(event.status).toBe('done')
    expect(event.parserVersion).toBe(PARSER_VERSION)
  })

  test('profile on with no status line keeps status null and parserVersion an integer', () => {
    const event = buildReportRecord({ ...REPORT_INPUT, text: 'no envelope' }, true, CTX)
    expect(event.status).toBeNull()
    expect(event.parserVersion).toBe(PARSER_VERSION)
  })

  test('profile off nulls status and parserVersion and keeps engineStatus', () => {
    const event = buildReportRecord(REPORT_INPUT, false, CTX)
    expect(event.status).toBeNull()
    expect(event.parserVersion).toBeNull()
    expect(event.engineStatus).toBe('completed')
  })
})

describe('buildVerdictRecord', () => {
  test('Bash verdict keeps the full command and agent id; guard parsed with the profile on', () => {
    const event = buildVerdictRecord(BASH_INPUT, DENY_RESULT, true, CTX)
    expect(event.type).toBe('tool.verdict')
    expect(event.agentId).toBe('a1')
    expect(event.toolUseId).toBe('tu1')
    expect(event.decision).toBe('deny')
    expect(event.command).toBe('rm -rf x')
    expect(event.reason).toBe(GUARD_REASON)
    expect(event.guard).toBe('infra-agent-bash-guard')
  })

  test('profile off leaves guard null and the raw reason untouched', () => {
    const event = buildVerdictRecord(BASH_INPUT, DENY_RESULT, false, CTX)
    expect(event.guard).toBeNull()
    expect(event.reason).toBe(GUARD_REASON)
    expect(event.rule).toBe('r')
    expect(event.hook).toBe('h')
    expect(event.plugin).toBe('p')
  })

  test('reason without guard prefix gives guard null with the profile on', () => {
    const event = buildVerdictRecord(BASH_INPUT, { decision: 'deny', reason: 'no' }, true, CTX)
    expect(event.guard).toBeNull()
    expect(event.reason).toBe('no')
  })

  test('absent reason, rule, hook and plugin are stored as null', () => {
    const event = buildVerdictRecord(BASH_INPUT, { decision: 'allow' }, true, CTX)
    expect([event.reason, event.rule, event.hook, event.plugin]).toEqual([null, null, null, null])
  })

  test('MCP tool carries mcpServer and no command', () => {
    const event = buildVerdictRecord(
      { tool: 'mcp__engram__mem_save', input: {}, tool_use_id: 'tu2' },
      { decision: 'allow' },
      false,
      CTX,
    )
    expect(event.mcpServer).toBe('engram')
    expect(event.command).toBeUndefined()
  })

  test('main loop call without agentId has agentId null', () => {
    const event = buildVerdictRecord({ ...BASH_INPUT, agentId: undefined }, { decision: 'allow' }, false, CTX)
    expect(event.agentId).toBeNull()
  })
})

describe('buildTurnComplete', () => {
  const USAGE = {
    input_tokens: 10,
    output_tokens: 20,
    cache_read_input_tokens: 30,
    cache_creation_input_tokens: 40,
    model: 'opus',
  }

  test('subagent turn maps usage to camelCase and has no costUsd', () => {
    const event = buildTurnComplete({ agentId: 'a1', durationMs: 5, usage: USAGE }, CTX, {
      costUsd: null,
      previousModel: 'prev',
    })
    expect(event.type).toBe('turn.complete')
    expect(event.agentId).toBe('a1')
    expect(event.durationMs).toBe(5)
    expect(event.usage).toEqual({ input: 10, output: 20, cacheRead: 30, cacheCreation: 40, model: 'opus' })
    expect(event).not.toHaveProperty('costUsd')
  })

  test('main turn has agentId null and carries costUsd', () => {
    const event = buildTurnComplete({ durationMs: 5, usage: USAGE }, CTX, { costUsd: 0.3, previousModel: 'prev' })
    expect(event.agentId).toBeNull()
    expect(event.costUsd).toBe(0.3)
  })

  test('main turn with an underivable cost writes costUsd null', () => {
    const event = buildTurnComplete({ durationMs: 5, usage: USAGE }, CTX, { costUsd: null, previousModel: 'prev' })
    expect(event.costUsd).toBeNull()
  })

  test('absent usage writes zero tokens with the previous model', () => {
    const event = buildTurnComplete({ durationMs: 5 }, CTX, { costUsd: null, previousModel: 'prev' })
    expect(event.usage).toEqual({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0, model: 'prev' })
  })
})
