import { maintainArgv } from './scripts'

const VALID_RETENTION_DAYS = ['30', '60', '90']
const DEFAULT_RETENTION_DAYS = '30'

export const resolveRetentionDays = (value: string | undefined): string =>
  value !== undefined && VALID_RETENTION_DAYS.includes(value) ? value : DEFAULT_RETENTION_DAYS

export const buildRetentionArgv = (days: string | undefined, sessionId: string): string[] =>
  maintainArgv(resolveRetentionDays(days), `${sessionId}.jsonl`, `main-${sessionId}.json`)
