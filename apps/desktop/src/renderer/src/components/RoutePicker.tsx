import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, ReactElement } from 'react'

import type { MissionRuntimeId } from '@teammate/runtime-adapters'
import type { PublicModel, PublicRuntimeStatus } from '../../../shared/ipc.js'
import { ROUTE_GROUP_LIMIT, capRouteRows, integrationOf, orderRouteRows, recentRouteRows, routeRowStatus, routeRowTag, routeSearchText } from '../status.js'
import type { RouteTag } from '../status.js'
import { modelDisplayName } from '../routeName.js'
import { FREE_START_RUNTIME } from '../../../shared/runtime-install.js'

export interface RouteChoice {
  readonly runtime: MissionRuntimeId
  /** The model identifier a mission would actually be started with. */
  readonly model: string
}

interface RouteRow {
  readonly key: string
  readonly group: string
  readonly runtime: MissionRuntimeId
  readonly model: string
  readonly label: string
  readonly detail: string
  readonly tag: RouteTag
  readonly selectable: boolean
}

/**
 * Rows come from discovery, and models come from the runtime's own catalog.
 * There are still no invented entries: when the catalog cannot be read the row
 * is the account default, which is exactly what the process is launched with.
 */
function buildRows(
  runtimes: readonly PublicRuntimeStatus[],
  models: readonly PublicModel[],
  active: RouteChoice,
  resolved: ReadonlyMap<string, string>,
  recent: readonly string[],
  limited: ReadonlyMap<string, string>
): readonly RouteRow[] {
  const rows: RouteRow[] = []
  for (const runtime of runtimes) {
    if (runtime.id === 'omniroute') continue
    const integration = integrationOf(runtime.id)
    const status = routeRowStatus(runtime, integration, false, limited.get(runtime.id))
    /*
     * THE ACCOUNT SUFFIX, ONLY WHERE THERE IS AN ACCOUNT.
     *
     * Every group header said `· your account` unconditionally, OpenCode's
     * included -- and OpenCode is the runtime the welcome screen recommends
     * BY NAME because it needs no account, whose free model this app's whole
     * on-ramp rests on. Gemini's handoff pass, 2026-09-21.
     * 
     * It is the same sentence-that-does-not-match-its-list defect as the
     * welcome screen's collapsed `they each need their own account`, on the
     * next control along, and it lands on the one person least able to tell
     * it is wrong: someone deciding whether picking this route will cost
     * them money.
     */
    const group = runtime.id === FREE_START_RUNTIME ? runtime.displayName : `${runtime.displayName} · your account`

    // Every catalog model names its runtime -- Codex's from a live server
    // read, Claude's from what its CLI advertised -- and is offered only
    // there. A model under the wrong runtime would be a claim nothing checked.
    const forRuntime = models.filter((model) => model.runtime === runtime.id)
    const entries =
      forRuntime.length > 0
        ? forRuntime.map((model) => {
            const efforts =
              model.supportedEfforts.length > 0
                ? `${model.supportedEfforts.length} effort level${model.supportedEfforts.length === 1 ? '' : 's'} · ${model.supportedEfforts.join(', ')}`
                : 'no effort levels reported'
            // The name the runtime itself reported the last time a mission ran
            // on this route. Absent until one has, which is the honest state.
            const name = resolved.get(`${runtime.id}:${model.id}`)
            const measured = name === undefined ? efforts : `${name} · ${efforts}`
            // What the CATALOGUE said about this model, first. For OpenCode's
            // free models that is "Free · no sign-in", which its own comment
            // calls the whole reason the runtime is here -- and it reached
            // nobody, because a row's detail was built from the effort count
            // and the resolved name alone. A person with no account read
            // eleven names and could not tell which cost nothing (QA,
            // 2026-09-06). Effort levels still follow it; they are the more
            // technical half and the less urgent one.
            const described = model.description
            return {
              model: model.id,
              /*
               * A ROW THAT IS STILL AN IDENTIFIER GETS SPELLED OUT.
               *
               * The catalogue falls back to the model's id when a runtime
               * reports no display name for it, so the picker printed
               * muse-spark-1.3-contributor-free in a list where every
               * other row read as a proper name -- and the composer chip
               * directly beside it read "Muse Spark 1.3 Contributor Free",
               * because the chip has gone through modelDisplayName since
               * Grok found the same inconsistency in mission rows (pass 1,
               * finding 1). The picker was the one untreated spot.
               *
               * Only when the label IS the id. A name the runtime actually
               * gave is left exactly as the runtime wrote it: this spells
               * identifiers, it does not restyle anybody's product name.
               */
              label: model.displayName === model.id ? modelDisplayName(runtime.id, model.id) : model.displayName,
              detail: described === undefined || described.length === 0 ? measured : `${described} · ${measured}`,
              // Carried so the chosen row can offer them; the detail line
              // above still NAMES them for every row.
            }
          })
        : // The catalogue could not be read for this runtime, so there is one
          // row and it is the account's own default. It is labelled the way
          // the catalogue labels it -- a person reading a lowercase
          // `account-default` on the only ACTIVE row is reading a placeholder
          // that leaked (outside review, 2026-09-07).
          [{ model: 'account-default', label: 'Account default', detail: status.detail }]

    for (const entry of entries) {
      const isActive = runtime.id === active.runtime && entry.model === active.model
      rows.push({
        key: `${runtime.id}:${entry.model}`,
        group,
        runtime: runtime.id as MissionRuntimeId,
        model: entry.model,
        label: entry.label,
        detail: entry.detail,
        // Carried explicitly: this object is rebuilt field by field, so a
        // property added to the entry above is dropped here unless it is
        // named -- which is exactly what happened first (drive, 2026-09-06:
        // the row's own detail said "5 effort levels" while the control
        // under it drew none).
        tag: routeRowTag(status, isActive),
        selectable: status.selectable
      })
    }
  }
  // Within each runtime: what this person has run, then the flagship
  // families, then the rest as the runtime listed them. The routes they move
  // between are then lifted to a group of their own at the top, because the
  // move this product exists for is between runtimes, not within one.
  const ordered = orderRouteRows(rows, recent)
  return [...recentRouteRows(ordered, recent), ...ordered]
}

/**
 * What to say when the picker is showing no rows.
 *
 * "Nothing matches that" is a claim about the SEARCH, and it must not be made
 * when the search is not why the list is empty.
 *
 * Seen walking the packaged 0.54.0 build as a new person would (2026-09-09):
 * open the picker, type `free`, and it answered "Nothing matches that." while
 * the status line read "6 runtimes connected". The model genuinely exists --
 * every other drive here selects it by that word -- but the catalog had not
 * arrived, and a person typing fast is told a model does not exist. It sent
 * that whole walkthrough to the wrong runtime without anyone noticing.
 *
 * The SAME defect 0.50.1 fixed on the effort chip, in a second place:
 * "effort · fixed" was drawn whenever the effort list was empty, which is also
 * what an unloaded catalog looks like. Neither surface may speak from having
 * no information.
 *
 * Extracted so it can be tested: the picker keeps its search in its own state,
 * so no test can reach this branch by rendering the component with a query.
 */
export function pickerEmptyMessage(modelCount: number): string {
  return modelCount === 0 ? 'Still reading the model list…' : 'Nothing matches that.'
}

export function RoutePicker({
  runtimes,
  models,
  resolvedModels,
  active,
  recentRoutes,
  onSelect,
  onClose,
  notice,
  limitedRuntimes
}: {
  readonly runtimes: readonly PublicRuntimeStatus[]
  /** Runtimes whose last run ended on the account's usage limit, with its own words. */
  readonly limitedRuntimes: ReadonlyMap<string, string>
  readonly models: readonly PublicModel[]
  /** What each route's model resolved to last time, keyed `runtime:model`. */
  readonly resolvedModels: ReadonlyMap<string, string>
  /** Routes this person has run, newest first, as `runtime:model`. */
  readonly recentRoutes: readonly string[]
  readonly active: RouteChoice
  readonly onSelect: (choice: RouteChoice) => void
  readonly onClose: () => void
  /**
   * Shown above the rows when picking has a consequence beyond the next
   * mission. The picker looks identical whether it is choosing a route or
   * moving a live run, so the difference has to be stated, not implied.
   */
  readonly notice?: string
  /**
   * Effort and swarm live here now, not on the composer.
   *
   * Effort is a property of the ROUTE, not a peer of it: on most routes the
   * old chip read "effort · fixed" -- a control whose value is "there is no
   * value here" -- while the picker was already listing each model's levels
   * in its detail line. And swarm DISABLED effort to hold it at the model
   * maximum, so two adjacent chips in the composer were one setting, with one
   * silently switching the other off (design review, 2026-09-06).
   *
   * Together they take the composer from seven controls to four.
   */
  /** The maximum level swarm would hold every mission at, when one is known. */
}): ReactElement {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const rows = useMemo(
    () => buildRows(runtimes, models, active, resolvedModels, recentRoutes, limitedRuntimes),
    [runtimes, models, active, resolvedModels, recentRoutes, limitedRuntimes]
  )
  const needle = routeSearchText(query)
  const matched = useMemo(
    () =>
      needle.length === 0
        ? rows
        : rows.filter((row) => routeSearchText(`${row.group} ${row.label}`).includes(needle)),
    [rows, needle]
  )
  // One runtime can list hundreds of models. Every group is capped until the
  // person searches, and each capped group says how many it is not showing.
  const { rows: shown, hiddenByGroup } = useMemo(
    () => capRouteRows(matched, ROUTE_GROUP_LIMIT, needle.length > 0),
    [matched, needle]
  )

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  let lastGroup: string | undefined

  return (
    <div className="lc-picker" role="dialog" aria-label="Choose runtime and model" onKeyDown={onKeyDown}>
      <div className="lc-picker__head">
        <span className="lc-mono lc-separator">/</span>
        <input
          ref={inputRef}
          className="lc-picker__input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search runtimes and models"
          aria-label="Search runtimes and models"
          autoComplete="off"
        />
        {/*
          * Swarm, as a pill beside the search rather than a row of its own.
          * It is a statement about how every mission runs, so it sits with
          * the thing it is about -- and the reference draws it small and to
          * the right, not full width (`Locust UI Review 2026-09-06.dc.html`).
          * The mark stays as its glyph.
          */}
        {/*
          * No swarm toggle here any more. The mark is back on the composer
          * where Colin wants it -- "it just looks cool, its our logo, and
          * feels like something the user should know is on" -- and two
          * toggles for one setting is the confusion the design review named
          * in the first place. What stays is the CONSEQUENCE, one line down:
          * the effort levels grey out and say who is holding them.
          */}
      </div>
      {notice !== undefined && <div className="lc-picker__notice">{notice}</div>}
      <div className="lc-picker__list">
        {shown.map((row, index) => {
          const header = row.group === lastGroup ? undefined : row.group
          lastGroup = row.group
          // The last row of a capped group carries the count it held back.
          const hidden = shown[index + 1]?.group === row.group ? 0 : hiddenByGroup.get(row.group) ?? 0
          const isActive = row.tag === 'ACTIVE'
          const recent = row.group === 'Recent'
          // Which runtime the canonical row below sits under, so a recent row
          // can say why it appears twice.
          const pointsAt = recent
            ? rows.find((other) => other.key === row.key.replace(/^recent:/, ''))?.group.replace(/ · your account$/, '')
            : undefined
          return (
            <div key={row.key} className={recent ? 'lc-picker__tray' : undefined}>
              {header !== undefined && (
                <div className="lc-picker__group">
                  {header}
                  {recent && <span className="lc-picker__grouphint">shortcuts to rows below</span>}
                </div>
              )}
              <button
                type="button"
                className={`lc-picker__row${isActive ? ' is-active' : ''}${recent ? ' is-recent' : ''}`}
                disabled={!row.selectable}
                aria-current={isActive}
                onClick={() => {
                  onSelect({ runtime: row.runtime, model: row.model })
                  onClose()
                }}
              >
                <span
                  className={`lc-dot ${
                    row.tag === 'ACTIVE'
                      ? 'lc-tone-lime'
                      : row.tag === 'READY'
                        ? 'lc-tone-green'
                        : row.tag === 'PREVIEW' || row.tag === 'EXPERIMENTAL' || row.tag === 'AT LIMIT'
                          ? 'lc-tone-amber'
                          : 'lc-tone-muted'
                  }`}
                />
                <span className="lc-picker__text">
                  <span className="lc-picker__label">{row.label}</span>
                  {/* A shortcut row carries neither detail nor tag: the
                    * canonical row below owns those, so ACTIVE appears exactly
                    * once on screen. */}
                  {!recent && <span className="lc-picker__detail lc-mono">{row.detail}</span>}
                </span>
                {recent ? (
                  pointsAt === undefined ? null : (
                    <span className="lc-picker__pointer lc-mono">{`↓ ${pointsAt}`}</span>
                  )
                ) : (
                <span
                  className={`lc-picker__tag lc-mono ${
                    row.tag === 'ACTIVE'
                      ? 'lc-tone-lime'
                      : row.tag === 'PREVIEW' || row.tag === 'EXPERIMENTAL'
                        ? 'lc-tone-amber'
                        : row.tag === 'SIGN IN'
                          ? 'lc-tone-red'
                          : 'lc-tone-muted'
                  }`}
                >
                  {row.tag}
                </span>
                )}
              </button>
              {/*
                * No effort control here. It lived under the selected model
                * for one release and was removed on Colin's word
                * (2026-09-07): "just go back to effort being separate,
                * completely remove it from the model page". Each row's
                * detail line still NAMES the levels a model reports, which
                * is information; choosing between them is the composer's
                * job, next to the model it applies to.
                */}
              {hidden > 0 && (
                <p className="lc-picker__more lc-mono">
                  {hidden} more {hidden === 1 ? 'model' : 'models'} {needle.length > 0 ? 'match · keep typing' : '· type to search them'}
                </p>
              )}
            </div>
          )
        })}
        {/*
          * "Nothing matches that" is a claim about the SEARCH, and it must not
          * be made when the search is not why the list is empty.
          *
          * Seen walking the packaged 0.54.0 build as a new person would
          * (2026-09-09): open the picker, type `free`, and it answers "Nothing
          * matches that." while the status line reads "6 runtimes connected".
          * The model genuinely exists -- every other drive picks it by that
          * word -- but the catalog had not arrived yet, and a person typing
          * fast is told the model does not exist. It sent that whole
          * walkthrough to the wrong runtime.
          *
          * This is the SAME defect 0.50.1 fixed on the effort chip, in a
          * second place: "effort · fixed" was drawn whenever the effort list
          * was empty, which is also what an unloaded catalog looks like. An
          * empty list is not an answer, and neither of these surfaces may
          * speak from having no information.
          */}
        {shown.length === 0 && <p className="lc-inspector__empty">{pickerEmptyMessage(models.length)}</p>}
      </div>
      <div className="lc-picker__foot">
        Fallback chain, privacy and permissions live in Settings.
      </div>
    </div>
  )
}
