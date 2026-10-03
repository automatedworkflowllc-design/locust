import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'

import type { PetRef } from '../../../shared/avatar.js'
import type { PetGalleryFilter, PublicGalleryPet, PublicPet } from '../../../shared/ipc.js'
import { OPENPETS_LINK, OPENPETS_REPORT_LINK } from '../../../shared/outbound-links.js'
import { refreshPetList, setPetLook } from '../pets.js'

/**
 * THE OPENPETS.DEV GALLERY, BROWSED IN PLACE (0.563).
 *
 * Colin, 2026-10-03: "theyre just going to be added to the list of potential
 * choices for teammates". So the gallery opens under the look grid, not in a
 * window of its own: search, OpenPets' Featured or its Originals (the two
 * curated lists OpenPets' own app shows), a page of tiles, and More. A tile's
 * click downloads that one pet to this computer and puts it on the teammate
 * -- nothing is downloaded before a click, and each pet's rights stay with
 * its maker (the line under the tiles says so, and where to report one).
 */

/** Small pictures already read this session, by pet id. */
const thumbnails = new Map<string, string>()

function GalleryThumbnail({ id, name }: { readonly id: string; readonly name: string }): ReactElement {
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
    // Read when it comes into view: a page of tiles is not 24 downloads at once.
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
    <span ref={ref} className="lc-petgallery__picture" aria-hidden>
      {source !== undefined && <img src={source} alt="" draggable={false} />}
      {source === undefined && <span className="lc-petgallery__placeholder" title={name} />}
    </span>
  )
}

export function PetGallery({
  selected,
  onPick
}: {
  /** The pet the teammate wears now, marked among the tiles. */
  readonly selected: PetRef | undefined
  /** A pet added (or already here) and chosen. */
  readonly onPick: (pet: PublicPet) => void
}): ReactElement {
  const [filter, setFilter] = useState<PetGalleryFilter>('featured')
  const [query, setQuery] = useState('')
  const [asked, setAsked] = useState('')
  const [pets, setPets] = useState<readonly PublicGalleryPet[]>([])
  const [total, setTotal] = useState(0)
  const [stale, setStale] = useState(false)
  const [reading, setReading] = useState(true)
  const [failure, setFailure] = useState<string>()
  const [adding, setAdding] = useState<string>()
  const [addFailure, setAddFailure] = useState<string>()
  const [attempt, setAttempt] = useState(0)
  const [linkNotice, setLinkNotice] = useState<string>()
  // Which list is on screen: a page asked for under another filter or search is not added to this one.
  const shownList = useRef(0)

  // The search is asked a moment after typing stops, not on every key.
  useEffect(() => {
    const timer = setTimeout(() => setAsked(query.trim()), 250)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    const bridge = window.desktop
    if (bridge === undefined) return undefined
    let current = true
    shownList.current += 1
    setReading(true)
    setFailure(undefined)
    void bridge.browsePetGallery({ filter, query: asked, offset: 0 }).then((answer) => {
      if (!current) return
      setReading(false)
      if (!answer.ok) {
        setFailure(answer.error.message)
        setPets([])
        setTotal(0)
        return
      }
      setPets(answer.data.pets)
      setTotal(answer.data.total)
      setStale(answer.data.stale)
    })
    return () => {
      current = false
    }
  }, [filter, asked, attempt])

  const more = (): void => {
    const bridge = window.desktop
    if (bridge === undefined || reading) return
    const list = shownList.current
    setReading(true)
    void bridge.browsePetGallery({ filter, query: asked, offset: pets.length }).then((answer) => {
      if (list !== shownList.current) return
      setReading(false)
      if (!answer.ok) {
        setFailure(answer.error.message)
        return
      }
      setPets((shown) => [...shown, ...answer.data.pets.filter((pet) => !shown.some((other) => other.id === pet.id))])
      setTotal(answer.data.total)
    })
  }

  const add = (pet: PublicGalleryPet): void => {
    const bridge = window.desktop
    if (bridge === undefined || adding !== undefined) return
    setAdding(pet.id)
    setAddFailure(undefined)
    void bridge
      .addPet(pet.id)
      .then(async (answer) => {
        if (!answer.ok) {
          setAddFailure(answer.error.message)
          return
        }
        // Read afresh: a pet that was missing before is here now.
        setPetLook({ source: 'gallery', id: pet.id }, undefined)
        setPets((shown) => shown.map((other) => (other.id === pet.id ? { ...other, added: true } : other)))
        await refreshPetList()
        onPick(answer.data.pet)
      })
      .catch(() => setAddFailure(`${pet.displayName} could not be added. Nothing of it was kept on this computer.`))
      .finally(() => setAdding(undefined))
  }

  // A link the host will not open says so (a-refused-link-says-so.test.ts).
  const open = (url: string): void => {
    setLinkNotice(undefined)
    void window.desktop?.openLink(url).then((answer) => {
      if (!answer.ok) setLinkNotice(answer.message)
    })
  }

  return (
    <div className="lc-petgallery" aria-label="Pet gallery">
      <div className="lc-petgallery__bar">
        <input
          type="search"
          className="lc-input lc-petgallery__search"
          placeholder="Search pets"
          aria-label="Search pets"
          value={query}
          maxLength={80}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="lc-lookface lc-petgallery__filter" role="radiogroup" aria-label="Which pets">
          {(['featured', 'originals'] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={filter === option}
              className={filter === option ? 'is-selected' : undefined}
              title={option === 'featured' ? 'The pets openpets.dev features' : 'Pets OpenPets made itself'}
              onClick={() => setFilter(option)}
            >
              {option === 'featured' ? 'Featured' : 'Originals'}
            </button>
          ))}
        </div>
      </div>

      {failure !== undefined ? (
        <div className="lc-petgallery__note">
          <span>{failure}</span>
          <button type="button" className="lc-button" onClick={() => setAttempt((count) => count + 1)}>
            Try again
          </button>
        </div>
      ) : (
        <>
          {stale && <p className="lc-petgallery__note">The gallery could not be reached, so this is the list as Locust last read it.</p>}
          {!reading && pets.length === 0 && (
            <p className="lc-petgallery__note">{asked.length > 0 ? `No pet matches “${asked}”.` : 'No pets to show.'}</p>
          )}
          <div className="lc-petgallery__grid" role="list" aria-busy={reading}>
            {pets.map((pet) => {
              const chosen = selected?.source === 'gallery' && selected.id === pet.id
              const busy = adding === pet.id
              return (
                <button
                  key={pet.id}
                  type="button"
                  role="listitem"
                  className={`lc-petgallery__tile${chosen ? ' is-selected' : ''}${busy ? ' is-busy' : ''}`}
                  data-pet={pet.id}
                  title={pet.added ? `Use ${pet.displayName}` : `Add ${pet.displayName} to this computer and use it`}
                  disabled={adding !== undefined && !busy}
                  onClick={() => add(pet)}
                >
                  <GalleryThumbnail id={pet.id} name={pet.displayName} />
                  <span className="lc-petgallery__name">{pet.displayName}</span>
                  <span className="lc-petgallery__state">{busy ? 'Adding…' : chosen ? 'Wearing' : pet.added ? 'Added' : 'Add'}</span>
                </button>
              )
            })}
          </div>
          {addFailure !== undefined && <p className="lc-petgallery__note lc-tone-amber">{addFailure}</p>}
          {pets.length < total && (
            <button type="button" className="lc-ghostbutton lc-petgallery__more" disabled={reading} onClick={more}>
              {reading ? 'Reading…' : `More (${String(total - pets.length)})`}
            </button>
          )}
        </>
      )}

      <p className="lc-petgallery__credit">
        Community pets from{' '}
        <button type="button" className="lc-linkbutton" onClick={() => open(OPENPETS_LINK)}>
          openpets.dev
        </button>
        . Rights stay with each pet&rsquo;s maker.{' '}
        <button type="button" className="lc-linkbutton" onClick={() => open(OPENPETS_REPORT_LINK)}>
          Report a pet
        </button>
      </p>
      {linkNotice !== undefined && <p className="lc-petgallery__note lc-tone-amber">{linkNotice}</p>}
    </div>
  )
}
