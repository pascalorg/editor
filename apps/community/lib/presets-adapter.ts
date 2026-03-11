import type { PresetsAdapter } from '@pascal-app/editor'

export function createApiPresetsAdapter(isAuthenticated: boolean): PresetsAdapter {
  return {
    tabs: ['community', 'mine'],
    isAuthenticated,
    fetchPresets: async (type, tab) => {
      const res = await fetch(`/api/presets?type=${type}&tab=${tab}`)
      if (!res.ok) return []
      const json = await res.json()
      return json.presets ?? []
    },
    savePreset: async (type, name, data) => {
      const res = await fetch('/api/presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, name, data }),
      })
      if (!res.ok) return null
      const json = await res.json()
      return json.preset?.id ?? null
    },
    overwritePreset: async (_type, id, data) => {
      await fetch(`/api/presets/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data }),
      })
    },
    renamePreset: async (id, name) => {
      await fetch(`/api/presets/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
    },
    deletePreset: async (id) => {
      await fetch(`/api/presets/${id}`, { method: 'DELETE' })
    },
    togglePresetCommunity: async (id, current) => {
      await fetch(`/api/presets/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_community: !current }),
      })
    },
    uploadPresetThumbnail: async (presetId, blob) => {
      const res = await fetch(`/api/presets/${presetId}/thumbnail`, {
        method: 'POST',
        body: blob,
        headers: { 'Content-Type': 'image/png' },
      })
      if (!res.ok) return null
      const json = await res.json()
      return json.thumbnail_url ?? null
    },
  }
}
