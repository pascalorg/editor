/**
 * Runs against the Plans API.
 *
 *   generatePlans()          the whole set: scene → (find + place the parcel
 *                            when the project has an address and no parcel
 *                            yet) → checks → documents
 *   regenerateSheets(nums)   the same request for a few sheets after a site
 *                            edit — the API still lays out the whole set and
 *                            draws only these, so the set stays consistent
 *
 * Every stage logs what the API actually said.
 */
import { useScene } from '@pascal-app/core'
import { call, errorMessage, parseDocuments, type SceneGraph, siteIsParcel } from './api'
import { absorbDerivedRecord, addressLine, hasRecord, readProjectRecord } from './project'
import { captureViewport } from './snapshot'
import { usePlans } from './store'

const STAGES = [
  { id: 'health', label: 'Plans service' },
  { id: 'scene', label: 'Read the scene' },
  { id: 'snapshot', label: '3D view for the cover' },
  { id: 'validate', label: 'Validate' },
  { id: 'enrich', label: 'Find the parcel' },
  { id: 'site', label: 'Place the lot' },
  { id: 'checks', label: 'Code checks' },
  { id: 'documents', label: 'Draw the sheets' },
]

let running = false

function readGraph(): SceneGraph {
  const s = useScene.getState() as unknown as SceneGraph & { installedPlugins?: string[] }
  return {
    nodes: s.nodes,
    rootNodeIds: s.rootNodeIds,
    ...(s.collections !== undefined ? { collections: s.collections } : {}),
    ...(s.materials !== undefined ? { materials: s.materials } : {}),
    ...(s.installedPlugins !== undefined ? { installedPlugins: s.installedPlugins } : {}),
  }
}

function documentOptions(snapshot: string | undefined): Record<string, unknown> {
  const { settings } = usePlans.getState()
  const rec = readProjectRecord()
  const name = rec.identity?.projectName
  return {
    computeEnergy: settings.energySheet,
    elevations: settings.elevations,
    sections: settings.sections,
    ...(name ? { projectName: name } : {}),
    ...(settings.date.trim() ? { date: settings.date.trim() } : {}),
    ...(settings.drawnBy.trim() ? { drawnBy: settings.drawnBy.trim() } : {}),
    ...(snapshot && settings.coverFromView ? { coverImage: snapshot } : {}),
  }
}

export async function generatePlans(): Promise<void> {
  if (running) return
  running = true
  const S = usePlans.getState()
  const base = S.apiBase
  S.setOpen(true)
  S.begin(STAGES)
  const st = (id: string, patch: Parameters<typeof S.stage>[1]) => usePlans.getState().stage(id, patch)
  const start = (id: string) => st(id, { status: 'running' })

  try {
    start('health')
    const health = await call(base, '/v1/health', undefined, 'GET').catch((e: Error) => ({ ok: false, status: 0, body: { error: { code: 'unreachable', message: e.message } }, ms: 0 }))
    if (!health.ok) {
      st('health', { status: 'failed', ms: health.ms, detail: errorMessage(health), lines: [`The Plans service is not answering at ${base}. Start it (plancrafters-pascal: bash scripts/dev-all.sh) or change the address under Settings → Advanced.`] })
      throw new Error(`The Plans service is not answering at ${base}`)
    }
    st('health', { status: 'ok', ms: health.ms, detail: `version ${String((health.body as Record<string, unknown>).version ?? '?')}` })

    start('scene')
    let graph = readGraph()
    const rec = readProjectRecord()
    const address = addressLine(rec)
    const site = siteIsParcel(graph)
    st('scene', {
      status: 'ok',
      detail: `${Object.keys(graph.nodes).length} nodes${rec.identity?.projectName ? ` · ${rec.identity.projectName}` : ''}`,
      lines: [
        site.hasSite ? (site.isParcel ? `site is a recorded parcel${site.apn ? ` (APN ${site.apn})` : ''}` : 'site is a drawn polygon, not a recorded parcel') : 'no site node on the scene',
        address ? `address: ${address}` : 'no address on the project — enter one under Project to find the parcel',
      ],
    })

    start('snapshot')
    const snap = usePlans.getState().settings.coverFromView ? await captureViewport() : undefined
    usePlans.getState().setSnapshot(snap)
    st('snapshot', snap ? { status: 'ok', detail: `${Math.round(snap.length / 1024)} KB` } : { status: 'skipped', detail: usePlans.getState().settings.coverFromView ? 'the viewport had no drawn frame' : 'off in settings' })

    start('validate')
    const v = await call(base, '/v1/plans/validate', { graph })
    const violations = (v.body.violations as { message?: string }[] | undefined) ?? []
    st('validate', { status: v.ok ? 'ok' : 'failed', ms: v.ms, detail: v.ok ? `${violations.length} issue${violations.length === 1 ? '' : 's'}` : errorMessage(v), lines: violations.slice(0, 8).map((x) => String(x.message ?? '')) })

    if (site.isParcel) {
      st('enrich', { status: 'skipped', detail: 'the scene already carries a recorded parcel' })
      st('site', { status: 'skipped', detail: 'nothing to place' })
    } else if (!address) {
      st('enrich', { status: 'skipped', detail: 'no address yet' })
      st('site', { status: 'skipped', detail: 'no parcel to place' })
    } else {
      start('enrich')
      const en = await call(base, '/v1/intake/enrich', { address, gis: true })
      if (!en.ok) {
        st('enrich', { status: 'failed', ms: en.ms, detail: errorMessage(en) })
        st('site', { status: 'skipped', detail: 'lookup failed' })
      } else {
        // what the lookup learned (jurisdiction, climate, codes) is saved UNDER what was typed
        absorbDerivedRecord(en.body.project)
        const siteBlock = en.body.site as Record<string, unknown> | undefined
        const parcel = (siteBlock?.parcel ?? null) as { apn?: string; county?: string; lotAreaSqFt?: number } | null
        const unavailable = siteBlock?.parcelUnavailable as { reason?: string } | undefined
        st('enrich', {
          status: 'ok',
          ms: en.ms,
          detail: parcel ? `APN ${parcel.apn ?? '?'} · ${parcel.county ?? ''} · ${Math.round(parcel.lotAreaSqFt ?? 0).toLocaleString()} sq ft` : `no parcel: ${unavailable?.reason ?? 'unresolved'}`,
          lines: ((siteBlock?.notes as string[] | undefined) ?? []).slice(0, 4),
        })
        if (siteBlock && parcel) {
          start('site')
          const ap = await call(base, '/v1/site/apply-parcel', { graph, site: siteBlock })
          if (ap.ok && ap.body.applied && ap.body.graph) {
            // write the lot back into the OPEN scene so it is saved with the file
            const applied = ap.body.graph as SceneGraph
            const sc = useScene.getState() as unknown as { updateNode: (id: string, d: Record<string, unknown>) => void }
            for (const [id, node] of Object.entries(applied.nodes)) {
              const n = node as { type?: string; polygon?: unknown; metadata?: unknown }
              if (n?.type === 'site') sc.updateNode(id, { polygon: n.polygon, metadata: n.metadata })
            }
            graph = readGraph()
            const p = ap.body.parcel as { apn?: string; containsPoint?: boolean } | undefined
            st('site', { status: 'ok', ms: ap.ms, detail: `placed APN ${p?.apn ?? '?'}${p?.containsPoint === false ? ' — the address point is outside the ring, verify' : ''}` })
          } else {
            st('site', { status: 'failed', ms: ap.ms, detail: ap.ok ? String(ap.body.reason ?? 'not applied') : errorMessage(ap) })
          }
        } else {
          st('site', { status: 'skipped', detail: 'no parcel to place' })
        }
      }
    }

    const record = readProjectRecord()
    const project = hasRecord(record) ? (record as Record<string, unknown>) : undefined

    start('checks')
    const ck = await call(base, '/v1/plans/checks', { graph, ...(project ? { project } : {}) })
    const counts = (ck.body.counts as { error?: number; warn?: number; info?: number } | undefined) ?? {}
    const findings = (ck.body.findings as { severity?: string; message?: string; title?: string }[] | undefined) ?? []
    st('checks', {
      status: ck.ok ? 'ok' : 'failed',
      ms: ck.ms,
      detail: ck.ok ? `${counts.error ?? 0} errors · ${counts.warn ?? 0} warnings · ${counts.info ?? 0} notes` : errorMessage(ck),
      lines: findings.filter((f) => f.severity === 'error').slice(0, 8).map((f) => `✗ ${f.title ?? ''} ${f.message ?? ''}`.trim()),
    })

    start('documents')
    const options = documentOptions(snap)
    const doc = await call(base, '/v1/plans/documents?engine=plancrafters', { graph, ...(project ? { project } : {}), options })
    if (!doc.ok) {
      st('documents', { status: 'failed', ms: doc.ms, detail: errorMessage(doc), lines: ((doc.body.violations as { message?: string }[] | undefined) ?? []).slice(0, 6).map((x) => String(x.message ?? '')) })
      throw new Error(errorMessage(doc))
    }
    const result = parseDocuments(doc.body)
    const { coverImage: _c, ...optionsSansImage } = options
    usePlans.getState().setLastRequest({ ...(project ? { project } : {}), options: optionsSansImage })
    st('documents', {
      status: 'ok',
      ms: doc.ms,
      detail: `${result.sheets.length} sheets${result.skipped.length ? ` · ${result.skipped.length} not shipped` : ''}${result.draft?.watermarked ? ' · DRAFT' : ''}`,
      lines: [...result.skipped.map((k) => `not shipped ${k.id}: ${k.reason}`), ...(result.draft?.watermarked ? [`draft because: ${result.draft.because ?? result.draft.missing.join(', ')}`] : [])],
    })
    usePlans.getState().finish(result)
  } catch (e) {
    usePlans.getState().fail(e instanceof Error ? e.message : String(e))
  } finally {
    running = false
  }
}

/**
 * Re-render a few sheets from the CURRENT scene with the last run's request.
 * Returns the API's message on failure, undefined on success.
 */
export async function regenerateSheets(numbers: string[]): Promise<string | undefined> {
  const S = usePlans.getState()
  if (!S.lastRequest) {
    await generatePlans()
    return undefined
  }
  if (S.rendering.length) return 'already rendering'
  S.setRendering(numbers)
  try {
    const graph = readGraph()
    const record = readProjectRecord()
    const project = hasRecord(record) ? (record as Record<string, unknown>) : S.lastRequest.project
    const wantsImage = numbers.some((n) => n === 'A0.0' || n === 'R1.0')
    const options = { ...documentOptions(wantsImage ? S.snapshot : undefined), sheets: numbers }
    const doc = await call(S.apiBase, '/v1/plans/documents?engine=plancrafters', { graph, ...(project ? { project } : {}), options })
    if (!doc.ok) return errorMessage(doc)
    usePlans.getState().replaceSheets(parseDocuments(doc.body).sheets)
    return undefined
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  } finally {
    usePlans.getState().setRendering([])
  }
}

/** Every sheet again (title block, notes) without the full pipeline. */
export async function regenerateAll(): Promise<string | undefined> {
  const S = usePlans.getState()
  if (!S.lastRequest || S.sheets.length === 0) {
    await generatePlans()
    return undefined
  }
  return regenerateSheets(S.sheets.map((s) => s.number))
}
