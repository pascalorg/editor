import type { Zone } from '../../schema'
import type { SceneState } from '../use-scene'

export const createZonesAction = (
  set: (fn: (state: SceneState) => Partial<SceneState>) => void,
  _get: () => SceneState,
  zones: Zone[],
) => {
  set((state) => {
    const nextZones = { ...state.zones }
    const nextZoneIds = [...state.zoneIds]

    for (const zone of zones) {
      nextZones[zone.id] = zone

      if (!nextZoneIds.includes(zone.id)) {
        nextZoneIds.push(zone.id)
      }
    }

    return { zones: nextZones, zoneIds: nextZoneIds }
  })
}

export const updateZonesAction = (
  set: (fn: (state: SceneState) => Partial<SceneState>) => void,
  _get: () => SceneState,
  updates: { id: Zone['id']; data: Partial<Zone> }[],
) => {
  set((state) => {
    const nextZones = { ...state.zones }

    for (const { id, data } of updates) {
      const currentZone = nextZones[id]
      if (!currentZone) continue

      nextZones[id] = { ...currentZone, ...data }
    }

    return { zones: nextZones }
  })
}

export const deleteZonesAction = (
  set: (fn: (state: SceneState) => Partial<SceneState>) => void,
  _get: () => SceneState,
  ids: Zone['id'][],
) => {
  set((state) => {
    const nextZones = { ...state.zones }
    let nextZoneIds = [...state.zoneIds]

    for (const id of ids) {
      delete nextZones[id]
      nextZoneIds = nextZoneIds.filter((zid) => zid !== id)
    }

    return { zones: nextZones, zoneIds: nextZoneIds }
  })
}
