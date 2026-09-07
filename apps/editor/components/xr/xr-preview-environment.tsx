'use client'

import { initSpaceDetectionSync, SiteNode, useScene } from '@pascal-app/core'
import {
  applySceneGraphToEditor,
  Grid,
  NodeArrowHandles,
  type SceneGraph,
  SelectionManager,
  selectDefaultBuildingAndLevel,
  ToolManager,
  useEditor,
  WallMoveSideHandles,
} from '@pascal-app/editor'
import {
  requestGodScaleReset,
  toggleXRPlayerMode,
  useViewer,
  useXRPlayerMode,
  Viewer,
  XR_PLAYER_MODES,
} from '@pascal-app/viewer'
import { Glasses, LoaderCircle, Orbit, PersonStanding, RotateCcw, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { mountEmulatorControls } from '@/lib/xr/emulator'
import { XR_PREVIEW_SCENE_KEY } from '@/lib/xr/preview-window'
import { XRWandInputOverlay } from './wand-panel'
import { XREditorInputBridge } from './xr-editor-input-bridge'
import { XREmulatorTestHarnessBridge } from './xr-emulator-test-harness'
import { XRRenderErrorBoundary } from './xr-render-error-boundary'
import { requestEditorVRSession, useEditorXRRuntime, xrConfigForRuntime } from './xr-runtime'

const LOCAL_SCENE_KEY = 'pascal-editor-scene'

function endXRSession(session?: XRSession) {
  if (!session) return
  void session.end().catch(() => undefined)
}

type PreviewScene = {
  graph: SceneGraph
  name: string
}

function ensureXRPreviewSite(graph: SceneGraph): SceneGraph {
  const rootNodeIds = graph.rootNodeIds ?? []
  const sourceNodes = graph.nodes as Record<string, { id: string; type: string; parentId?: string }>
  const existingSite = rootNodeIds.some((id) => sourceNodes[id]?.type === 'site')
  if (existingSite) return graph

  const buildingIds = Object.values(sourceNodes)
    .filter((node) => node?.type === 'building')
    .map((node) => node.id)
  if (buildingIds.length === 0) return graph

  const site = SiteNode.parse({
    id: 'site_xr_preview' as never,
    type: 'site',
    name: 'XR Preview Site',
    polygon: {
      type: 'polygon',
      points: [
        [-100, -100],
        [100, -100],
        [100, 100],
        [-100, 100],
      ],
    },
    children: buildingIds,
  })
  const nodes = Object.fromEntries(
    Object.entries(sourceNodes).map(([id, node]) =>
      node?.type === 'building' ? [id, { ...node, parentId: site.id }] : [id, node],
    ),
  )
  return {
    ...graph,
    nodes: { ...nodes, [site.id]: site },
    rootNodeIds: [site.id],
  }
}

function XREditorScene() {
  const gridSnapStep = useEditor((state) => state.gridSnapStep)

  return (
    <>
      <SelectionManager />
      <NodeArrowHandles />
      <WallMoveSideHandles />
      <Grid cellColor="#aaa" cellSize={gridSnapStep} fadeDistance={500} sectionColor="#ccc" />
      <ToolManager />
      <XREditorInputBridge />
      <XREmulatorTestHarnessBridge />
    </>
  )
}

export function XRPreviewEnvironment({
  liveSnapshot = false,
  sceneId,
}: {
  liveSnapshot?: boolean
  sceneId?: string
}) {
  const runtime = useEditorXRRuntime(true)
  const [scene, setScene] = useState<PreviewScene | null>()
  const [session, setSession] = useState<XRSession>()
  const [error, setError] = useState<string | null>(null)
  const [editorReady, setEditorReady] = useState(false)
  const [inputSummary, setInputSummary] = useState('No tracked inputs')
  const [enteringVR, setEnteringVR] = useState(false)
  const sessionRequest = useRef<Promise<void> | null>(null)
  const playerMode = useXRPlayerMode((state) => state.mode)
  const selectedIds = useViewer((state) => state.selection.selectedIds)

  useEffect(() => {
    const unsubscribeSpaceDetection = initSpaceDetectionSync(useScene, useEditor)
    return () => unsubscribeSpaceDetection()
  }, [])

  useEffect(() => {
    let cancelled = false
    void Promise.resolve(useEditor.persist.rehydrate()).then(() => {
      if (!cancelled) setEditorReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    if (liveSnapshot || !sceneId) {
      try {
        const storageKey = liveSnapshot ? XR_PREVIEW_SCENE_KEY : LOCAL_SCENE_KEY
        const graph = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as SceneGraph | null
        setScene(
          graph ? { graph, name: liveSnapshot ? 'Current editor scene' : 'Local scene' } : null,
        )
      } catch {
        setScene(null)
      }
      return
    }

    fetch(`/api/scenes/${encodeURIComponent(sceneId)}`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Could not load scene (${response.status})`)
        return (await response.json()) as PreviewScene
      })
      .then((nextScene) => {
        if (!cancelled) setScene(nextScene)
      })
      .catch((loadError: unknown) => {
        if (cancelled) return
        setError(loadError instanceof Error ? loadError.message : 'Could not load scene')
        setScene(null)
      })

    return () => {
      cancelled = true
    }
  }, [liveSnapshot, sceneId])

  useEffect(() => {
    if (!(editorReady && scene)) return
    applySceneGraphToEditor(ensureXRPreviewSite(scene.graph))
    selectDefaultBuildingAndLevel()
    useEditor.setState({ mode: 'select', tool: null })
    return () => applySceneGraphToEditor(null)
  }, [editorReady, scene])

  useEffect(() => {
    if (runtime.status !== 'ready') return

    const updateInputSummary = () => {
      const state = runtime.store.getState()
      const inputs = state.inputSourceStates
      setInputSummary(
        inputs.length === 0
          ? state.session
            ? `Session connected · ${state.session.inputSources.length} source(s) · no tracked inputs`
            : 'XR store is waiting for the session'
          : inputs.map((input) => `${input.inputSource.handedness} ${input.type}`).join(' · '),
      )
    }
    updateInputSummary()
    return runtime.store.subscribe(updateInputSummary)
  }, [runtime])

  useEffect(() => {
    if (!(session && runtime.status === 'ready' && runtime.source === 'emulated')) return
    return mountEmulatorControls()
  }, [runtime, session])

  useEffect(() => {
    if (!session) return
    useEditor.setState({ mode: 'select', tool: null })
  }, [session])

  const enterVR = useCallback(async () => {
    if (runtime.status !== 'ready' || session || sessionRequest.current) return
    setError(null)
    setEnteringVR(true)

    const request = (async () => {
      try {
        const nextSession = await requestEditorVRSession(runtime.store)
        nextSession.addEventListener('end', () => setSession(undefined), { once: true })
        setSession(nextSession)
      } catch (sessionError) {
        setError(sessionError instanceof Error ? sessionError.message : 'Could not enter VR')
      } finally {
        setEnteringVR(false)
        sessionRequest.current = null
      }
    })()

    sessionRequest.current = request
    await request
  }, [runtime, session])

  const xr = session
    ? { ...xrConfigForRuntime(runtime, session)!, inputSourceOverlay: XRWandInputOverlay }
    : undefined

  if (xr && scene) {
    return (
      <main className="relative h-screen w-screen overflow-hidden bg-black">
        <XRRenderErrorBoundary onExit={() => endXRSession(session)}>
          <Viewer
            disablePostFx
            maxFps={90}
            renderContext="editor"
            selectionManager="custom"
            xr={xr}
          >
            <XREditorScene />
          </Viewer>
        </XRRenderErrorBoundary>
        <div
          className="absolute top-4 left-4 z-[1000] rounded-full border border-white/20 bg-black/60 px-3 py-1.5 text-white text-xs backdrop-blur"
          data-xr-selected-ids={selectedIds.join(',')}
        >
          {playerMode === XR_PLAYER_MODES.GOD ? 'God mode' : 'Human mode'} · {inputSummary}
        </div>
        <div className="absolute top-4 right-4 z-[1000] flex gap-2">
          <button
            aria-label={`Switch to ${playerMode === XR_PLAYER_MODES.GOD ? 'Human' : 'God'} mode`}
            className="rounded-full border border-white/20 bg-black/60 p-2 text-white backdrop-blur hover:bg-black/80"
            onClick={toggleXRPlayerMode}
            type="button"
          >
            {playerMode === XR_PLAYER_MODES.GOD ? (
              <PersonStanding className="h-4 w-4" />
            ) : (
              <Orbit className="h-4 w-4" />
            )}
          </button>
          {playerMode === XR_PLAYER_MODES.GOD && (
            <button
              aria-label="Reset God view"
              className="rounded-full border border-white/20 bg-black/60 p-2 text-white backdrop-blur hover:bg-black/80"
              onClick={requestGodScaleReset}
              type="button"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          )}
          <button
            aria-label="Exit VR test environment"
            className="rounded-full border border-white/20 bg-black/60 p-2 text-white backdrop-blur hover:bg-black/80"
            onClick={() => endXRSession(session)}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </main>
    )
  }

  const preparing =
    !editorReady || runtime.status === 'idle' || runtime.status === 'loading' || scene === undefined
  const unavailable =
    runtime.status === 'unsupported' || runtime.status === 'error' || scene === null

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 p-6 text-white">
      <section className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-900 p-7 shadow-2xl">
        <Glasses className="h-9 w-9 text-sky-400" />
        <h1 className="mt-4 font-semibold text-xl">WebXR test environment</h1>
        <p className="mt-2 text-sm text-zinc-400">
          {scene?.name ?? 'Preparing the scene'} opens here independently from the editor. Start the
          immersive session when the runtime is ready.
        </p>
        {error && <p className="mt-4 text-red-400 text-sm">{error}</p>}
        {runtime.status === 'error' && (
          <p className="mt-4 text-red-400 text-sm">{runtime.message}</p>
        )}
        {scene === null && !error && (
          <p className="mt-4 text-amber-300 text-sm">No local scene is available to preview.</p>
        )}
        <div className="mt-6 flex gap-3">
          <button
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-sky-500 px-4 py-2.5 font-medium text-sm text-white hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={preparing || unavailable || enteringVR}
            onClick={() => void enterVR()}
            type="button"
          >
            {(preparing || enteringVR) && <LoaderCircle className="h-4 w-4 animate-spin" />}
            {runtime.status === 'ready' && runtime.source === 'emulated'
              ? 'Start Quest 3 emulator'
              : 'Enter VR'}
          </button>
          <button
            className="rounded-lg border border-white/15 px-4 py-2.5 font-medium text-sm hover:bg-white/5"
            onClick={() => window.close()}
            type="button"
          >
            Close
          </button>
        </div>
      </section>
    </main>
  )
}
