import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createTeammateStore } from './teammate-store.js'

/**
 * THE FINANCES PLACE IS KEPT (0.501). Switched on in Settings, it is still on
 * after a restart; every other setting's write -- each sends its whole set,
 * without this one -- leaves it as it was; and only a literal true turns it on.
 */
const roots: string[] = []
const store = async (root?: string) => {
  const at = root ?? await mkdtemp(join(tmpdir(), 'locust-finances-place-'))
  roots.push(at)
  return { at, teammates: createTeammateStore({ rootDirectory: at }) }
}
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('the Finances place setting', () => {
  it('is off until switched on, and on again after a restart', async () => {
    const { at, teammates } = await store()
    expect((await teammates.readSettings()).financesPlace).toBeUndefined()
    expect((await teammates.writeSettings({ financesPlace: true })).financesPlace).toBe(true)
    const { teammates: again } = await store(at)
    expect((await again.readSettings()).financesPlace).toBe(true)
  })

  it('stays on through another setting written without it', async () => {
    const { teammates } = await store()
    await teammates.writeSettings({ financesPlace: true })
    await teammates.writeSettings({ autoMode: true })
    expect((await teammates.readSettings()).financesPlace).toBe(true)
  })

  it('turns off, and is never turned on by anything but true', async () => {
    const { teammates } = await store()
    await teammates.writeSettings({ financesPlace: true })
    expect((await teammates.writeSettings({ financesPlace: false })).financesPlace).toBeUndefined()
    expect((await teammates.writeSettings({ financesPlace: 'yes' })).financesPlace).toBeUndefined()
  })
})
