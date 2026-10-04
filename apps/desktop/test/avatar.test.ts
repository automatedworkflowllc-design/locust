import { describe, expect, it } from 'vitest'

import {
  ACCESSORY_COUNT,
  chipRadius,
  facePixelSize,
  HEADWEAR_COUNT,
  isAvatarSpec,
  layerGeometry,
  MOUTH_COUNT,
  seedAvatar,
  shuffledAvatar
} from '../src/shared/avatar.js'

describe('avatar seeding', () => {
  it('is a pure function of the id, so a rename never changes a face', () => {
    expect(seedAvatar('tm_abc123')).toEqual(seedAvatar('tm_abc123'))
  })

  it('gives two teammates with different ids different faces, whatever their names', () => {
    const ids = Array.from({ length: 40 }, (_, index) => `tm_${index.toString(16).padStart(24, '0')}`)
    const faces = new Set(ids.map((id) => JSON.stringify(seedAvatar(id))))
    // 72 distinct looks per hue; 40 random ids landing on fewer than 20 of
    // them would mean the byte windows are not independent.
    expect(faces.size).toBeGreaterThan(20)
  })

  it('stays within every part table', () => {
    for (let index = 0; index < 200; index += 1) {
      const face = seedAvatar(`tm_${index}`)
      expect(face.headwear).toBeLessThan(HEADWEAR_COUNT)
      expect(face.accessory).toBeLessThan(ACCESSORY_COUNT)
      expect(face.mouth).toBeLessThan(MOUTH_COUNT)
      expect(isAvatarSpec(face)).toBe(true)
    }
  })

  it('refuses an override outside the tables', () => {
    expect(isAvatarSpec({ headwear: 6, accessory: 0, mouth: 0 })).toBe(false)
    expect(isAvatarSpec({ headwear: 1.5, accessory: 0, mouth: 0 })).toBe(false)
    expect(isAvatarSpec({ headwear: 0, accessory: -1, mouth: 0 })).toBe(false)
    expect(isAvatarSpec({ headwear: 0, accessory: 0 })).toBe(false)
    expect(isAvatarSpec('lime')).toBe(false)
  })

  it('shuffles to a different look every time, cycling through all of them', () => {
    let face = seedAvatar('tm_shuffle')
    const seen = new Set<string>()
    for (let index = 0; index < 12; index += 1) {
      const next = shuffledAvatar(face)
      expect(next).not.toEqual(face)
      seen.add(JSON.stringify(next))
      face = next
    }
    expect(seen.size).toBe(12)
  })
})

describe('avatar geometry', () => {
  it('sizes pixels and corners as the spec states, floored so small chips still draw', () => {
    expect(facePixelSize(16)).toBe(2)
    expect(facePixelSize(32)).toBe(3)
    expect(facePixelSize(56)).toBe(5)
    expect(chipRadius(16)).toBe(4)
    expect(chipRadius(56)).toBe(9)
  })

  it('draws a layer as one base pixel plus shadow offsets from it', () => {
    const geometry = layerGeometry([[4, 6], [10, 6]], 3, '#000')
    expect(geometry).toEqual({ left: 6, top: 9, shadow: '9px 0px 0 #000' })
    expect(layerGeometry([], 3, '#000')).toBeUndefined()
    expect(layerGeometry([[6, 10]], 3, '#000')?.shadow).toBe('')
  })
})
