import {
  Component,
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { PASCAL_BASE_URL, projectIdFromLocation } from './config'
import { listLevels, type PascalError, type SceneResponse } from './pascal'
import { type ListingState, useListing } from './useListing'
import type { ModelInfo } from './viewer/Model'
import type { RoomHover } from './viewer/semantics'
import { hasWebGL2 } from './viewer/webgl'

// three and the renderer are the bulk of the bundle: load them as their own chunk, in
// parallel with the API read, so status screens and the poster paint first.
const loadViewer = () => import('./viewer/Viewer')
const Viewer = lazy(() => loadViewer().then((module) => ({ default: module.Viewer })))

export function App() {
  const projectId = useMemo(() => projectIdFromLocation(), [])
  const webgl = useMemo(() => hasWebGL2(), [])

  if (!projectId) {
    return (
      <Status title="No project selected" state="missing-project">
        Add <code>?project=&lt;id&gt;</code> to the address, or set{' '}
        <code>VITE_PASCAL_PROJECT_ID</code>.
      </Status>
    )
  }
  if (!webgl) {
    return (
      <Status title="3D isn't available in this browser" state="no-webgl">
        Turn on hardware acceleration, or open this page in another browser.
      </Status>
    )
  }
  return <Listing projectId={projectId} />
}

function Listing({ projectId }: { projectId: string }) {
  const { state, reload } = useListing(PASCAL_BASE_URL, projectId)
  useEffect(() => {
    void loadViewer()
  }, [])

  if (state.kind === 'loading') return <Status title="Loading project…" state="loading" />
  if (state.kind === 'error') return <ErrorStatus error={state.error} onRetry={reload} />
  if (state.kind === 'no-file') return <NoFileStatus scene={state.scene} onRetry={reload} />
  return <Scene state={state} onRetry={reload} />
}

function Scene({
  state,
  onRetry,
}: {
  state: Extract<ListingState, { kind: 'downloading' | 'ready' }>
  onRetry: () => void
}) {
  const { scene } = state
  const levels = useMemo(() => listLevels(scene.graph), [scene.graph])
  const [levelId, setLevelId] = useState<string | null>(null)
  const [model, setModel] = useState<ModelInfo | null>(null)
  const [openError, setOpenError] = useState(false)
  const [hover, setHover] = useState<(RoomHover & { x: number; y: number }) | null>(null)
  const handleError = useCallback((error: unknown) => {
    console.error(error)
    setOpenError(true)
  }, [])

  if (openError) {
    return (
      <Status title="The 3D file couldn't be opened" state="error">
        <button className="button" onClick={onRetry} type="button">
          Try again
        </button>
      </Status>
    )
  }

  const progress = state.kind === 'downloading' ? state.progress : 1
  return (
    <main className="app" data-state={model ? 'ready' : 'loading'}>
      <ProjectHeader scene={scene} />

      {state.kind === 'ready' ? (
        <ViewerBoundary onError={handleError}>
          <Suspense fallback={null}>
            <Viewer
              bytes={state.bytes}
              graph={scene.graph}
              label={`${projectName(scene)}, interactive 3D view`}
              levelId={levelId}
              onError={handleError}
              onHover={setHover}
              onReady={setModel}
            />
          </Suspense>
        </ViewerBoundary>
      ) : null}

      {model ? null : (
        <div className="loading-overlay">
          {scene.project.coverUrl ? (
            <img alt="" className="poster" src={scene.project.coverUrl} />
          ) : null}
          <div className="progress-card" role="status">
            <span>Loading 3D file…</span>
            <div className="progress-track">
              <div
                className={progress === null ? 'progress-bar indeterminate' : 'progress-bar'}
                style={{ width: progress === null ? undefined : `${Math.round(progress * 100)}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {model && levels.length > 1 ? (
        <fieldset className="levels">
          <legend className="sr-only">Floors</legend>
          <LevelButton active={levelId === null} onClick={() => setLevelId(null)}>
            All floors
          </LevelButton>
          {[...levels].reverse().map((level) => (
            <LevelButton
              active={levelId === level.id}
              key={level.id}
              onClick={() => setLevelId(level.id)}
            >
              {level.name}
            </LevelButton>
          ))}
        </fieldset>
      ) : null}

      {model?.hasOpenables ? <p className="hint">Click a door or window to open it</p> : null}

      {hover ? (
        <div className="room-label" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          <strong>{hover.label}</strong>
          <span>{formatArea(hover.area)}</span>
        </div>
      ) : null}
    </main>
  )
}

function projectName(scene: SceneResponse) {
  return scene.project.name?.trim() || 'Untitled project'
}

function formatArea(area: number) {
  return `${area.toLocaleString(undefined, { maximumFractionDigits: area < 10 ? 1 : 0 })} m²`
}

function LevelButton({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: ReactNode
  onClick: () => void
}) {
  return (
    <button aria-pressed={active} className="button" onClick={onClick} type="button">
      {children}
    </button>
  )
}

function ProjectHeader({ scene }: { scene: SceneResponse }) {
  return (
    <header className="project-header">
      <h1>{projectName(scene)}</h1>
      {scene.project.owner ? <p>by {scene.project.owner.displayName}</p> : null}
    </header>
  )
}

function NoFileStatus({ scene, onRetry }: { scene: SceneResponse; onRetry: () => void }) {
  if (scene.bake.status === 'baking') {
    return (
      <Status title="This project's 3D file is being prepared" state="baking">
        This page checks again every 30 seconds.
        <button className="button" onClick={onRetry} type="button">
          Check now
        </button>
      </Status>
    )
  }
  return (
    <Status title="No 3D file is available yet" state="no-file">
      {projectName(scene)} doesn't have a 3D file to show.
    </Status>
  )
}

function ErrorStatus({ error, onRetry }: { error: PascalError; onRetry: () => void }) {
  const retry = (
    <button className="button" onClick={onRetry} type="button">
      Try again
    </button>
  )
  switch (error.code) {
    case 'not_found':
      return (
        <Status title="Project not found" state="not-found">
          Check the link, or ask the owner to make the project public.
        </Status>
      )
    case 'not_published':
      return (
        <Status title="This project isn't published yet" state="not-published">
          Its owner hasn't published a version to show.
        </Status>
      )
    case 'network':
      return (
        <Status title="Couldn't reach Pascal" state="error">
          Check your connection and try again.
          {retry}
        </Status>
      )
    case 'invalid_response':
      return (
        <Status title="This viewer doesn't understand Pascal's answer" state="error">
          It may need an update.
        </Status>
      )
    default:
      return (
        <Status title="Something went wrong loading this project" state="error">
          {retry}
        </Status>
      )
  }
}

function Status({
  title,
  state,
  children,
}: {
  title: string
  state: string
  children?: ReactNode
}) {
  return (
    <main className="status" data-state={state}>
      <h1>{title}</h1>
      {children ? <div className="status-body">{children}</div> : null}
    </main>
  )
}

/** Catches renderer failures (context creation, a shader that won't compile). */
class ViewerBoundary extends Component<
  { children: ReactNode; onError: (error: unknown) => void },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: unknown) {
    this.props.onError(error)
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}
