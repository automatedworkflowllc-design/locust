export const LOCUST_MCP_GET = 'locust-mcp:get'
export const LOCUST_MCP_SET = 'locust-mcp:set'
export const LOCUST_MCP_SET_OWN_MODE = 'locust-mcp:set-own-mode'
export interface LocustMcpState {
  readonly enabled: boolean
  /**
   * Off (the default): every turn another app starts is Ask, read only. On:
   * the teammate's own saved mode, with approvals answered only in Locust's
   * window and Auto only where Settings allows it (0.703).
   */
  readonly ownMode: boolean
  readonly claudeCommand?: string
  readonly codexConfig?: string
  readonly message?: string
}
export interface LocustMcpApi {
  settings(): Promise<LocustMcpState>
  setEnabled(enabled: boolean): Promise<LocustMcpState>
  setOwnMode(ownMode: boolean): Promise<LocustMcpState>
}
