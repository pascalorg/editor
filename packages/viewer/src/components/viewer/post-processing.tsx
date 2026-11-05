import { useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ACESFilmicToneMapping,
  Color,
  Layers,
  Matrix4,
  NeutralToneMapping,
  type Object3D,
  Scene,
  UnsignedByteType,
  Vector3,
} from 'three'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { fxaa } from 'three/addons/tsl/display/FXAANode.js'
import { ao as gtao } from 'three/addons/tsl/display/GTAONode.js'
import { traa } from 'three/addons/tsl/display/TRAANode.js'
import {
  add,
  builtinAOContext,
  diffuseColor,
  ivec2,
  mix,
  mrt,
  normalView,
  normalWorldGeometry,
  oscSine,
  output,
  pass,
  premultiplyAlpha,
  renderOutput,
  sample,
  saturation,
  screenUV,
  smoothstep,
  time,
  color as tslColor,
  float as tslFloat,
  length as tslLength,
  uniform,
  vec3,
  vec4,
  velocity,
} from 'three/tsl'
import { RenderPipeline, TimestampQuery, type WebGPURenderer } from 'three/webgpu'
import { backdropColors, backdropGradient, flatBackdropOutput } from '../../lib/backdrop'
import {
  DAYLIGHT_BLOOM,
  DAYLIGHT_GRADE,
  DAYLIGHT_INK_BACKDROP,
  daylightGradeRgb,
  isDaylightAtmosphere as isDaylight,
} from '../../lib/daylight/look'
import { daylightRoomContext } from '../../lib/daylight/room-context'
import { edgeColorFor, edgeOpacityScaleFor } from '../../lib/edge-style'
import { PERF_OVERLAY_ENABLED } from '../../lib/gpu-perf'
import { createEdgeDepthSampler, inkedEdges } from '../../lib/ink-edges'
import { refreshIsolation } from '../../lib/isolation'
import { LayerPassIndex, LayerPassNode } from '../../lib/layer-pass'
import { OVERLAY_LAYER, SCENE_LAYER, scenePassLayers, ZONE_LAYER } from '../../lib/layers'
import { isLiveFrameHeld } from '../../lib/live-frame-hold'
import { mergedOutline } from '../../lib/merged-outline-node'
import { recordPerfSample, timeSpan } from '../../lib/perf-tracks'
import { PostProcessingResources } from '../../lib/post-processing-resources'
import { sceneLightingMask, scenePassMrt } from '../../lib/scene-pass-mrt'
import { packNormalToRGB, unpackRGBToNormal } from '../../lib/tsl-compat'
import {
  earthNow,
  UNDERGROUND_VIGNETTE,
  undergroundAmbianceNode,
  undergroundBackdrop,
  undergroundDissolve,
  undergroundDissolveGrain,
  undergroundEarthNode,
  undergroundFogAmount,
  undergroundVignette,
  worldPositionFromDepth,
} from '../../lib/underground-ambiance'
import useViewer from '../../store/use-viewer'
import { useSceneAtmosphere } from './scene-atmosphere'

/** Medium tier: ½-res GTAO over the whole image (enhanced viewer: strength 0.6 × 0.8). */
const MEDIUM_AO_BLEND = 0.48
const NEIGHBOURS_3X3 = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
] as const

// A mild mid-gray contrast and saturation lift separates surfaces before the
// output transform. Saved project looks can turn it off.
export const GRADE_PARAMS = {
  contrast: 1.05,
  saturation: 1.1,
}

// SSGI parameters for the snapshot pipeline's ambient occlusion.
export const SSGI_PARAMS = {
  enabled: true,
  sliceCount: 1,
  stepCount: 4,
  radius: 1,
  expFactor: 1.5,
  thickness: 0.5,
  backfaceLighting: 0.5,
  aoIntensity: 1.5,
  giIntensity: 0,
  useLinearThickness: false,
  useScreenSpaceSampling: true,
  useTemporalFiltering: false,
}

// Diagnostic toggles for thermal A/B testing. Add
// `?disable=ao,denoise,outline,postFx`
// to the URL (any subset) and reload to skip those passes. Each flag prevents
// allocation + per-frame work for that stage, so device temperature deltas
// across combos isolate which pass is the actual culprit. Picked up once at
// pipeline build; reload after changing the URL.
//   - ao:      skip ambient occlusion entirely
//   - denoise: (snapshots) keep SSGI but feed its raw noisy AO straight to the composite
//   - outline: skip the merged-outline node and its 14 internal RTs
//   - postFx:  bypass the whole RenderPipeline and use renderer.render(scene, camera)
//              directly — isolates raw scene-render cost from any post-FX overhead
//   - draw:    skip the render call entirely — frames still tick (useFrame
//              systems, scene-ready) but no draw is ever submitted. For
//              consumers that only need the built scene graph, never pixels:
//              the headless bake worker renders on SwiftShader (CPU), where
//              per-frame vertex/draw cost dominates the whole capture.
function readPerfDisableFlags() {
  if (typeof window === 'undefined') {
    return {
      ao: false,
      denoise: false,
      outline: false,
      postFx: false,
    }
  }
  const raw = new URLSearchParams(window.location.search).get('disable') ?? ''
  const set = new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
  return {
    ao: set.has('ao'),
    denoise: set.has('denoise'),
    outline: set.has('outline'),
    postFx: set.has('postFx'),
  }
}

const PERF_POST_FX_DISABLED =
  typeof window !== 'undefined' &&
  new Set(
    (new URLSearchParams(window.location.search).get('disable') ?? '')
      .split(',')
      .map((s) => s.trim()),
  ).has('postFx')

const PERF_DRAW_DISABLED =
  typeof window !== 'undefined' &&
  new Set(
    (new URLSearchParams(window.location.search).get('disable') ?? '')
      .split(',')
      .map((s) => s.trim()),
  ).has('draw')

// Stand-in scene for `?disable=draw` frames — cleared, never populated.
const emptyScene = new Scene()

const MAX_PIPELINE_RETRIES = 3
const RETRY_DELAY_MS = 500

export type HoverStyle = {
  visibleColor: number
  hiddenColor: number
  strength: number
  pulse: boolean
}

export type HoverStyles = {
  default: HoverStyle
} & Record<string, HoverStyle>

const DEFAULT_HOVER_STYLE: HoverStyle = {
  visibleColor: 0x00_aa_ff,
  hiddenColor: 0xf3_ff_47,
  strength: 5,
  pulse: true,
}

export const DEFAULT_HOVER_STYLES: HoverStyles = {
  default: DEFAULT_HOVER_STYLE,
}

function sanitizeOutlineObjects(objects: Object3D[]) {
  let nextIndex = 0

  for (const object of objects) {
    if (!(object && typeof object.id === 'number' && object.parent)) {
      continue
    }

    objects[nextIndex] = object
    nextIndex++
  }

  objects.length = nextIndex
}

// Two independent GPU readings per frame, both `?perf`-only:
//  - `gpu-render`: three's WebGPU timestamp queries — the summed GPU duration of
//    the frame's render passes, measured on the device. The only honest "GPU ms".
//  - `gpu-queue`: submit → `onSubmittedWorkDone()` wall time. That covers queue
//    backlog and CPU work that ran before the microtask got to resume, so it is
//    a backpressure signal, not GPU time.
// `resolveTimestampsAsync` returns the previous resolve's value while one is in
// flight, so calling it every frame is safe (and required — the query pool warns
// once it fills).
function recordFrameGpuTiming(renderer: any, submittedAt: number): void {
  const queue = renderer.backend?.device?.queue as
    | { onSubmittedWorkDone?: () => Promise<void> }
    | undefined
  queue?.onSubmittedWorkDone?.().then(() => {
    recordPerfSample('gpu-queue', performance.now() - submittedAt)
  })

  // Off unless the device advertised 'timestamp-query' at init — the backend
  // clears its own flag when the feature is missing, so this is the truth.
  if (renderer.backend?.trackTimestamp !== true) return
  renderer
    .resolveTimestampsAsync?.(TimestampQuery.RENDER)
    ?.then((ms: number | undefined) => {
      if (typeof ms === 'number' && ms > 0) recordPerfSample('gpu-render', ms)
    })
    .catch(() => {
      // Pool disposed mid-flight (pipeline rebuild / unmount) — nothing to report.
    })
}

const PostProcessingPasses = ({
  hoverStyles = DEFAULT_HOVER_STYLES,
  disablePostFx = false,
}: {
  hoverStyles?: HoverStyles
  /** Host-controlled equivalent of `?disable=postFx` — see the Viewer prop. */
  disablePostFx?: boolean
}) => {
  const { gl: renderer, invalidate, scene, camera, size } = useThree()
  const resourcesRef = useRef<PostProcessingResources | null>(null)
  const atmosphere = useSceneAtmosphere()
  // Under the ground the sky is the dark mode's: the same mix the pipeline's backdrop makes.
  const directSkyNode = useMemo(
    () =>
      atmosphere
        ? mix(
            atmosphere.skyRadiance(normalWorldGeometry),
            undergroundBackdrop(normalWorldGeometry.y),
            undergroundEarthNode(),
          )
        : null,
    [atmosphere],
  )
  const hasPipelineErrorRef = useRef(false)
  const retryCountRef = useRef(0)
  const rebuildTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const skippedZeroSizeRef = useRef(false)

  // Background color uniform — updated every frame via lerp, read by the TSL pipeline.
  // Initialised from the current scene theme so there's no flash on first render.
  const initTheme = useViewer.getState().sceneAppearance
  const initBackdrop = backdropColors(initTheme)
  const initBg = initTheme.background
  const bgUniform = useRef(uniform(new Color(initBg)))
  const bgCurrent = useRef(new Color(initBg))
  const bgTarget = useRef(new Color())
  // Zenith colour of the backdrop gradient (falls back to the flat background).
  const initSky = initBackdrop.sky
  const bgSkyUniform = useRef(uniform(new Color(initSky)))
  const bgSkyCurrent = useRef(new Color(initSky))
  const bgSkyTarget = useRef(new Color())
  // Horizon haze band + deep zenith (derived — see lib/backdrop.ts).
  const initHaze = initBackdrop.haze
  const bgHazeUniform = useRef(uniform(new Color(initHaze)))
  const bgHazeCurrent = useRef(new Color(initHaze))
  const bgHazeTarget = useRef(new Color())
  const initSkyDeep = initBackdrop.skyDeep
  const bgSkyDeepUniform = useRef(uniform(new Color(initSkyDeep)))
  const bgSkyDeepCurrent = useRef(new Color(initSkyDeep))
  const bgSkyDeepTarget = useRef(new Color())
  // Scene-camera matrices for the backdrop: the pipeline's fullscreen quad has
  // its own camera, so the sky gradient reconstructs each pixel's world-space
  // view ray from these to find the true horizon (dir.y = 0).
  const camProjInvUniform = useRef(uniform(new Matrix4()))
  const camWorldUniform = useRef(uniform(new Matrix4()))
  // The clear colour of the no-pipeline fallback under the ground (scratch, and the dark mode's tone).
  const fallbackClear = useRef(new Color())
  const fallbackEarth = useRef(new Color(UNDERGROUND_VIGNETTE))

  // Ink-line colour follows the scene-theme background luminance (dark lines on
  // light scenes, light on dark), refreshed each frame like the background.
  // Dark scenes also scale the ink opacity down (see edge-style.ts).
  const inkColorUniform = useRef(uniform(new Color(edgeColorFor(initBg))))
  const inkOpacityScaleUniform = useRef(uniform(edgeOpacityScaleFor(initBg)))

  const zoneLayers = useMemo(() => {
    const l = new Layers()
    l.enable(ZONE_LAYER)
    l.disable(SCENE_LAYER)
    return l
  }, [])
  // Scene pass renders the main geometry layer plus the grid. The default camera
  // mask also has the overlay layer enabled (custom controls enable it for
  // picking), so without this the gizmos/handles/tool previews land in the
  // depth+normal MRT and get inked / AO'd as if they were geometry. The grid is
  // kept in here (not the overlay pass) so scene geometry depth-occludes it; it's
  // a flat, depth-non-writing plane. The dust shares the layer and writes alpha 0 to
  // the normal and diffuse attachments, which `scenePassMrt` blends, so the ink
  // never sees its quads.
  const sceneOnlyLayers = useMemo(scenePassLayers, [])
  // Editor overlays render in their own pass, composited on top after the ink
  // and outlines so they read as crisp UI rather than scene geometry.
  const overlayLayers = useMemo(() => {
    const l = new Layers()
    l.set(OVERLAY_LAYER)
    return l
  }, [])
  const hoverMode = useViewer((s) => s.hoverHighlightMode)
  // Elements a chat chip points at draw in the `point` style whatever the editor's hover mode is.
  const hasPointedIds = useViewer((s) => s.pointedIds.length > 0)
  const hoverHighlightMode = hasPointedIds ? 'point' : hoverMode
  const hoverVisibleColor = useMemo(() => uniform(new Color(DEFAULT_HOVER_STYLE.visibleColor)), [])
  const hoverHiddenColor = useMemo(() => uniform(new Color(DEFAULT_HOVER_STYLE.hiddenColor)), [])
  const hoverStrength = useMemo(() => uniform(DEFAULT_HOVER_STYLE.strength), [])
  const hoverPulseMix = useMemo(() => uniform(DEFAULT_HOVER_STYLE.pulse ? 0 : 1), [])

  // Subscribe to projectId so the pipeline rebuilds on project switch
  const projectId = useViewer((s) => s.projectId)
  const ambientOcclusion = useViewer(
    (s) => s.sceneAppearance.postprocessing?.ambientOcclusion !== false,
  )
  const colorGrading = useViewer((s) => s.sceneAppearance.postprocessing?.colorGrading !== false)
  const flatBackground = useViewer((s) => s.sceneAppearance.backgroundSky === null)
  const edges = useViewer((s) => s.edges)
  const inkOpacityOverride = useViewer((s) => s.inkOpacity)
  const transparentBackground = useViewer((s) => s.transparentBackground)
  const renderQuality = useViewer((s) => s.renderQuality)
  // Daylight look uniforms, refreshed every frame from the atmosphere/exposure.
  const whiteBalance = useMemo(() => uniform(new Vector3(1, 1, 1)), [])
  // 1 / exposure: the bloom threshold (only display-white blooms) and the daylight look's
  // compensation of unlit overlays (zones, editor overlays), which keep their designed brightness.
  const exposureInverse = useMemo(() => uniform(1), [])
  const lastProjectIdRef = useRef(projectId)

  // Bump this to force a pipeline rebuild (used by retry logic)
  const [pipelineVersion, setPipelineVersion] = useState(0)

  const requestPipelineRebuild = useCallback(() => {
    if (rebuildTimeoutRef.current !== null) {
      clearTimeout(rebuildTimeoutRef.current)
      rebuildTimeoutRef.current = null
    }

    setPipelineVersion((v) => v + 1)
  }, [])

  const disposePipeline = useCallback(() => {
    resourcesRef.current?.dispose()
    resourcesRef.current = null
  }, [])

  // Reset retry state when project changes
  useEffect(() => {
    if (lastProjectIdRef.current === projectId) return
    lastProjectIdRef.current = projectId
    retryCountRef.current = 0
    if (rebuildTimeoutRef.current !== null) {
      clearTimeout(rebuildTimeoutRef.current)
      rebuildTimeoutRef.current = null
    }
  }, [projectId])

  useEffect(() => {
    return () => {
      if (rebuildTimeoutRef.current !== null) {
        clearTimeout(rebuildTimeoutRef.current)
        rebuildTimeoutRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    const style = hoverStyles[hoverHighlightMode] ?? hoverStyles.default
    hoverVisibleColor.value.setHex(style.visibleColor)
    hoverHiddenColor.value.setHex(style.hiddenColor)
    hoverStrength.value = style.strength
    hoverPulseMix.value = style.pulse ? 0 : 1
    invalidate()
  }, [
    hoverHiddenColor,
    hoverHighlightMode,
    hoverPulseMix,
    hoverStrength,
    hoverStyles,
    hoverVisibleColor,
    invalidate,
  ])

  // Build / rebuild the post-processing pipeline
  useEffect(() => {
    const width = Math.floor(size.width)
    const height = Math.floor(size.height)

    if (!(renderer && scene && camera)) {
      console.warn('[viewer/post-processing] Skipping pipeline build — missing dependency.', {
        hasRenderer: !!renderer,
        hasScene: !!scene,
        hasCamera: !!camera,
      })
      return
    }

    if (width < 1 || height < 1) {
      skippedZeroSizeRef.current = true
      hasPipelineErrorRef.current = false
      disposePipeline()
      return
    }

    if (skippedZeroSizeRef.current) {
      skippedZeroSizeRef.current = false
    }

    const perfDisable = readPerfDisableFlags()

    // postFx off (host prop or ?disable=postFx): never allocate the pipeline —
    // useFrame's null-pipeline branch direct-renders. Before this check the
    // URL flag only skipped the pipeline at render time; the build still
    // allocated every pass.
    if (disablePostFx || perfDisable.postFx) {
      hasPipelineErrorRef.current = false
      disposePipeline()
      return
    }
    // Quality tiers (both appearances; the enhanced-viewer reference):
    //  high   — depth/normal/velocity pre-pass → GTAO on indirect light only, TRAA, bloom (daylight)
    //  medium — ½-res GTAO from the scene pass, soft whole-image blend, TRAA
    //  low    — no AO, FXAA
    // The colored appearance adds the daylight look: Neutral tone mapping, white balance, grade
    // and a display-space vignette. Ink edges belong to the monochrome appearance only.
    const daylight = isDaylight(atmosphere)
    renderer.toneMapping = daylight ? NeutralToneMapping : ACESFilmicToneMapping
    const aoTier =
      ambientOcclusion && !perfDisable.ao && renderQuality !== 'low' ? renderQuality : null
    const temporalAA = !transparentBackground && renderQuality !== 'low'
    const fxaaEnabled = !transparentBackground && renderQuality === 'low'
    const bloomEnabled = daylight && !transparentBackground && renderQuality === 'high'
    const outlineEnabled = !perfDisable.outline
    const inkEnabled = !daylight && edges !== 'off'
    const needsNormalMRT = inkEnabled || aoTier === 'medium' || (temporalAA && aoTier !== 'high')
    // Ink: thin (1px sample radius) and faint (50% opacity).
    const inkRadius = 1
    const inkOpacity = inkOpacityOverride ?? 0.5

    console.log('[viewer/post-processing] Building pipeline', {
      version: pipelineVersion,
      quality: renderQuality,
      outline: outlineEnabled,
      perfDisable,
      projectId,
      ambientOcclusion,
      colorGrading,
      transparentBackground,
      rendererCtor: (renderer as any).constructor?.name,
      width,
      height,
    })

    hasPipelineErrorRef.current = false

    // WebGPU availability check: GTAO, TRAA, and RenderPipeline are all
    // WebGPU-only APIs. When the browser falls back to WebGL2 (no
    // `navigator.gpu`, or the device couldn't be created), building the
    // pipeline either throws silently or produces a broken output where
    // the scene renders for a few frames and then goes black as the retry
    // loop fights the direct-render fallback path. Short-circuit here so
    // `useFrame` uses the direct `renderer.render(scene, camera)` path
    // exclusively and never attempts the TSL pipeline.
    const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator
    if (!hasWebGPU) {
      hasPipelineErrorRef.current = true
      resourcesRef.current = null
      return
    }

    // Clear outliner arrays synchronously to prevent stale Object3D refs
    // from the previous project leaking into the new pipeline's outline passes.
    const outliner = useViewer.getState().outliner
    sanitizeOutlineObjects(outliner.selectedObjects)
    sanitizeOutlineObjects(outliner.hoveredObjects)
    outliner.selectedObjects.length = 0
    outliner.hoveredObjects.length = 0

    const resources = new PostProcessingResources()
    resourcesRef.current = resources
    try {
      const layerIndex = new LayerPassIndex(scene, [ZONE_LAYER, OVERLAY_LAYER])
      resources.layerIndex = layerIndex
      // Temporal AA / FXAA replace MSAA, and the ½-res GTAO gathers from this depth (no multisampled
      // `textureGather`): both want a single-sampled scene pass.
      const singleSampled = temporalAA || fxaaEnabled || aoTier === 'medium'
      const scenePass = pass(scene, camera, singleSampled ? { samples: 0 } : undefined)
      resources.passes.push(scenePass)
      scenePass.setLayers(sceneOnlyLayers)
      const zonePass = new LayerPassNode(layerIndex, camera, ZONE_LAYER, scenePass)
      resources.passes.push(zonePass)
      zonePass.setLayers(zoneLayers)
      // Editor overlays (gizmos, move handles, tool previews, grid) on their own
      // layer, kept out of the depth/normal MRT above so the ink + AO ignore
      // them, then composited on top of the final image below.
      const overlayPass = new LayerPassNode(layerIndex, camera, OVERLAY_LAYER, scenePass)
      resources.passes.push(overlayPass)
      overlayPass.setLayers(overlayLayers)
      const overlayColor = overlayPass.getTextureNode('output')

      const scenePassColor = scenePass.getTextureNode('output')

      // Background detection via alpha: renderer clears with alpha=0 (setClearAlpha(0) in useFrame),
      // so background pixels have scenePassColor.a=0 while geometry pixels have output.a=1.
      // WebGPU only applies clearColorValue to MRT attachment 0 (output), so scenePassColor.a
      // is the reliable geometry mask — no normals, no flicker.
      const hasGeometry = scenePassColor.a
      const contentAlpha = hasGeometry.max(zonePass.a)

      // Composite the zone-pass tint into the base scene so rooms show whether or
      // not AO is enabled. The medium-tier AO branch below rebuilds this
      // composite with the zone tint kept out of the AO (no double-add).
      const zoneRgb = daylight ? zonePass.rgb.mul(exposureInverse) : zonePass.rgb
      let sceneColor = vec4(
        add(scenePassColor.rgb, zoneRgb),
        contentAlpha,
      ) as unknown as ReturnType<typeof vec4>

      // Scene depth is shared by AO, ink, and outlines.
      // The normal MRT is only built when the medium AO, TRAA or ink needs it.
      const scenePassDepth = scenePass.getTextureNode('depth')
      const sampleEdgeDepth = createEdgeDepthSampler(scenePassDepth, camera)
      let scenePassNormal: any = null
      if (needsNormalMRT) {
        scenePass.setMRT(
          scenePassMrt({
            output,
            diffuseColor,
            normal: packNormalToRGB(normalView),
            lighting: sceneLightingMask(),
            ...(temporalAA && aoTier !== 'high' ? { velocity } : {}),
          }),
        )
        scenePassNormal = scenePass.getTextureNode('normal')
      }
      if (scenePassNormal) {
        const normalTexture = scenePass.getTexture('normal')
        normalTexture.type = UnsignedByteType
        scenePass.getTexture('lighting').type = UnsignedByteType
      }
      // Extract normal from color-encoded texture (GTAO consumes the node form).
      const normalNode = scenePassNormal
      const sceneNormal = normalNode
        ? sample((uv) => unpackRGBToNormal(normalNode.sample(uv)))
        : null

      // AO + temporal AA. High: a depth/normal/velocity pre-pass feeds GTAO, injected into the
      // scene pass's lighting (darkens indirect light only — no grime on sunlit walls). Medium: no
      // pre-pass; ½-res GTAO from the scene pass, blended softly over the whole image.
      let temporalDepth: any = null
      let temporalVelocity: any = null
      if (aoTier === 'high') {
        // Single-sampled: GTAO gathers from the depth texture (no multisampled `textureGather`).
        const prePass = pass(scene, camera, { samples: 0 })
        resources.passes.push(prePass)
        prePass.setLayers(sceneOnlyLayers)
        prePass.transparent = false
        prePass.setMRT(mrt({ output: normalView, velocity }))
        const preDepth = prePass.getTextureNode('depth')
        const aoNode = gtao(preDepth, prePass.getTextureNode('output'), camera) as any
        aoNode.radius.value = 0.6
        aoNode.thickness.value = 1
        aoNode.distanceExponent.value = 1.6
        aoNode.samples.value = 16
        aoNode.useTemporalFiltering = temporalAA
        resources.effects.push(aoNode)
        const screenAO = aoNode.getTextureNode().sample(screenUV).r
        scenePass.contextNode = daylight
          ? daylightRoomContext(screenAO)
          : builtinAOContext(screenAO)
        temporalDepth = preDepth
        temporalVelocity = prePass.getTextureNode('velocity')
      } else if (aoTier === 'medium' && sceneNormal && scenePassDepth) {
        const aoNode = gtao(scenePassDepth, sceneNormal, camera) as any
        aoNode.radius.value = 0.6
        aoNode.thickness.value = 1.2
        aoNode.distanceExponent.value = 1.4
        aoNode.samples.value = 16
        aoNode.resolutionScale = 0.5
        resources.effects.push(aoNode)
        const aoBlend = mix(
          tslFloat(1),
          aoNode.getTextureNode().sample(screenUV).r,
          MEDIUM_AO_BLEND,
        )
        sceneColor = vec4(add(scenePassColor.rgb.mul(aoBlend), zoneRgb), contentAlpha)
      }
      // The daylight look's room light (windows, lamps, bounce, night spill) on the other tiers.
      if (daylight && aoTier !== 'high') scenePass.contextNode = daylightRoomContext(null)
      if (temporalAA && !temporalVelocity && scenePassNormal) {
        temporalDepth = scenePassDepth
        temporalVelocity = scenePass.getTextureNode('velocity')
      }

      // Screen-space ink outline (SketchUp look) — depth/normal edge detection
      // over the composited scene. Topology-agnostic, so it handles CSG-cut
      // walls cleanly. Applied before the selection outline + background mix.
      if (inkEnabled && scenePassDepth && scenePassNormal) {
        sceneColor = vec4(
          inkedEdges({
            sceneRgb: sceneColor.rgb,
            sampleDepth: sampleEdgeDepth,
            normalTex: scenePassNormal,
            inkColor: inkColorUniform.current,
            radius: inkRadius,
            opacity: tslFloat(inkOpacity).mul(inkOpacityScaleUniform.current),
          }),
          sceneColor.a,
        )
      }

      // Bloom on the HDR image; the threshold follows exposure so only display-white blooms.
      if (bloomEnabled) {
        const glow = bloom(
          sceneColor,
          DAYLIGHT_BLOOM.strength,
          DAYLIGHT_BLOOM.radius,
          exposureInverse,
        ) as any
        glow.smoothWidth.value = DAYLIGHT_BLOOM.softKnee
        resources.effects.push(glow)
        sceneColor = vec4(sceneColor.rgb.add(glow.rgb), sceneColor.a)
      }

      // Scene-referred grade (contrast around mid-gray + saturation) before the
      // pipeline's output tone mapping. The same transform is applied to the
      // backdrop below so geometry that fades to the background colour (the
      // horizon disc) matches it exactly. The daylight look adds eye-like white
      // balance (sky and scene alike).
      const gradeRgb = (rgb: any) =>
        daylight
          ? daylightGradeRgb(rgb, whiteBalance)
          : saturation(
              rgb.div(0.18).pow(vec3(GRADE_PARAMS.contrast)).mul(0.18),
              GRADE_PARAMS.saturation,
            )
      const graded = colorGrading
      if (graded) {
        sceneColor = vec4(gradeRgb(sceneColor.rgb), sceneColor.a)
      }

      // Reused scene depth lets outlined groups occlude each other; materials
      // with depthWrite=false (including glazing) no longer occlude outlines.
      const outliner = useViewer.getState().outliner
      let compositeWithOutlines = sceneColor
      let visualAlpha = contentAlpha
      if (outlineEnabled) {
        const outlineNode = mergedOutline(scene, camera, {
          sceneDepthNode: scenePassDepth,
          primaryObjects: outliner.selectedObjects,
          secondaryObjects: outliner.hoveredObjects,
          primaryEdgeThickness: uniform(1),
          secondaryEdgeThickness: uniform(1.5),
        })

        resources.outline = outlineNode

        // Selected: white visible, yellow hidden
        const selectedVisibleColor = uniform(new Color(0xff_ff_ff))
        const selectedHiddenColor = uniform(new Color(0xf3_ff_47))
        const selectedStrength = uniform(3)
        const selectedOutline = outlineNode.primaryVisibleEdge
          .mul(selectedVisibleColor)
          .add(outlineNode.primaryHiddenEdge.mul(selectedHiddenColor))
          .mul(selectedStrength)

        // Hovered: blue visible, yellow hidden, pulsing
        const pulsePeriod = uniform(3)
        const oscillating = oscSine(time.div(pulsePeriod).mul(2)).mul(0.5).add(0.5)
        const osc = mix(oscillating, tslFloat(1), hoverPulseMix)
        const hoverOutline = outlineNode.secondaryVisibleEdge
          .mul(hoverVisibleColor)
          .add(outlineNode.secondaryHiddenEdge.mul(hoverHiddenColor))
          .mul(hoverStrength)
          .mul(osc)

        const outlineAlpha = outlineNode.primaryVisibleEdge
          .max(outlineNode.primaryHiddenEdge)
          .max(outlineNode.secondaryVisibleEdge)
          .max(outlineNode.secondaryHiddenEdge)
        visualAlpha = visualAlpha.max(outlineAlpha)
        compositeWithOutlines = vec4(
          add(
            sceneColor.rgb,
            daylight
              ? selectedOutline.add(hoverOutline).mul(exposureInverse)
              : selectedOutline.add(hoverOutline),
          ),
          sceneColor.a,
        )
      }

      // Backdrop: world-space view ray per pixel → background / horizon haze /
      // sky gradient (shared formula in lib/backdrop.ts). The horizon disc
      // dissolves into the same formula, so backdrop and ground meet
      // seamlessly exactly where the disc vanishes.
      const ndc = vec4(
        screenUV.x.mul(2).sub(1),
        tslFloat(1).sub(screenUV.y).mul(2).sub(1),
        1,
        1,
      ) as any
      const viewRay = (camProjInvUniform.current as any).mul(ndc)
      const worldDir = (camWorldUniform.current as any).mul(vec4(viewRay.xyz, 0)).xyz.normalize()
      let bgGradient = atmosphere
        ? atmosphere.skyRadiance(worldDir)
        : backdropGradient({
            dirY: worldDir.y,
            background: bgUniform.current,
            haze: bgHazeUniform.current,
            sky: bgSkyUniform.current,
            skyDeep: bgSkyDeepUniform.current,
          })
      if (graded) {
        bgGradient = gradeRgb(bgGradient)
      }
      let sceneComposite = compositeWithOutlines.rgb
      // Under the ground (the eye below the ground surface) the scene goes to its dark mode: the
      // sky is the dark theme's backdrop, and what stands far from the shown level dissolves into
      // it (distance outside the level's box, from the scene pass's own depth; backdrop and fog
      // meet in one colour per pixel). A noise mask closes over the screen as the eye crosses,
      // 0 everywhere above the ground, 1 everywhere below.
      let dive: ReturnType<typeof undergroundDissolve> | null = null
      if (!transparentBackground) {
        const grain = undergroundDissolveGrain()
        dive = undergroundDissolve(screenUV, undergroundAmbianceNode(), grain)
        // The backdrop follows the earth factor, which is the dark mode's own in the overview and
        // alone in the walkthrough (looking out of a basement window shows earth, the rooms keep
        // their light: no fog, no vignette).
        const earthDive = undergroundDissolve(screenUV, undergroundEarthNode(), grain)
        const dark = undergroundBackdrop(worldDir.y)
        // The day's backdrop leaves ahead of the blobs: it greys and dims over the first half of
        // the crossing, so the anthracite spreads over a neutral grey picture, not a blue sky.
        const leaving = smoothstep(tslFloat(0), tslFloat(0.5), undergroundEarthNode())
        const day = saturation(bgGradient, tslFloat(1).sub(leaving)).mul(
          tslFloat(1).sub(leaving.mul(0.35)),
        )
        bgGradient = mix(day, dark, earthDive)
        const worldPosition = worldPositionFromDepth(
          scenePassDepth.sample(screenUV).r,
          camProjInvUniform.current,
          camWorldUniform.current,
        )
        sceneComposite = mix(sceneComposite, dark, undergroundFogAmount(worldPosition).mul(dive))
      }
      let composited = mix(bgGradient, sceneComposite, contentAlpha)
      // Temporal AA resolves the whole picture, so silhouettes against the sky are smoothed too.
      // Its history is only valid where the 3×3 neighbourhood holds geometry (open sky, at the far
      // plane, resolves to black), so the sky away from geometry keeps the direct backdrop.
      if (temporalAA && temporalVelocity && temporalDepth) {
        const temporal = traa(vec4(composited, 1), temporalDepth, temporalVelocity, camera) as any
        resources.effects.push(temporal)
        let nearGeometry: any = contentAlpha
        for (const [x, y] of NEIGHBOURS_3X3) {
          nearGeometry = nearGeometry.max(scenePassColor.offset(ivec2(x, y)).a)
        }
        composited = mix(composited, temporal.rgb, nearGeometry.greaterThan(0).select(1, 0))
      }
      // The screen's edges close in with it.
      if (dive) {
        composited = mix(
          composited,
          tslColor(UNDERGROUND_VIGNETTE),
          undergroundVignette().mul(dive),
        )
      }
      // Display-space picture: tone mapping + colour space, then the daylight vignette (after the
      // tone mapping, as in the reference). Editor overlays are painted on top by their own alpha —
      // they never get inked, AO'd, outlined or vignetted, and always read crisp.
      const toDisplay = (rgb: any) =>
        renderOutput(vec4(rgb, 1), renderer.toneMapping, renderer.outputColorSpace)
      let displayScene: any = toDisplay(composited)
      if (daylight) {
        const vignette = tslLength(screenUV.sub(0.5))
          .mul(1.35)
          .pow(2.5)
          .mul(DAYLIGHT_GRADE.vignette)
        displayScene = vec4(displayScene.rgb.mul(tslFloat(1).sub(vignette)), 1)
      }
      let finalOutput: ReturnType<typeof premultiplyAlpha> | ReturnType<typeof vec4> = vec4(
        mix(
          displayScene.rgb,
          toDisplay(daylight ? overlayColor.rgb.mul(exposureInverse) : overlayColor.rgb).rgb,
          overlayColor.a,
        ),
        tslFloat(1),
      )
      if (transparentBackground) {
        const overlayAlpha = overlayColor.a
        const alpha = overlayAlpha.add(visualAlpha.mul(overlayAlpha.oneMinus()))
        const straightRgb = overlayColor.rgb
          .mul(overlayAlpha)
          .add(sceneComposite.mul(visualAlpha).mul(overlayAlpha.oneMinus()))
          .div(alpha.max(tslFloat(0.00001)))
        finalOutput = premultiplyAlpha(renderOutput(vec4(straightRgb, alpha)))
      } else if (flatBackground && !atmosphere) {
        const backdrop = flatBackdropOutput({
          background: bgUniform.current,
          foreground: sceneComposite,
          alpha: contentAlpha,
          toneMapping: renderer.toneMapping,
          outputColorSpace: renderer.outputColorSpace,
        })
        const overlay = renderOutput(
          vec4(overlayColor.rgb, 1),
          renderer.toneMapping,
          renderer.outputColorSpace,
        )
        finalOutput = vec4(mix(backdrop.rgb, overlay.rgb, overlayColor.a), 1)
      }

      // Low tier: FXAA on the display image (no temporal AA, no MSAA).
      if (fxaaEnabled) finalOutput = fxaa(finalOutput) as any

      const renderPipeline = new RenderPipeline(renderer as unknown as WebGPURenderer)
      resources.pipeline = renderPipeline
      // Every branch above ends in display space.
      renderPipeline.outputColorTransform = false
      renderPipeline.outputNode = finalOutput
      retryCountRef.current = 0
    } catch (error) {
      hasPipelineErrorRef.current = true
      console.error(
        '[viewer/post-processing] Failed to set up post-processing pipeline. Rendering without post FX.',
        {
          version: pipelineVersion,
          rendererCtor: (renderer as any).constructor?.name,
        },
        error,
      )
      disposePipeline()
    }

    return disposePipeline
  }, [
    // NOTE: hoverHighlightMode intentionally excluded — the hover style is
    // pushed to uniforms in a separate effect, so a hover must NOT rebuild the
    // whole pipeline. The uniform refs below are stable (useMemo), so they
    // never trigger a rebuild either.
    atmosphere,
    camera,
    disablePostFx,
    disposePipeline,
    hoverHiddenColor,
    hoverPulseMix,
    hoverStrength,
    hoverVisibleColor,
    edges,
    inkOpacityOverride,
    pipelineVersion,
    projectId,
    renderer,
    scene,
    ambientOcclusion,
    colorGrading,
    flatBackground,
    transparentBackground,
    renderQuality,
    whiteBalance,
    exposureInverse,
    size.height,
    size.width,
    zoneLayers,
    sceneOnlyLayers,
    overlayLayers,
  ])

  useFrame((_, delta) => {
    if (size.width < 1 || size.height < 1) {
      return
    }

    // A capture is working on the shared scene: the canvas keeps its last frame.
    if (isLiveFrameHeld()) return

    // `?disable=draw`: nothing downstream wants pixels — render an EMPTY scene
    // instead of the real one. This is the only render call (positive-priority
    // useFrame subscribers already disable R3F's automatic render), so the real
    // scene is never drawn: per-frame vertex/draw cost drops to a single 64×64
    // clear, which is what makes headless bakes viable on SwiftShader (CPU).
    // Rendering nothing at all is NOT an option — with zero submitted frames
    // Chromium's no-damage scheduler throttles rAF to 1Hz (measured), stalling
    // the useFrame systems the bake still needs.
    if (PERF_DRAW_DISABLED) {
      try {
        ;(renderer as any).render(emptyScene, camera)
      } catch {
        // A failed empty draw changes nothing — systems keep ticking.
      }
      return
    }

    // Animate background colour toward the current scene theme target (same lerp as AnimatedBackground)
    const bgTheme = useViewer.getState().sceneAppearance
    const backdrop = backdropColors(bgTheme)
    bgTarget.current.set(bgTheme.background)
    bgCurrent.current.lerp(bgTarget.current, Math.min(delta, 0.1) * 4)
    bgUniform.current.value.copy(bgCurrent.current)
    bgSkyTarget.current.set(backdrop.sky)
    bgSkyCurrent.current.lerp(bgSkyTarget.current, Math.min(delta, 0.1) * 4)
    bgSkyUniform.current.value.copy(bgSkyCurrent.current)
    bgHazeTarget.current.set(backdrop.haze)
    bgHazeCurrent.current.lerp(bgHazeTarget.current, Math.min(delta, 0.1) * 4)
    bgHazeUniform.current.value.copy(bgHazeCurrent.current)
    bgSkyDeepTarget.current.set(backdrop.skyDeep)
    bgSkyDeepCurrent.current.lerp(bgSkyDeepTarget.current, Math.min(delta, 0.1) * 4)
    bgSkyDeepUniform.current.value.copy(bgSkyDeepCurrent.current)
    if (isDaylight(atmosphere)) whiteBalance.value.copy(atmosphere.whiteBalance)
    exposureInverse.value = 1 / Math.max(renderer.toneMappingExposure, 1e-3)
    camProjInvUniform.current.value.copy(camera.projectionMatrixInverse)
    camWorldUniform.current.value.copy(camera.matrixWorld)
    // Ink colour follows the (lerping) background luminance — snaps dark↔light. The daylight
    // look ignores the scene theme: its edges are always the light-backdrop ink.
    const bgHex = isDaylight(atmosphere)
      ? DAYLIGHT_INK_BACKDROP
      : `#${bgCurrent.current.getHexString()}`
    inkColorUniform.current.value.set(edgeColorFor(bgHex))
    inkOpacityScaleUniform.current.value = edgeOpacityScaleFor(bgHex)

    const outliner = useViewer.getState().outliner
    const restoreAtmosphere = refreshIsolation(scene)
    sanitizeOutlineObjects(outliner.selectedObjects)
    sanitizeOutlineObjects(outliner.hoveredObjects)

    if (
      disablePostFx ||
      PERF_POST_FX_DISABLED ||
      hasPipelineErrorRef.current ||
      !resourcesRef.current?.pipeline
    ) {
      const previousBackgroundNode = scene.backgroundNode
      if (directSkyNode && !transparentBackground) scene.backgroundNode = directSkyNode
      try {
        const clearAlpha = transparentBackground ? 0 : 1
        // Without the pipeline there is no fog and no vignette: the clear colour is the dark mode's.
        const underground = transparentBackground ? 0 : earthNow()
        const clearColor =
          underground > 0 ? fallbackClear.current.copy(bgCurrent.current) : bgCurrent.current
        if (underground > 0) clearColor.lerp(fallbackEarth.current, underground)
        if ((renderer as any).setClearColor) {
          ;(renderer as any).setClearColor(clearColor, clearAlpha)
        } else if ((renderer as any).setClearAlpha) {
          ;(renderer as any).setClearAlpha(clearAlpha)
        }
        const submittedAt = PERF_OVERLAY_ENABLED ? performance.now() : 0
        timeSpan('render-encode', () => {
          ;(renderer as any).render(scene, camera)
        })
        if (PERF_OVERLAY_ENABLED) recordFrameGpuTiming(renderer, submittedAt)
      } catch (fallbackError) {
        console.error('[viewer/post-processing] Fallback render failed.', fallbackError)
      } finally {
        scene.backgroundNode = previousBackgroundNode
        restoreAtmosphere()
      }
      return
    }

    const pipeline = resourcesRef.current.pipeline
    try {
      // Clear alpha=0 so background pixels in the output MRT attachment (index 0) get a=0,
      // making scenePassColor.a a reliable geometry mask (geometry pixels write a=1 via output node).
      ;(renderer as any).setClearAlpha(0)
      const submittedAt = PERF_OVERLAY_ENABLED ? performance.now() : 0
      timeSpan('render-encode', () => {
        pipeline.render()
      })
      if (PERF_OVERLAY_ENABLED) recordFrameGpuTiming(renderer, submittedAt)
    } catch (error) {
      hasPipelineErrorRef.current = true
      // A failed MRT pass may leave its target bound; clear it before the fallback render.
      ;(renderer as any).setRenderTarget?.(null)
      console.error('[viewer/post-processing] Render pass failed.', {
        retryCount: retryCountRef.current,
        rendererCtor: (renderer as any).constructor?.name,
        error,
      })
      disposePipeline()

      if (retryCountRef.current < MAX_PIPELINE_RETRIES) {
        // Auto-retry: schedule a pipeline rebuild if we haven't exceeded the retry limit
        retryCountRef.current++
        if (rebuildTimeoutRef.current !== null) {
          clearTimeout(rebuildTimeoutRef.current)
        }
        rebuildTimeoutRef.current = setTimeout(requestPipelineRebuild, RETRY_DELAY_MS)
      } else {
        console.error(
          '[viewer/post-processing] Retries exhausted. Rendering without post FX for this session.',
        )
      }
    } finally {
      restoreAtmosphere()
    }
  }, 1)

  return null
}

export default PostProcessingPasses
