import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'

import type { PetRef } from '../../../shared/avatar.js'
import type { PublicPet } from '../../../shared/ipc.js'
import { OPENPETS_LINK, OPENPETS_REPORT_LINK } from '../../../shared/outbound-links.js'
import { PET_PICKS } from '../../../shared/pet-picks.js'
import type { PetPick } from '../../../shared/pet-picks.js'
import { refreshPetList, setPetLook } from '../pets.js'

/**
 * THE PETS LOCUST OFFERS, AS TILES IN THE LOOK PICKER (0.564).
 *
 * 0.563 browsed openpets.dev's whole gallery here: search, Featured or
 * Originals, a page of tiles and More. Colin kept the 21 he had added from it
 * and asked for *"all the others"* to go (shared/pet-picks.ts), so the Pets
 * row is those 21, always there: no search, no paging. A tile shows the pet's
 * small picture -- light to show, where 21 live sheets were seconds of
 * decoding -- and a pet not on this computer yet carries a small arrow: its
 * click downloads that one pet from openpets.dev and puts it on the teammate.
 * Nothing is downloaded before a click, and each pet's rights stay with its
 * maker (PetCredit says so, and where to report one).
 */

/** Small pictures already read this session, by pet id. */
const thumbnails = new Map<string, string>()

function PickPicture({ id }: { readonly id: string }): ReactElement {
  const ref = useRef<HTMLSpanElement>(null)
  const [source, setSource] = useState(thumbnails.get(id))
  useEffect(() => {
    if (source !== undefined) return undefined
    const element = ref.current
    const bridge = window.desktop
    if (element === null || bridge === undefined) return undefined
    let cancelled = false
    const read = (): void => {
      void bridge.petThumbnail(id).then((answer) => {
        if (!answer.ok || cancelled) return
        thumbnails.set(id, answer.data.dataUrl)
        setSource(answer.data.dataUrl)
      })
    }
    // Read when it comes into view: the dialog may open scrolled away from the pets.
    if (typeof IntersectionObserver === 'undefined') {
      read()
      return () => {
        cancelled = true
      }
    }
    const watch = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting !== true) return
      watch.disconnect()
      read()
    })
    watch.observe(element)
    return () => {
      cancelled = true
      watch.disconnect()
    }
  }, [id, source])
  return (
    <span ref={ref} className="lc-pettile__picture" aria-hidden>
      {source !== undefined ? <img src={source} alt="" draggable={false} /> : <span className="lc-pettile__placeholder" />}
    </span>
  )
}

export function PetPickTiles({
  selected,
  installed,
  onWear,
  onNotice
}: {
  /** The pet the teammate wears now, marked among the tiles. */
  readonly selected: PetRef | undefined
  /** The pets on this computer, to know which picks need a download. */
  readonly installed: readonly PublicPet[] | undefined
  /** A pick on this computer (now), chosen. */
  readonly onWear: (pet: PublicPet) => void
  /** What went wrong, in words; undefined clears it. */
  readonly onNotice: (notice: string | undefined) => void
}): ReactElement {
  const [adding, setAdding] = useState<string>()

  const wear = (pick: PetPick): void => {
    const here = installed?.find((pet) => pet.source === 'gallery' && pet.id === pick.id)
    if (here !== undefined) {
      onNotice(undefined)
      onWear(here)
      return
    }
    const bridge = window.desktop
    if (bridge === undefined || adding !== undefined) return
    setAdding(pick.id)
    onNotice(undefined)
    void bridge
      .addPet(pick.id)
      .then(async (answer) => {
        if (!answer.ok) {
          onNotice(answer.error.message)
          return
        }
        // Read afresh: a pet that was missing before is here now.
        setPetLook({ source: 'gallery', id: pick.id }, undefined)
        await refreshPetList()
        onWear(answer.data.pet)
      })
      .catch(() => onNotice(`${pick.displayName} could not be added. Nothing of it was kept on this computer.`))
      .finally(() => setAdding(undefined))
  }

  return (
    <>
      {PET_PICKS.map((pick) => {
        const chosen = selected?.source === 'gallery' && selected.id === pick.id
        const here = installed?.some((pet) => pet.source === 'gallery' && pet.id === pick.id) === true
        const busy = adding === pick.id
        return (
          <button
            key={pick.id}
            type="button"
            role="radio"
            aria-checked={chosen}
            aria-label={pick.displayName}
            aria-busy={busy}
            title={here ? pick.displayName : `${pick.displayName}: downloads from openpets.dev when picked`}
            data-pet={pick.id}
            data-source="gallery"
            data-here={here ? 'yes' : 'no'}
            className={`lc-look lc-pettile${chosen ? ' is-selected' : ''}${busy ? ' is-busy' : ''}`}
            disabled={adding !== undefined && !busy}
            onClick={() => wear(pick)}
          >
            <PickPicture id={pick.id} />
            {!here && (
              <span className="lc-pettile__get" aria-hidden>
                <svg viewBox="0 0 10 10" width="8" height="8">
                  <path d="M5 1.5v6M2.2 4.8 5 7.6l2.8-2.8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            )}
          </button>
        )
      })}
    </>
  )
}

/** Where the pets come from, and where to report one. */
export function PetCredit(): ReactElement {
  const [linkNotice, setLinkNotice] = useState<string>()
  // A link the host will not open says so (a-refused-link-says-so.test.ts).
  const open = (url: string): void => {
    setLinkNotice(undefined)
    void window.desktop?.openLink(url).then((answer) => {
      if (!answer.ok) setLinkNotice(answer.message)
    })
  }
  return (
    <>
      <p className="lc-pets__caption lc-pets__credit">
        Pets from{' '}
        <button type="button" className="lc-linkbutton" onClick={() => open(OPENPETS_LINK)}>
          openpets.dev
        </button>
        , made by its community. Rights stay with each pet&rsquo;s maker.{' '}
        <button type="button" className="lc-linkbutton" onClick={() => open(OPENPETS_REPORT_LINK)}>
          Report a pet
        </button>
      </p>
      {linkNotice !== undefined && <p className="lc-pets__caption lc-tone-amber">{linkNotice}</p>}
    </>
  )
}
