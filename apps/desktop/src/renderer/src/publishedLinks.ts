/**
 * WHAT A TEAMMATE PUBLISHED, AS A CARD (0.727).
 *
 * The plan's look-and-feel table: "Claude's app shows a published page or doc beside the chat"; in Locust "a
 * Claude artifact or doc is only a link" -- and a bare address in a reply was not even that, only text. A reply
 * that names something a teammate made elsewhere -- a Claude artifact or doc, a Google Doc, Sheet or Slides, a
 * Notion page, a Figma file, a gist -- now ends with a card for each: what it is, its name, where it lives, and
 * Open. No preview: each of these needs the person's own sign-in, and none of them lets another app frame it.
 *
 * Only https, and only these hosts, so a card never vouches for an address it does not recognise; every other
 * link stays the link it was.
 */
export interface Published {
  readonly url: string
  /** What it is, in the words its own product uses: "Claude artifact", "Google Doc". */
  readonly kind: string
  /** The reply's own words for it when it gave some, else what its address says. */
  readonly title: string
  readonly host: string
}

/** Each kind by its address: host, then the path it must start with. */
const KINDS: readonly { readonly host: RegExp; readonly path: RegExp; readonly kind: string }[] = [
  { host: /^claude\.ai$/, path: /^\/(?:code\/)?artifact\//, kind: 'Claude artifact' },
  { host: /^claude\.ai$/, path: /^\/public\/artifacts\//, kind: 'Claude artifact' },
  { host: /^docs\.google\.com$/, path: /^\/document\//, kind: 'Google Doc' },
  { host: /^docs\.google\.com$/, path: /^\/spreadsheets\//, kind: 'Google Sheet' },
  { host: /^docs\.google\.com$/, path: /^\/presentation\//, kind: 'Google Slides' },
  { host: /^(?:www\.)?notion\.so$|\.notion\.site$/, path: /^\/./, kind: 'Notion page' },
  { host: /^(?:www\.)?figma\.com$/, path: /^\/(?:file|design|board|proto|slides)\//, kind: 'Figma file' },
  { host: /^gist\.github\.com$/, path: /^\/[^/]+\/[0-9a-f]+/, kind: 'Gist' }
]

/** A Claude artifact's address carries its title before its id: `/artifact/q3-launch-plan-<id>`. */
function titleFromAddress(url: URL, kind: string): string {
  const last = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() ?? '')
  if (kind === 'Claude artifact') {
    const words = last.replace(/-?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, '').replace(/-?[A-Za-z0-9]{22}$/, '')
    if (words.length > 0 && words !== last) return words.replace(/-/g, ' ').replace(/^./, (first) => first.toUpperCase())
  }
  if (kind === 'Notion page') {
    const words = last.replace(/-?[0-9a-f]{32}$/i, '')
    if (words.length > 0) return words.replace(/-/g, ' ')
  }
  if (kind === 'Figma file') {
    const name = url.pathname.split('/').filter(Boolean)[2]
    if (name !== undefined) return decodeURIComponent(name).replace(/-/g, ' ')
  }
  return kind
}

/** What this address is, or undefined when it is not one Locust knows. */
export function publishedOf(address: string, words?: string): Published | undefined {
  let url: URL
  try {
    url = new URL(address)
  } catch {
    return undefined
  }
  if (url.protocol !== 'https:') return undefined
  const host = url.hostname.toLowerCase()
  const known = KINDS.find((entry) => entry.host.test(host) && entry.path.test(url.pathname))
  if (known === undefined) return undefined
  const said = words?.trim()
  const title = said !== undefined && said.length > 0 && said !== address && !/^https?:\/\//i.test(said) ? said : titleFromAddress(url, known.kind)
  return { url: url.href, kind: known.kind, title: title.slice(0, 120), host }
}

const MARKDOWN_LINK = /\[([^\]\n]{1,200})\]\((https:\/\/[^\s)]+)\)/g
const BARE = /(?<![(\w/])https:\/\/[^\s<>"'`)\]]+/g

/** Every known thing the text names, in the order it names them, each once. */
export function publishedIn(reply: string): readonly Published[] {
  // An address inside a code block is code, not something published: blanked, keeping every offset.
  const text = reply.replace(/```[\s\S]*?(?:```|$)/g, (block) => ' '.repeat(block.length))
  const found: { readonly at: number; readonly item: Published }[] = []
  const seen = new Set<string>()
  const take = (at: number, address: string, words?: string): void => {
    const item = publishedOf(address.replace(/[.,;:!?]+$/, ''), words)
    if (item === undefined || seen.has(item.url)) return
    seen.add(item.url)
    found.push({ at, item })
  }
  for (const match of text.matchAll(MARKDOWN_LINK)) take(match.index, match[2]!, match[1])
  for (const match of text.matchAll(BARE)) take(match.index, match[0])
  return found.sort((left, right) => left.at - right.at).map((entry) => entry.item)
}
