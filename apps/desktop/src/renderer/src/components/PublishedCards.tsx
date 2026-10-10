import { useMemo, useState } from 'react'
import type { ReactElement } from 'react'

import { publishedIn } from '../publishedLinks.js'
import type { Published } from '../publishedLinks.js'
import { Icon } from './Icon.js'

/**
 * A card for each thing a reply says a teammate published (0.727, publishedLinks.ts): what it is, its name,
 * where it lives, and Open, which goes through the host's own link check like every link in a reply -- a
 * refusal is said beside the card that was pressed.
 */
export function PublishedCards({ text }: { readonly text: string }): ReactElement | null {
  const items = useMemo(() => publishedIn(text), [text])
  if (items.length === 0) return null
  return (
    <div className="lc-published" aria-label="What this reply links to">
      {items.map((item) => (
        <PublishedCard key={item.url} item={item} />
      ))}
    </div>
  )
}

function PublishedCard({ item }: { readonly item: Published }): ReactElement {
  const [refused, setRefused] = useState<string>()
  return (
    <div className="lc-published__item">
      <button
        type="button"
        className="lc-published__card"
        title={item.url}
        onClick={() => {
          setRefused(undefined)
          const bridge = window.desktop
          if (bridge === undefined) return
          void bridge
            .openLink(item.url)
            .then((answer) => setRefused(answer.ok ? undefined : answer.message))
            .catch(() => setRefused('That link could not be opened. Nothing in the conversation changed.'))
        }}
      >
        <span className="lc-published__mark" aria-hidden="true">
          <Icon name="file" size={16} />
        </span>
        <span className="lc-published__who">
          <span className="lc-published__title">{item.title}</span>
          <span className="lc-published__line">
            {item.kind} · {item.host}
          </span>
        </span>
        <span className="lc-published__open">Open</span>
      </button>
      {refused !== undefined && (
        <span className="lc-link__refusal" role="status">
          {refused}
        </span>
      )}
    </div>
  )
}
