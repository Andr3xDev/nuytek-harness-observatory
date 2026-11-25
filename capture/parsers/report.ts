const STATUS_LINE = /^status:[ \t]*(\S+)[ \t]*$/m

export const parseReportStatus = (text: string): string | null => STATUS_LINE.exec(text)?.[1] ?? null
