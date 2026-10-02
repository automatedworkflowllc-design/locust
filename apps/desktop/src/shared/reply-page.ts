/**
 * A WEB PAGE A MODEL WROTE INTO ITS REPLY, SHOWN WORKING (0.553).
 *
 * Colin, 2026-10-02, over a three-way comparison in Ask where each model
 * answered "make a small browser arcade game" with the whole game as a code
 * block: "we got to find a way to have these display and work properly". In
 * Ask a model cannot write a file, so its page arrives as text, and Locust
 * showed it as text. Claude shows such a page as an artifact you can use; so
 * does this: a reply's code block that is a WHOLE page (a doctype or <html>
 * at the start, </html> at the end) runs on a stage, with its code a tab
 * away. It is served exactly as a page a teammate wrote to disk is
 * (main/page-preview.ts): its own origin, no preload, nothing of the app.
 */

/** The largest page a reply may run: a game is tens of kilobytes. */
export const MAX_REPLY_PAGE_CHARS = 2_000_000

/** Whether a code block is a whole web page, not a fragment of one. */
export function isWholePage(code: string, language?: string): boolean {
  if (language !== undefined && !/^(html?|xhtml)$/i.test(language.trim())) return false
  if (code.length === 0 || code.length > MAX_REPLY_PAGE_CHARS) return false
  return /^\s*(<!doctype\s+html|<html[\s>])/i.test(code) && /<\/html>\s*$/i.test(code)
}
