import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { hasTranslation } from '../../../../../lib/i18n-core'

/**
 * The parcel and zoning surfaces are the copy-heaviest thing in the app, and a
 * string that never reached the dictionary fails silently — it just renders in
 * English on a Turkish-default product. These two tests are the acceptance
 * criterion of #63 in executable form.
 */

const SURFACE_FILES = ['parcel-importer.tsx', 'parcel-section.tsx', 'zoning-section.tsx']

describe('parcel surface copy', () => {
  test('every t() string in the parcel surfaces has a Turkish entry', () => {
    const seen: string[] = []
    const untranslated: string[] = []
    for (const file of SURFACE_FILES) {
      const source = readFileSync(join(import.meta.dir, file), 'utf8')
      for (const match of source.matchAll(/\bt\((['"])((?:(?!\1)[^\\]|\\.)*)\1\)/g)) {
        const text = match[2]!.replace(/\\'/g, "'").replace(/\\"/g, '"')
        seen.push(text)
        if (!hasTranslation(text)) untranslated.push(text)
      }
    }
    // A scan that matched nothing would pass vacuously, which is the one way
    // this test could quietly stop guarding anything.
    expect(seen.length).toBeGreaterThan(15)
    expect(untranslated).toEqual([])
  })

  test('the panel copy rendered as plain JSX text is translated', () => {
    // These are written as bare children, so `translateReactNode` reaches them
    // through PanelSection rather than through a t() call the scan above sees.
    const copy = [
      'Parcel',
      'Location',
      'Block / parcel',
      'Quality',
      'Sheet',
      'Registered area',
      'Measured area',
      'Land registry reference data — not a surveyed site plan.',
      'Edited by hand — no longer the registry outline.',
      'Setbacks',
      'Edge',
      'Road',
      'Neighbour',
      'Rear',
      'Distance',
      'Apply to all edges',
      'Parcel area',
      'Buildable area',
      'No buildable ground is left after these setbacks.',
      "The presets are common values. The binding distances are the ones on your municipality's zoning certificate.",
      'Zoning Limits',
      'KAKS (Emsal)',
      'Floors',
      'Height',
      'Building Status',
      'Footprint (TAKS)',
      'Total Area (KAKS)',
      'Current design exceeds zoning limits.',
    ]
    expect(copy.filter((text) => !hasTranslation(text))).toEqual([])
  })
})
