import { describe, expect, test } from 'claude-code/testing'
import {
  buildReportRecord,
  buildSpawnRecord,
  buildTurnComplete,
  buildVerdictRecord,
  createEnvelope,
  type EnvelopeContext,
} from './records'

const CTX: EnvelopeContext = { sessionId: 's1', branch: 'main', now: 1_700_000_000_123 }
const NULL_BRANCH_CTX: EnvelopeContext = { ...CTX, branch: null }
const ENVELOPE_KEYS = ['schema', 'id', 'type', 'ts', 'sessionId', 'agentId', 'branch']
const SKILLS_PROMPT = 'SKILLS:\n- /a/skills/foo/SKILL.md\n- /a/skills/bar/SKILL.md\n\nDo the task.'

const SPAWN_INPUT = { prompt: SKILLS_PROMPT, subagentType: 'builder', parentAgentId: undefined }
const REPORT_INPUT = {
  agentId: 'a1',
  parentAgentId: undefined,
  subagentType: 'builder',
  status: 'completed' as const,
}
const BASH_INPUT = { tool: 'Bash', tool_use_id: 'tu1', agentId: 'a1' }

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

describe('buildSpawnRecord', () => {
  test('stores the subagent type and no prompt content', () => {
    const event = buildSpawnRecord(SPAWN_INPUT, { agentId: 'a1' }, true, CTX)
    expect(event).toMatchObject({ type: 'agent.spawn', agentId: 'a1', subagentType: 'builder', parentAgentId: null })
    expect(JSON.stringify(event)).not.toContain('Do the task.')
  })

  test('skillsInjected lists the SKILLS block with the profile on', () => {
    const event = buildSpawnRecord(SPAWN_INPUT, { agentId: 'a1' }, true, CTX)
    expect(event.skillsInjected).toEqual(['/a/skills/foo/SKILL.md', '/a/skills/bar/SKILL.md'])
  })

  test('skillsInjected is [] with the profile on and no block', () => {
    const event = buildSpawnRecord({ ...SPAWN_INPUT, prompt: 'plain' }, { agentId: 'a1' }, true, CTX)
    expect(event.skillsInjected).toEqual([])
  })

  test('skillsInjected is null with the profile off', () => {
    expect(buildSpawnRecord(SPAWN_INPUT, { agentId: 'a1' }, false, CTX).skillsInjected).toBeNull()
  })
})

describe('buildReportRecord', () => {
  test('keeps the engine status and no report text', () => {
    const event = buildReportRecord({ ...REPORT_INPUT, status: 'failed' }, CTX)
    expect(event).toMatchObject({ type: 'agent.report', agentId: 'a1', engineStatus: 'failed' })
    expect(JSON.stringify(event)).not.toContain('status: done')
  })
})

describe('buildVerdictRecord', () => {
  test('keeps the tool name, tool use id and agent id', () => {
    const event = buildVerdictRecord(BASH_INPUT, CTX)
    expect(event).toMatchObject({ type: 'tool.verdict', agentId: 'a1', toolName: 'Bash', toolUseId: 'tu1' })
    expect(event.mcpServer).toBeUndefined()
  })

  test('MCP tool carries mcpServer', () => {
    expect(buildVerdictRecord({ tool: 'mcp__engram__mem_save', tool_use_id: 'tu2' }, CTX).mcpServer).toBe('engram')
  })

  test('main loop call without agentId has agentId null', () => {
    expect(buildVerdictRecord({ ...BASH_INPUT, agentId: undefined }, CTX).agentId).toBeNull()
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
