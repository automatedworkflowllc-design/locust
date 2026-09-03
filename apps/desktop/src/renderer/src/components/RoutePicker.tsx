import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, ReactElement } from 'react'

import type { MissionRuntimeId } from '@teammate/runtime-adapters'
import type { PublicModel, PublicRuntimeStatus } from '../../../shared/ipc.js'
import { ROUTE_GROUP_LIMIT, capRouteRows, integrationOf, orderRouteRows, routeRowStatus, routeRowTag, routeSearchText } from '../status.js'
import type { RouteTag } from '../status.js'

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
  recent: readonly string[]
): readonly RouteRow[] {
  const rows: RouteRow[] = []
  for (const runtime of runtimes) {
    if (runtime.id === 'omniroute') continue
    const integration = integrationOf(runtime.id)
    const status = routeRowStatus(runtime, integration, false)
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
                ? `${model.supportedEfforts.length} effort levels · ${model.supportedEfforts.join(', ')}`
                : 'no effort levels reported'
            // The name the runtime itself reported the last time a mission ran
            // on this route. Absent until one has, which is the honest state.
            const name = resolved.get(`${runtime.id}:${model.id}`)
            return {
              model: model.id,
              label: model.displayName,
              detail: name === undefined ? efforts : `${name} · ${efforts}`
            }
          })
        : [{ model: 'account-default', label: 'account-default', detail: status.detail }]

    for (const entry of entries) {
      const isActive = runtime.id === active.runtime && entry.model === active.model
      rows.push({
        key: `${runtime.id}:${entry.model}`,
        group,
        runtime: runtime.id as MissionRuntimeId,
        model: entry.model,
        label: entry.label,
        detail: entry.detail,
        tag: routeRowTag(status, isActive),
        selectable: status.selectable
      })
    }
  }
  // Within each runtime: what this person has run, then the flagship
  // families, then the rest as the runtime listed them.
  return orderRouteRows(rows, recent)
}

export function RoutePicker({
  runtimes,
  models,
  resolvedModels,
  active,
  recentRoutes,
  onSelect,
  onClose,
  notice
}: {
  readonly runtimes: readonly PublicRuntimeStatus[]
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
}): ReactElement {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const rows = useMemo(
    () => buildRows(runtimes, models, active, resolvedModels, recentRoutes),
    [runtimes, models, active, resolvedModels, recentRoutes]
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
      </div>
      {notice !== undefined && <div className="lc-picker__notice">{notice}</div>}
      <div className="lc-picker__list">
        {shown.map((row, index) => {
          const header = row.group === lastGroup ? undefined : row.group
          lastGroup = row.group
          // The last row of a capped group carries the count it held back.
          const hidden = shown[index + 1]?.group === row.group ? 0 : hiddenByGroup.get(row.group) ?? 0
          const isActive = row.tag === 'ACTIVE'
          return (
            <div key={row.key}>
              {header !== undefined && <div className="lc-picker__group">{header}</div>}
              <button
                type="button"
                className={`lc-picker__row${isActive ? ' is-active' : ''}`}
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
                        : row.tag === 'PREVIEW' || row.tag === 'EXPERIMENTAL'
                          ? 'lc-tone-amber'
                          : 'lc-tone-muted'
                  }`}
                />
                <span className="lc-picker__text">
                  <span className="lc-picker__label">{row.label}</span>
                  <span className="lc-picker__detail lc-mono">{row.detail}</span>
                </span>
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
              </button>
              {hidden > 0 && (
                <p className="lc-picker__more lc-mono">
                  {hidden} more {hidden === 1 ? 'model' : 'models'} · type to search them
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
