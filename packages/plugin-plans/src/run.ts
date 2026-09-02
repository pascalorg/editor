/**
 * One "Generate plans" run: scene → Plans API → sheets, narrated stage by
 * stage into the store. Mirrors workbench/pipeline.ts, minus the format
 * detection (the editor always hands us a SceneGraph).
 */
import { useScene } from '@pascal-app/core'
import { call, errorMessage, parseDocuments, readProjectIdentity, type SceneGraph, siteIsParcel } from './api'
import { captureViewport } from './snapshot'
import { usePlans } from './store'

const STAGES = [
  { id: 'health', label: 'Plans API reachable' },
  { id: 'scene', label: 'Read the open scene' },
  { id: 'snapshot', label: 'Capture the 3D view for the cover' },
  { id: 'validate', label: 'Validate the scene' },
  { id: 'enrich', label: 'Site enrichment (GIS parcel)' },
  { id: 'site', label: 'Place the lot on the scene' },
  { id: 'checks', label: 'Code checks' },
  { id: 'documents', label: 'Render the sheets' },
]

let running = false

export async function generatePlans(): Promise<void> {
  if (running) return
  running = true
  const S = usePlans.getState()
  const base = S.apiBase
  S.setOpen(true)
  S.begin(STAGES)
  const st = (id: string, patch: Parameters<typeof S.stage>[1]) => usePlans.getState().stage(id, patch)
  const startStage = (id: string) => st(id, { status: 'running' })

  try {
    // ---- 0. health ----
    startStage('health')
    const health = await call(base, '/v1/health', undefined, 'GET').catch((e: Error) => ({ ok: false, status: 0, body: { error: { code: 'unreachable', message: e.message } }, ms: 0 }))
    if (!health.ok) {
      st('health', { status: 'failed', ms: health.ms, detail: errorMessage(health), lines: [`Start it with: bash scripts/workbench.sh (plancrafters-pascal) — API base ${base}`] })
      throw new Error(`Plans API is not answering at ${base}`)
    }
    st('health', { status: 'ok', ms: health.ms, detail: `version ${String(health.body.version ?? '?')}` })

    // ---- 1. scene ----
    startStage('scene')
    const s = useScene.getState() as unknown as SceneGraph & { installedPlugins?: string[] }
    let graph: SceneGraph = {
      nodes: s.nodes,
      rootNodeIds: s.rootNodeIds,
      ...(s.collections !== undefined ? { collections: s.collections } : {}),
      ...(s.materials !== undefined ? { materials: s.materials } : {}),
      ...(s.installedPlugins !== undefined ? { installedPlugins: s.installedPlugins } : {}),
    }
    const identity = readProjectIdentity(graph)
    const site = siteIsParcel(graph)
    const nodeCount = Object.keys(graph.nodes).length
    st('scene', {
      status: 'ok',
      detail: `${nodeCount} nodes${identity.name ? ` · ${identity.name}` : ''}${identity.address ? ` · ${identity.address}` : ''}`,
      lines: [
        site.hasSite ? (site.isParcel ? `site is a recorded parcel${site.apn ? ` (APN ${site.apn})` : ''}` : 'site node present but not a recorded parcel') : 'no site node on the scene',
        identity.address ? `project address: ${identity.address}` : 'no project address on the scene — GIS enrichment will be skipped (add a plancrafters:project node or resolve the site first)',
      ],
    })

    // ---- 2. snapshot ----
    startStage('snapshot')
    const snap = await captureViewport()
    usePlans.getState().setSnapshot(snap)
    st('snapshot', snap ? { status: 'ok', detail: `${Math.round(snap.length / 1024)} KB jpeg` } : { status: 'skipped', detail: 'viewport had no drawn frame — cover keeps its vector views' })

    // ---- 3. validate ----
    startStage('validate')
    const v = await call(base, '/v1/plans/validate', { graph })
    const violations = (v.body.violations as { message?: string }[] | undefined) ?? []
    const dropped = (v.body.dropped as unknown[] | undefined) ?? []
    st('validate', {
      status: v.ok ? 'ok' : 'failed',
      ms: v.ms,
      detail: v.ok ? `${violations.length} violations · ${dropped.length} dropped` : errorMessage(v),
      lines: violations.slice(0, 8).map((x) => String((x as { message?: string }).message ?? JSON.stringify(x))),
    })

    // ---- 4/5. enrich + place the lot (only when the scene has no recorded parcel yet) ----
    let project: Record<string, unknown> | undefined
    if (site.isParcel) {
      st('enrich', { status: 'skipped', detail: 'scene already carries a recorded parcel' })
      st('site', { status: 'skipped', detail: 'nothing to place' })
    } else if (!identity.address) {
      st('enrich', { status: 'skipped', detail: 'no address on the scene' })
      st('site', { status: 'skipped', detail: 'no parcel to place' })
    } else {
      startStage('enrich')
      const en = await call(base, '/v1/intake/enrich', { address: identity.address, gis: true })
      if (!en.ok) {
        st('enrich', { status: 'failed', ms: en.ms, detail: errorMessage(en) })
        st('site', { status: 'skipped', detail: 'enrichment failed' })
      } else {
        project = en.body.project as Record<string, unknown> | undefined
        const siteBlock = en.body.site as Record<string, unknown> | undefined
        const parcel = (siteBlock?.parcel ?? null) as { apn?: string; county?: string; lotAreaSqFt?: number } | null
        const unavailable = siteBlock?.parcelUnavailable as { reason?: string } | undefined
        st('enrich', {
          status: 'ok',
          ms: en.ms,
          detail: parcel ? `parcel ${parcel.apn ?? '?'} · ${parcel.county ?? ''} · ${Math.round(parcel.lotAreaSqFt ?? 0).toLocaleString()} sqft` : `no parcel: ${unavailable?.reason ?? 'unresolved'}`,
          lines: ((siteBlock?.notes as string[] | undefined) ?? []).slice(0, 4),
        })
        if (siteBlock && parcel) {
          startStage('site')
          const ap = await call(base, '/v1/site/apply-parcel', { graph, site: siteBlock })
          if (ap.ok && ap.body.applied && ap.body.graph) {
            graph = ap.body.graph as SceneGraph
            const p = ap.body.parcel as { apn?: string; ringCount?: number; containsPoint?: boolean } | undefined
            st('site', { status: 'ok', ms: ap.ms, detail: `placed APN ${p?.apn ?? '?'} (${p?.ringCount ?? 1} ring${p?.ringCount === 1 ? '' : 's'}${p?.containsPoint === false ? ', point outside — verify' : ''})` })
          } else {
            st('site', { status: 'failed', ms: ap.ms, detail: ap.ok ? String(ap.body.reason ?? 'not applied') : errorMessage(ap) })
          }
        } else {
          st('site', { status: 'skipped', detail: 'no parcel to place' })
        }
      }
    }

    // ---- 6. checks ----
    startStage('checks')
    const ck = await call(base, '/v1/plans/checks', { graph, ...(project ? { project } : {}) })
    const counts = (ck.body.counts as { error?: number; warn?: number; info?: number } | undefined) ?? {}
    const findings = (ck.body.findings as { severity?: string; message?: string; title?: string }[] | undefined) ?? []
    st('checks', {
      status: ck.ok ? 'ok' : 'failed',
      ms: ck.ms,
      detail: ck.ok ? `${counts.error ?? 0} errors · ${counts.warn ?? 0} warnings · ${counts.info ?? 0} info` : errorMessage(ck),
      lines: findings.filter((f) => f.severity === 'error').slice(0, 8).map((f) => `✗ ${f.title ?? ''} ${f.message ?? ''}`.trim()),
    })

    // ---- 7. documents ----
    startStage('documents')
    const doc = await call(base, '/v1/plans/documents?engine=plancrafters', {
      graph,
      ...(project ? { project } : {}),
      options: { computeEnergy: true, ...(identity.name ? { projectName: identity.name } : {}), ...(snap ? { coverImage: snap } : {}) },
    })
    if (!doc.ok) {
      st('documents', { status: 'failed', ms: doc.ms, detail: errorMessage(doc), lines: ((doc.body.violations as { message?: string }[] | undefined) ?? []).slice(0, 6).map((x) => String(x.message ?? '')) })
      throw new Error(errorMessage(doc))
    }
    const result = parseDocuments(doc.body)
    st('documents', {
      status: 'ok',
      ms: doc.ms,
      detail: `${result.sheets.length} sheets${result.setSize ? ` (set of ${result.setSize})` : ''}${result.skipped.length ? ` · ${result.skipped.length} skipped` : ''}${result.draft?.watermarked ? ' · DRAFT watermark' : ''}`,
      lines: [
        ...result.skipped.map((k) => `skipped ${k.id}: ${k.reason}`),
        ...(result.draft?.watermarked ? [`draft because: ${result.draft.because ?? result.draft.missing.join(', ')}`] : []),
        ...result.warnings.slice(0, 6),
      ],
    })
    usePlans.getState().finish(result)
  } catch (e) {
    usePlans.getState().fail(e instanceof Error ? e.message : String(e))
  } finally {
    running = false
  }
}
