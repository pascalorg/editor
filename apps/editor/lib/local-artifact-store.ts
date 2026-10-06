'use client'

import { type ArtifactStore, configureArtifactStore, getArtifactStore } from '@pascal-app/core'
import { useEffect } from 'react'

const artifactUrl = (sha256: string) => `/api/artifacts/${sha256}`
const localArtifactStore: ArtifactStore = {
  url: artifactUrl,
  put: async (sha256, bytes, mimeType) => {
    const response = await fetch(artifactUrl(sha256), {
      method: 'PUT',
      headers: { 'content-type': mimeType },
      body: bytes as BodyInit,
    })
    if (!response.ok) throw new Error(`Artifact save failed (${response.status})`)
  },
  text: async (sha256) => {
    const response = await fetch(artifactUrl(sha256))
    return response.ok ? response.text() : null
  },
}

export function useLocalArtifactStore(): void {
  if (getArtifactStore() !== localArtifactStore) configureArtifactStore(localArtifactStore)
  useEffect(() => {
    configureArtifactStore(localArtifactStore)
    return () => {
      if (getArtifactStore() === localArtifactStore) configureArtifactStore(null)
    }
  }, [])
}
