const VALID_RETENTION_DAYS = ['30', '60', '90']
const DEFAULT_RETENTION_DAYS = '30'

export const resolveRetentionDays = (value: string | undefined): string =>
  value !== undefined && VALID_RETENTION_DAYS.includes(value) ? value : DEFAULT_RETENTION_DAYS
