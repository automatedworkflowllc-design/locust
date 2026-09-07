import { useEffect, useMemo, useRef, useState } from 'react'
import mark from '../assets/locust-mark.svg'
import type { KeyboardEvent, ReactElement } from 'react'

import type { MissionRuntimeId } from '@teammate/runtime-adapters'
import type { PublicModel, PublicRuntimeStatus } from '../../../shared/ipc.js'
import { ROUTE_GROUP_LIMIT, capRouteRows, integrationOf, orderRouteRows, recentRouteRows, routeRowStatus, routeRowTag, routeSearchText } from '../status.js'
import type { RouteTag } from '../status.js'

export interface RouteChoice {
  readonly runtime: MissionRuntimeId
  /** The model identifier a mission would actually be started with. */
  readonly model: string
}

interface RouteRow {
  /** The levels this model reports, for the chosen row's effort control. */
  readonly efforts?: readonly string[]
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
    const group = `${runtime.displayName} · your account`

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
              label: model.displayName,
              detail: described === undefined || described.length === 0 ? measured : `${described} · ${measured}`,
              // Carried so the chosen row can offer them; the detail line
              // above still NAMES them for every row.
              efforts: model.supportedEfforts
            }
          })
        : [{ model: 'account-default', label: 'account-default', detail: status.detail, efforts: [] }]

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
        efforts: entry.efforts,
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

export function RoutePicker({
  runtimes,
  models,
  resolvedModels,
  active,
  recentRoutes,
  onSelect,
  onClose,
  notice,
  limitedRuntimes,
  effort,
  onEffortChange,
  swarm,
  onSwarmChange,
  swarmEffort
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
  readonly effort: string | undefined
  readonly onEffortChange: (effort: string | undefined) => void
  readonly swarm: boolean
  readonly onSwarmChange: (swarm: boolean) => void
  /** The maximum level swarm would hold every mission at, when one is known. */
  readonly swarmEffort: string | undefined
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
          * Drawn ALWAYS. Gating it on the selected route reporting effort
          * levels meant a route that reports none had no swarm control at
          * all -- and since the composer chip that used to carry it was
          * removed in this same pass, the setting became unreachable rather
          * than merely relocated. "account-default", the route a fresh
          * profile starts on, is exactly such a route, so this hit a new
          * person on first open (measured 2026-09-07).
          */}
        <button
          type="button"
          className={`lc-picker__swarm${swarm ? ' is-on' : ''}`}
          aria-pressed={swarm}
          title={
            swarm
              ? swarmEffort === undefined
                ? 'Every mission runs at its model maximum'
                : `Every mission runs at ${swarmEffort}`
              : 'Run every mission at its model maximum'
          }
          onClick={() => onSwarmChange(!swarm)}
        >
          <img src={mark} alt="" aria-hidden="true" />
          Swarm
        </button>
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
                * Effort, under the model it belongs to, and ONLY under the one
                * currently chosen. It used to be a chip in the composer that
                * read "effort · fixed" on most routes -- a control announcing
                * it had nothing to say -- while this list was already
                * printing each model's levels in the line above.
                *
                * Drawn only where there are levels to choose between: a
                * runtime that reports none needs no row, which is the same
                * rule the composer's chip failed to follow.
                */}
              {isActive && !recent && row.efforts !== undefined && row.efforts.length > 0 && (
                <div className="lc-picker__efforts" role="group" aria-label="Reasoning effort">
                  {swarm ? (
                    <span className="lc-picker__effortheld lc-mono">
                      held at {swarmEffort} by swarm
                    </span>
                  ) : (
                    row.efforts.map((level) => (
                      <button
                        key={level}
                        type="button"
                        className={`lc-picker__effort lc-mono${effort === level ? ' is-on' : ''}`}
                        aria-pressed={effort === level}
                        onClick={() => onEffortChange(effort === level ? undefined : level)}
                      >
                        {level}
                      </button>
                    ))
                  )}
                </div>
              )}
              {hidden > 0 && (
                <p className="lc-picker__more lc-mono">
                  {hidden} more {hidden === 1 ? 'model' : 'models'} {needle.length > 0 ? 'match · keep typing' : '· type to search them'}
                </p>
              )}
            </div>
          )
        })}
        {shown.length === 0 && <p className="lc-inspector__empty">Nothing matches that.</p>}
      </div>
      <div className="lc-picker__foot">
        Fallback chain, privacy and permissions live in Settings.
      </div>
    </div>
  )
}
