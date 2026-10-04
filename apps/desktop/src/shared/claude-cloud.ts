/** W6: only the documented organization's environment id, never a shell word. */
export function isCloudEnvironmentId(value: string): boolean {
  return /^ccpool_[A-Za-z0-9_-]{1,80}$/.test(value)
}
