export const LOCUST_MCP_GET = 'locust-mcp:get'
export const LOCUST_MCP_SET = 'locust-mcp:set'
export interface LocustMcpState {
  readonly enabled: boolean
  readonly claudeCommand?: string
  readonly codexConfig?: string
  readonly message?: string
}
export interface LocustMcpApi {
  settings(): Promise<LocustMcpState>
  setEnabled(enabled: boolean): Promise<LocustMcpState>
}
