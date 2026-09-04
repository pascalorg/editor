'use client'

import { useEffect } from 'react'

// Pre-split-era single-page anchors that now live on /docs. Landing-local
// anchors (#main skip link) and unknown hashes must NOT bounce.
const LEGACY_SECTIONS = new Set([
  'introduction',
  'installation',
  'parse',
  'strictness',
  'escalation',
  'forms',
  'coverage',
  'integrations',
  'for',
  'for-ai',
  'api',
  'agents',
  'performance',
])

export function LegacyHashRedirect() {
  useEffect(() => {
    const hash = window.location.hash.slice(1)
    const section = hash.split('-')[0] ?? ''
    if (!LEGACY_SECTIONS.has(section)) {
      return
    }
    window.location.replace(`/docs#${hash}`)
  }, [])

  return null
}
