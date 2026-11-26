const MCP_TOOL = /^mcp__(.+?)__.+$/

export const parseMcpServer = (toolName: string): string | null => MCP_TOOL.exec(toolName)?.[1] ?? null
