import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { isWholePage } from '../shared/reply-page.js'

/**
 * Where a reply's page is written to be served (0.553, shared/reply-page.ts):
 * outside every project, one folder per page, named by what it says -- so a
 * page's own folder holds only it, and the same page is one file however
 * often it is shown.
 */
export const REPLY_PAGE_ROOT = join(homedir(), '.locust', 'reply-pages')

export async function writeReplyPage(html: string, root = REPLY_PAGE_ROOT): Promise<string | undefined> {
  if (!isWholePage(html)) return undefined
  const folder = join(root, createHash('sha256').update(html, 'utf8').digest('hex').slice(0, 24))
  await mkdir(folder, { recursive: true })
  const path = join(folder, 'index.html')
  await writeFile(path, html, 'utf8')
  return path
}
