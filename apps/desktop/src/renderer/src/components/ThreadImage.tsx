import { useContext } from 'react'
import type { ReactElement } from 'react'
import { AttachedImage } from './AttachedImage.js'
import { ThreadImagesContext } from '../threadImages.js'

/** Optional picture beneath an existing name, or a Markdown image's caption. */
export function ThreadImage({ path, caption }: { readonly path: string; readonly caption?: string }): ReactElement {
  const { folder, onOpenFile } = useContext(ThreadImagesContext)
  return <AttachedImage path={path} folder={folder} render={(dataUrl, absolute) => (
      <span className="lc-threadimage">
        {onOpenFile === undefined ? <img className="lc-threadimage__picture" src={dataUrl} alt={caption ?? path} loading="lazy" decoding="async" onError={(event) => { event.currentTarget.closest('.lc-threadimage')?.setAttribute('hidden', '') }} /> : <button type="button" className="lc-threadimage__open" title={path} aria-label={`Open ${path}`} onClick={() => onOpenFile(absolute)}>
          <img className="lc-threadimage__picture" src={dataUrl} alt={caption ?? path} loading="lazy" decoding="async" onError={(event) => { event.currentTarget.closest('.lc-threadimage')?.setAttribute('hidden', '') }} />
        </button>}
        {caption !== undefined && <span className="lc-threadimage__caption">{caption}</span>}
      </span>
    )} />
}
