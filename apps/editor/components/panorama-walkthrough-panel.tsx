'use client'

import { useScene } from '@pascal-app/core'
import { CheckCircle2, ImageIcon, Play, Video } from 'lucide-react'
import type React from 'react'
import { useMemo, useState } from 'react'
import { PanoramaViewerModal } from './panorama-viewer-modal'

type ActionState = 'idle' | 'running' | 'done'
type GenerateMode = 'panorama' | 'walkthrough'
type PlanPoint = { x: number; y: number }
type PlanWall = { start: [number, number]; end: [number, number] }
type PlanZone = { polygon: [number, number][]; color?: string }

function StatusButton({
  icon,
  label,
  runningLabel,
  doneLabel,
  state,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  runningLabel: string
  doneLabel: string
  state: ActionState
  onClick: () => void
}) {
  return (
    <button
      className="flex h-10 w-full items-center justify-center gap-2 rounded-md border border-border bg-background px-3 font-medium text-sm transition-colors hover:bg-accent disabled:cursor-wait disabled:opacity-70"
      disabled={state === 'running'}
      onClick={onClick}
      type="button"
    >
      {state === 'done' ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : icon}
      <span>{state === 'running' ? runningLabel : state === 'done' ? doneLabel : label}</span>
    </button>
  )
}

function readSceneIdFromPath(): string | null {
  if (typeof window === 'undefined') return null

  const match = window.location.pathname.match(/\/(?:_pascal\/)?scene\/([^/]+)/)
  return match?.[1] ?? null
}

function isWallNode(node: unknown): node is PlanWall & { type: 'wall' } {
  const maybe = node as { type?: unknown; start?: unknown; end?: unknown }
  return (
    maybe.type === 'wall' &&
    Array.isArray(maybe.start) &&
    maybe.start.length === 2 &&
    Array.isArray(maybe.end) &&
    maybe.end.length === 2
  )
}

function isZoneNode(node: unknown): node is PlanZone & { type: 'zone' } {
  const maybe = node as { type?: unknown; polygon?: unknown }
  return (
    maybe.type === 'zone' &&
    Array.isArray(maybe.polygon) &&
    maybe.polygon.every((point) => Array.isArray(point) && point.length === 2)
  )
}

function PointSelectionModal({
  mode,
  onClose,
  onConfirm,
}: {
  mode: GenerateMode
  onClose: () => void
  onConfirm: (points: PlanPoint[]) => void
}) {
  const nodes = useScene((state) => state.nodes)
  const [points, setPoints] = useState<PlanPoint[]>([])

  const plan = useMemo(() => {
    const walls = Object.values(nodes).filter(isWallNode)
    const zones = Object.values(nodes).filter(isZoneNode)
    const rawPoints: [number, number][] = [
      ...walls.flatMap((wall) => [wall.start, wall.end]),
      ...zones.flatMap((zone) => zone.polygon),
    ]

    if (rawPoints.length === 0) {
      return {
        walls: [
          { start: [12, 12], end: [88, 12] },
          { start: [88, 12], end: [88, 58] },
          { start: [88, 58], end: [12, 58] },
          { start: [12, 58], end: [12, 12] },
          { start: [46, 12], end: [46, 58] },
          { start: [46, 34], end: [88, 34] },
        ] as PlanWall[],
        zones: [] as PlanZone[],
        wallCount: 0,
      }
    }

    const xs = rawPoints.map(([x]) => x)
    const ys = rawPoints.map(([, y]) => y)
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    const width = Math.max(maxX - minX, 1)
    const height = Math.max(maxY - minY, 1)
    const margin = 8
    const scale = Math.min((100 - margin * 2) / width, (70 - margin * 2) / height)
    const offsetX = (100 - width * scale) / 2
    const offsetY = (70 - height * scale) / 2
    const mapPoint = ([x, y]: [number, number]): [number, number] => [
      offsetX + (x - minX) * scale,
      offsetY + (y - minY) * scale,
    ]

    return {
      walls: walls.map((wall) => ({ start: mapPoint(wall.start), end: mapPoint(wall.end) })),
      zones: zones.map((zone) => ({
        color: zone.color,
        polygon: zone.polygon.map(mapPoint),
      })),
      wallCount: walls.length,
    }
  }, [nodes])

  const requiredPoints = mode === 'panorama' ? 1 : 2
  const canGenerate = points.length >= requiredPoints

  const handlePlanClick = (event: React.MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const next = {
      x: ((event.clientX - rect.left) / rect.width) * 100,
      y: ((event.clientY - rect.top) / rect.height) * 70,
    }
    setPoints((current) => (mode === 'panorama' ? [next] : [...current, next]))
  }

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-md border border-border bg-background shadow-2xl">
        <header className="flex h-12 shrink-0 items-center justify-between border-border border-b px-4">
          <div>
            <h2 className="font-semibold text-sm">
              {mode === 'panorama' ? 'Select panorama position' : 'Select walkthrough path'}
            </h2>
            <p className="text-muted-foreground text-xs">
              {mode === 'panorama'
                ? 'Choose one point on the 2D plan.'
                : 'Choose two or more points to define the path.'}
              {' '}
              {plan.wallCount > 0 ? `${plan.wallCount} walls detected.` : 'Using placeholder plan.'}
            </p>
          </div>
          <button
            className="rounded-md px-2 py-1 text-muted-foreground text-sm hover:bg-accent hover:text-foreground"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </header>

        <div className="min-h-0 flex-1 p-4">
          <button
            className="block w-full overflow-hidden rounded-md border border-border bg-muted/20 text-left"
            type="button"
          >
            <svg
              aria-label="2D floor plan point selector"
              className="block aspect-[10/7] w-full"
              onClick={handlePlanClick}
              role="img"
              viewBox="0 0 100 70"
            >
              <defs>
                <pattern height="5" id="plan-grid" patternUnits="userSpaceOnUse" width="5">
                  <path d="M 5 0 L 0 0 0 5" fill="none" stroke="#cbd5e1" strokeWidth="0.12" />
                </pattern>
              </defs>
              <rect fill="#f8fafc" height="70" width="100" />
              <rect fill="url(#plan-grid)" height="70" width="100" />
              {plan.zones.map((zone, index) => (
                <polygon
                  fill={zone.color ?? '#3b82f6'}
                  key={`zone-${index}`}
                  opacity="0.12"
                  points={zone.polygon.map(([x, y]) => `${x},${y}`).join(' ')}
                  stroke={zone.color ?? '#3b82f6'}
                  strokeWidth="0.35"
                />
              ))}
              {plan.walls.map((wall, index) => (
                <line
                  key={`wall-${index}`}
                  stroke="#0f172a"
                  strokeLinecap="round"
                  strokeWidth="1.45"
                  x1={wall.start[0]}
                  x2={wall.end[0]}
                  y1={wall.start[1]}
                  y2={wall.end[1]}
                />
              ))}
              {mode === 'walkthrough' && points.length > 1 ? (
                <polyline
                  fill="none"
                  points={points.map((point) => `${point.x},${point.y}`).join(' ')}
                  stroke="#22c55e"
                  strokeDasharray="1.2 1.2"
                  strokeWidth="0.75"
                />
              ) : null}
              {points.map((point, index) => (
                <g key={`point-${index}`}>
                  <circle cx={point.x} cy={point.y} fill="#22c55e" r="1.7" />
                  <text
                    fill="white"
                    fontSize="2.2"
                    fontWeight="700"
                    textAnchor="middle"
                    x={point.x}
                    y={point.y + 0.8}
                  >
                    {index + 1}
                  </text>
                </g>
              ))}
            </svg>
          </button>
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-3 border-border border-t px-4 py-3">
          <span className="text-muted-foreground text-xs">
            {points.length} point{points.length === 1 ? '' : 's'} selected
          </span>
          <div className="flex items-center gap-2">
            <button
              className="rounded-md border border-border px-3 py-2 font-medium text-sm hover:bg-accent"
              onClick={() => setPoints([])}
              type="button"
            >
              Clear
            </button>
            <button
              className="rounded-md bg-foreground px-3 py-2 font-medium text-background text-sm disabled:cursor-not-allowed disabled:opacity-45"
              disabled={!canGenerate}
              onClick={() => onConfirm(points)}
              type="button"
            >
              Generate
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

export function PanoramaWalkthroughPanel({ sceneId }: { sceneId?: string }) {
  const resolvedSceneId = useMemo(() => sceneId ?? readSceneIdFromPath(), [sceneId])
  const [panoramaState, setPanoramaState] = useState<ActionState>('idle')
  const [videoState, setVideoState] = useState<ActionState>('idle')
  const [lastMessage, setLastMessage] = useState('Ready to generate from the current scene.')
  const [panoramaMissing, setPanoramaMissing] = useState(false)
  const [videoMissing, setVideoMissing] = useState(false)
  const [showPanorama, setShowPanorama] = useState(false)
  const [showVideo, setShowVideo] = useState(false)
  const [panoramaRevision, setPanoramaRevision] = useState(0)
  const [videoRevision, setVideoRevision] = useState(0)
  const [viewerOpen, setViewerOpen] = useState(false)
  const [selectionMode, setSelectionMode] = useState<GenerateMode | null>(null)

  const panoramaUrl = resolvedSceneId
    ? `/api/pascal-function-static/${encodeURIComponent(resolvedSceneId)}/panorama.jpg?v=${panoramaRevision}`
    : null
  const walkthroughUrl = resolvedSceneId
    ? `/api/pascal-function-static/${encodeURIComponent(resolvedSceneId)}/walkthrough.mp4?v=${videoRevision}`
    : null

  const runFakeAction = (
    setState: React.Dispatch<React.SetStateAction<ActionState>>,
    runningMessage: string,
    doneMessage: string,
    onDone?: () => void,
  ) => {
    setState('running')
    setLastMessage(runningMessage)
    window.setTimeout(() => {
      setState('done')
      setLastMessage(doneMessage)
      onDone?.()
    }, 700)
  }

  const handleGenerateFromPoints = (mode: GenerateMode, points: PlanPoint[]) => {
    setSelectionMode(null)
    if (mode === 'panorama') {
      runFakeAction(
        setPanoramaState,
        `Generating panorama from ${points.length} selected position...`,
        'Panorama generated',
        () => {
          setPanoramaMissing(false)
          setPanoramaRevision((current) => current + 1)
          setShowPanorama(true)
        },
      )
      return
    }

    runFakeAction(
      setVideoState,
      `Rendering walkthrough video from ${points.length} path points...`,
      'Walkthrough video generated',
      () => {
        setVideoMissing(false)
        setVideoRevision((current) => current + 1)
        setShowVideo(true)
      },
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex h-11 shrink-0 items-center gap-2 border-border/70 border-b px-3">
        <ImageIcon className="h-4 w-4 shrink-0" aria-hidden />
        <span className="truncate font-medium text-sm">Panorama</span>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        <section className="space-y-2">
          <h2 className="font-medium text-sm">Panorama Photo</h2>
          <div className="flex aspect-video items-center justify-center overflow-hidden rounded-md border border-dashed border-border bg-muted/30">
            {showPanorama && panoramaUrl && !panoramaMissing ? (
              <button
                className="group relative h-full w-full overflow-hidden"
                onClick={() => setViewerOpen(true)}
                type="button"
              >
                <img
                  alt="Generated panorama preview"
                  className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                  onError={() => setPanoramaMissing(true)}
                  src={panoramaUrl}
                />
                <span className="absolute inset-x-0 bottom-0 bg-black/55 px-3 py-2 text-left text-white text-xs opacity-0 transition-opacity group-hover:opacity-100">
                  Open 360 viewer
                </span>
              </button>
            ) : (
              <div className="flex flex-col items-center gap-2 text-muted-foreground text-sm">
                <ImageIcon className="h-8 w-8" aria-hidden />
                <span>
                  {resolvedSceneId
                    ? showPanorama
                      ? 'No panorama found'
                      : 'Generate panorama to preview'
                    : 'No scene selected'}
                </span>
              </div>
            )}
          </div>
          <StatusButton
            doneLabel="Panorama generated"
            icon={<ImageIcon className="h-4 w-4" />}
            label="Generate panorama"
            onClick={() => setSelectionMode('panorama')}
            runningLabel="Generating..."
            state={panoramaState}
          />
        </section>

        <section className="space-y-2">
          <h2 className="font-medium text-sm">Walkthrough Video</h2>
          <div className="flex aspect-video items-center justify-center overflow-hidden rounded-md border border-dashed border-border bg-muted/30">
            {showVideo && walkthroughUrl && !videoMissing ? (
              <video
                className="h-full w-full object-cover"
                controls
                onError={() => setVideoMissing(true)}
                src={walkthroughUrl}
              >
                <track kind="captions" label="No captions" srcLang="en" />
              </video>
            ) : (
              <div className="flex flex-col items-center gap-2 text-muted-foreground text-sm">
                <Video className="h-8 w-8" aria-hidden />
                <span>
                  {resolvedSceneId
                    ? showVideo
                      ? 'No walkthrough video found'
                      : 'Generate walkthrough to preview'
                    : 'No scene selected'}
                </span>
              </div>
            )}
          </div>
          <StatusButton
            doneLabel="Video generated"
            icon={<Play className="h-4 w-4" />}
            label="Generate walkthrough"
            onClick={() => setSelectionMode('walkthrough')}
            runningLabel="Rendering..."
            state={videoState}
          />
          <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-muted-foreground text-sm">
            {lastMessage}
          </div>
        </section>
      </div>
      {viewerOpen && panoramaUrl ? (
        <PanoramaViewerModal imageUrl={panoramaUrl} onClose={() => setViewerOpen(false)} />
      ) : null}
      {selectionMode ? (
        <PointSelectionModal
          mode={selectionMode}
          onClose={() => setSelectionMode(null)}
          onConfirm={(points) => handleGenerateFromPoints(selectionMode, points)}
        />
      ) : null}
    </div>
  )
}
