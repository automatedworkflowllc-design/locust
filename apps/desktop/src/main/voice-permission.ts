/** Deny unknown media, video, subframes, and every other permission. */
export function voicePermission(ownWindow: boolean, permission: string, mainFrame: boolean, media: readonly string[]): boolean {
  return ownWindow && mainFrame && permission === 'media' && media.length > 0 && media.every((type) => type === 'audio')
}
