const GUARD_PREFIX = /^Blocked by ([^:\s]+):/

export const parseGuardName = (reason: string | null | undefined): string | null =>
  GUARD_PREFIX.exec(reason ?? '')?.[1] ?? null
