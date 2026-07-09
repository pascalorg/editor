import { useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Color, Layers, type Object3D, Scene, UnsignedByteType } from 'three'
import { ssgi } from 'three/addons/tsl/display/SSGINode.js'
import { denoise } from 'three/examples/jsm/tsl/display/DenoiseNode.js'
import {
  add,
  colorToDirection,
  diffuseColor,
  directionToColor,
  float,
  mix,
  mrt,
  normalView,
  oscSine,
  output,
  pass,
  premultiplyAlpha,
  renderOutput,
  sample,
  time,
  uniform,
  vec4,
} from 'three/tsl'
import { RenderPipeline, type WebGPURenderer } from 'three/webgpu'
import { edgeColorFor } from '../../lib/edge-style'
import { PERF_OVERLAY_ENABLED, pushGpuSample } from '../../lib/gpu-perf'
import { inkedEdges } from '../../lib/ink-edges'
import { GRID_LAYER, OVERLAY_LAYER, SCENE_LAYER, ZONE_LAYER } from '../../lib/layers'
import { mergedOutline } from '../../lib/merged-outline-node'
import { getSceneTheme } from '../../lib/scene-themes'
import useViewer from '../../store/use-viewer'

// SSGI Parameters - adjust these to fine-tune global illumination and ambient occlusion
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

// Diagnostic toggles for thermal A/B testing. Add `?disable=ao,denoise,outline,postFx`
// to the URL (any subset) and reload to skip those passes. Each flag prevents
// allocation + per-frame work for that stage, so device temperature deltas
// across combos isolate which pass is the actual culprit. Picked up once at
// pipeline build; reload after changing the URL.
//   - ao:      skip SSGI entirely (and denoise, since denoise has nothing to denoise)
//   - denoise: keep SSGI but feed its raw noisy AO straight to the composite
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
    return { ao: false, denoise: false, outline: false, postFx: false }
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

const PostProcessingPasses = ({
  hoverStyles = DEFAULT_HOVER_STYLES,
  disablePostFx = false,
}: {
  hoverStyles?: HoverStyles
  /** Host-controlled equivalent of `?disable=postFx` — see the Viewer prop. */
  disablePostFx?: boolean
}) => {
  const { gl: renderer, invalidate, scene, camera, size } = useThree()
  const renderPipelineRef = useRef<RenderPipeline | null>(null)
  const hasPipelineErrorRef = useRef(false)
  const retryCountRef = useRef(0)
  const rebuildTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const skippedZeroSizeRef = useRef(false)

  // Background color uniform — updated every frame via lerp, read by the TSL pipeline.
  // Initialised from the current scene theme so there's no flash on first render.
  const initBg = getSceneTheme(useViewer.getState().sceneTheme).background
  const bgUniform = useRef(uniform(new Color(initBg)))
  const bgCurrent = useRef(new Color(initBg))
  const bgTarget = useRef(new Color())

  // Ink-line colour follows the scene-theme background luminance (dark lines on
  // light scenes, light on dark), refreshed each frame like the background.
  const inkColorUniform = useRef(uniform(new Color(edgeColorFor(initBg))))

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
  // a flat, depth-non-writing plane so the ink never picks it up.
  const sceneOnlyLayers = useMemo(() => {
    const l = new Layers()
    l.set(SCENE_LAYER)
    l.enable(GRID_LAYER)
    return l
  }, [])
  // Editor overlays render in their own pass, composited on top after the ink
  // and outlines so they read as crisp UI rather than scene geometry.
  const overlayLayers = useMemo(() => {
    const l = new Layers()
    l.set(OVERLAY_LAYER)
    return l
  }, [])
  const hoverHighlightMode = useViewer((s) => s.hoverHighlightMode)
  const hoverVisibleColor = useMemo(() => uniform(new Color(DEFAULT_HOVER_STYLE.visibleColor)), [])
  const hoverHiddenColor = useMemo(() => uniform(new Color(DEFAULT_HOVER_STYLE.hiddenColor)), [])
  const hoverStrength = useMemo(() => uniform(DEFAULT_HOVER_STYLE.strength), [])
  const hoverPulseMix = useMemo(() => uniform(DEFAULT_HOVER_STYLE.pulse ? 0 : 1), [])

  // Subscribe to projectId so the pipeline rebuilds on project switch
  const projectId = useViewer((s) => s.projectId)
  const shading = useViewer((s) => s.shading)
  const edges = useViewer((s) => s.edges)
  const inkOpacityOverride = useViewer((s) => s.inkOpacity)
  const transparentBackground = useViewer((s) => s.transparentBackground)
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
      if (renderPipelineRef.current) {
        renderPipelineRef.current.dispose()
      }
      renderPipelineRef.current = null
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
      if (renderPipelineRef.current) {
        renderPipelineRef.current.dispose()
      }
      renderPipelineRef.current = null
      return
    }
    const ssgiEnabled = shading === 'rendered' && SSGI_PARAMS.enabled && !perfDisable.ao
    const denoiseEnabled = ssgiEnabled && !perfDisable.denoise
    const outlineEnabled = !perfDisable.outline
    const inkEnabled = edges !== 'off'
    // The depth+normal MRT feeds both SSGI and the screen-space ink pass.
    const needsNormalMRT = ssgiEnabled || inkEnabled
    // Soft = thin (1px sample radius) + faint (50% opacity); strong = thick
    // (2px, ~2× wider detected band) + solid (100%). The edge masks saturate,
    // so radius+opacity are what actually separate the two modes — gain wouldn't.
    // Same 1px line thickness for both (soft's thickness is the nice one);
    // strong reads heavier purely by being fully solid vs soft's lighter 50%.
    const inkRadius = 1
    const inkOpacity = inkOpacityOverride ?? (edges === 'strong' ? 1 : 0.5)

    console.log('[viewer/post-processing] Building pipeline', {
      version: pipelineVersion,
      ssgi: ssgiEnabled,
      denoise: denoiseEnabled,
      outline: outlineEnabled,
      perfDisable,
      projectId,
      shading,
      transparentBackground,
      rendererCtor: (renderer as any).constructor?.name,
      width,
      height,
    })

    hasPipelineErrorRef.current = false

    // WebGPU availability check: SSGI, denoise, and RenderPipeline are all
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
      renderPipelineRef.current = null
      return
    }

    // Clear outliner arrays synchronously to prevent stale Object3D refs
    // from the previous project leaking into the new pipeline's outline passes.
    const outliner = useViewer.getState().outliner
    sanitizeOutlineObjects(outliner.selectedObjects)
    sanitizeOutlineObjects(outliner.hoveredObjects)
    outliner.selectedObjects.length = 0
    outliner.hoveredObjects.length = 0

    try {
      const scenePass = pass(scene, camera)
      scenePass.setLayers(sceneOnlyLayers)
      const zonePass = pass(scene, camera)
      zonePass.setLayers(zoneLayers)
      // Editor overlays (gizmos, move handles, tool previews, grid) on their own
      // layer, kept out of the depth/normal MRT above so the ink + SSGI ignore
      // them, then composited on top of the final image below.
      const overlayPass = pass(scene, camera)
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
      // not SSGI is enabled. When SSGI is on, the branch below overwrites this
      // with its own zone-inclusive composite (no double-add).
      let sceneColor = vec4(
        add(scenePassColor.rgb, zonePass.rgb),
        contentAlpha,
      ) as unknown as ReturnType<typeof vec4>

      // Depth + normal MRT — shared by SSGI (diffuse/normal) and the ink pass
      // (depth/normal). Built whenever either is active.
      let scenePassDepth: any = null
      let scenePassNormal: any = null
      let sceneNormal: any = null
      if (needsNormalMRT) {
        scenePass.setMRT(
          mrt({
            output,
            diffuseColor,
            normal: directionToColor(normalView),
          }),
        )
        scenePassDepth = scenePass.getTextureNode('depth')
        scenePassNormal = scenePass.getTextureNode('normal')
        const normalTexture = scenePass.getTexture('normal')
        normalTexture.type = UnsignedByteType
        // Extract normal from color-encoded texture (SSGI consumes the node form)
        sceneNormal = sample((uv) => colorToDirection(scenePassNormal.sample(uv)))
      }

      if (ssgiEnabled) {
        const scenePassDiffuse = scenePass.getTextureNode('diffuseColor')
        const diffuseTexture = scenePass.getTexture('diffuseColor')
        diffuseTexture.type = UnsignedByteType

        const giPass = ssgi(scenePassColor, scenePassDepth, sceneNormal, camera as any)
        giPass.sliceCount.value = SSGI_PARAMS.sliceCount
        giPass.stepCount.value = SSGI_PARAMS.stepCount
        giPass.radius.value = SSGI_PARAMS.radius
        giPass.expFactor.value = SSGI_PARAMS.expFactor
        giPass.thickness.value = SSGI_PARAMS.thickness
        giPass.backfaceLighting.value = SSGI_PARAMS.backfaceLighting
        giPass.aoIntensity.value = SSGI_PARAMS.aoIntensity
        giPass.giIntensity.value = SSGI_PARAMS.giIntensity
        giPass.useLinearThickness.value = SSGI_PARAMS.useLinearThickness
        giPass.useScreenSpaceSampling.value = SSGI_PARAMS.useScreenSpaceSampling
        giPass.useTemporalFiltering = SSGI_PARAMS.useTemporalFiltering

        const giTexture = (giPass as any).getTextureNode()

        const gi = giPass.rgb
        let ao: any
        if (denoiseEnabled) {
          // DenoiseNode only denoises RGB — alpha is passed through unchanged.
          // SSGI packs AO into alpha, so we remap it into RGB before denoising.
          const aoAsRgb = vec4(giTexture.a, giTexture.a, giTexture.a, float(1))
          const denoisePass = denoise(aoAsRgb, scenePassDepth, sceneNormal, camera)
          denoisePass.index.value = 0
          denoisePass.radius.value = 4
          ao = (denoisePass as any).r
        } else {
          // Diagnostic path: feed raw noisy SSGI AO straight through. Will
          // look grainy — that's the point, it isolates denoise cost.
          ao = giTexture.a
        }

        // Composite: scene * AO + diffuse * GI
        sceneColor = vec4(
          add(scenePassColor.rgb.mul(ao), add(zonePass.rgb, scenePassDiffuse.rgb.mul(gi))),
          contentAlpha,
        )
      }

      // Screen-space ink outline (SketchUp look) — depth/normal edge detection
      // over the composited scene. Topology-agnostic, so it handles CSG-cut
      // walls cleanly. Applied before the selection outline + background mix.
      if (inkEnabled) {
        sceneColor = vec4(
          inkedEdges({
            sceneRgb: sceneColor.rgb,
            depthTex: scenePassDepth,
            normalTex: scenePassNormal,
            inkColor: inkColorUniform.current,
            radius: inkRadius,
            opacity: inkOpacity,
          }),
          sceneColor.a,
        )
      }

      // Single merged outline node: one shared depth pass for both selected + hovered groups.
      const outliner = useViewer.getState().outliner
      let compositeWithOutlines = sceneColor
      let visualAlpha = contentAlpha
      if (outlineEnabled) {
        const outlineNode = mergedOutline(scene, camera, {
          primaryObjects: outliner.selectedObjects,
          secondaryObjects: outliner.hoveredObjects,
          primaryEdgeThickness: uniform(1),
          secondaryEdgeThickness: uniform(1.5),
        })

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
        const osc = mix(oscillating, float(1), hoverPulseMix)
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
          add(sceneColor.rgb, selectedOutline.add(hoverOutline)),
          sceneColor.a,
        )
      }

      const composited = mix(bgUniform.current, compositeWithOutlines.rgb, contentAlpha)
      // Editor overlays painted on top by their own alpha — they never get inked,
      // AO'd, or outlined, and always read crisp regardless of scene depth.
      const withOverlay = mix(composited, overlayColor.rgb, overlayColor.a)
      let finalOutput: ReturnType<typeof premultiplyAlpha> | ReturnType<typeof vec4> = vec4(
        withOverlay,
        float(1),
      )
      if (transparentBackground) {
        const overlayAlpha = overlayColor.a
        const alpha = overlayAlpha.add(visualAlpha.mul(overlayAlpha.oneMinus()))
        const straightRgb = overlayColor.rgb
          .mul(overlayAlpha)
          .add(compositeWithOutlines.rgb.mul(visualAlpha).mul(overlayAlpha.oneMinus()))
          .div(alpha.max(float(0.00001)))
        finalOutput = premultiplyAlpha(renderOutput(vec4(straightRgb, alpha)))
      }

      const renderPipeline = new RenderPipeline(renderer as unknown as WebGPURenderer)
      renderPipeline.outputColorTransform = !transparentBackground
      renderPipeline.outputNode = finalOutput
      renderPipelineRef.current = renderPipeline
      retryCountRef.current = 0
    } catch (error) {
      hasPipelineErrorRef.current = true
      console.error(
        '[viewer/post-processing] Failed to set up post-processing pipeline. Rendering without post FX.',
        {
          version: pipelineVersion,
          ssgi: SSGI_PARAMS.enabled,
          rendererCtor: (renderer as any).constructor?.name,
        },
        error,
      )
      if (renderPipelineRef.current) {
        renderPipelineRef.current.dispose()
      }
      renderPipelineRef.current = null
    }

    return () => {
      if (renderPipelineRef.current) {
        renderPipelineRef.current.dispose()
      }
      renderPipelineRef.current = null
    }
  }, [
    // NOTE: hoverHighlightMode intentionally excluded — the hover style is
    // pushed to uniforms in a separate effect, so a hover must NOT rebuild the
    // whole pipeline. The uniform refs below are stable (useMemo), so they
    // never trigger a rebuild either.
    camera,
    disablePostFx,
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
    shading,
    transparentBackground,
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
    bgTarget.current.set(getSceneTheme(useViewer.getState().sceneTheme).background)
    bgCurrent.current.lerp(bgTarget.current, Math.min(delta, 0.1) * 4)
    bgUniform.current.value.copy(bgCurrent.current)
    // Ink colour follows the (lerping) background luminance — snaps dark↔light.
    inkColorUniform.current.value.set(edgeColorFor(`#${bgCurrent.current.getHexString()}`))

    const outliner = useViewer.getState().outliner
    sanitizeOutlineObjects(outliner.selectedObjects)
    sanitizeOutlineObjects(outliner.hoveredObjects)

    if (
      disablePostFx ||
      PERF_POST_FX_DISABLED ||
      hasPipelineErrorRef.current ||
      !renderPipelineRef.current
    ) {
      try {
        if ((renderer as any).setClearAlpha) {
          ;(renderer as any).setClearAlpha(transparentBackground ? 0 : 1)
        }
        const submittedAt = PERF_OVERLAY_ENABLED ? performance.now() : 0
        ;(renderer as any).render(scene, camera)
        if (PERF_OVERLAY_ENABLED) {
          const queue = (renderer as any).backend?.device?.queue as
            | { onSubmittedWorkDone?: () => Promise<void> }
            | undefined
          queue?.onSubmittedWorkDone?.().then(() => {
            pushGpuSample(performance.now() - submittedAt)
          })
        }
      } catch (fallbackError) {
        console.error('[viewer/post-processing] Fallback render failed.', fallbackError)
      }
      return
    }

    try {
      // Clear alpha=0 so background pixels in the output MRT attachment (index 0) get a=0,
      // making scenePassColor.a a reliable geometry mask (geometry pixels write a=1 via output node).
      ;(renderer as any).setClearAlpha(0)
      const submittedAt = PERF_OVERLAY_ENABLED ? performance.now() : 0
      renderPipelineRef.current.render()
      if (PERF_OVERLAY_ENABLED) {
        // device.queue.onSubmittedWorkDone() resolves once the GPU has
        // finished the work we just submitted — the delta from our submit
        // timestamp is a clean per-frame GPU duration. Doesn't block CPU
        // (no await) and works for the custom RenderPipeline path that
        // bypasses three.js's timestamp-query infrastructure.
        const queue = (renderer as any).backend?.device?.queue as
          | { onSubmittedWorkDone?: () => Promise<void> }
          | undefined
        queue?.onSubmittedWorkDone?.().then(() => {
          pushGpuSample(performance.now() - submittedAt)
        })
      }
    } catch (error) {
      hasPipelineErrorRef.current = true
      console.error('[viewer/post-processing] Render pass failed.', {
        retryCount: retryCountRef.current,
        rendererCtor: (renderer as any).constructor?.name,
        error,
      })
      if (renderPipelineRef.current) {
        renderPipelineRef.current.dispose()
      }
      renderPipelineRef.current = null

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
    }
  }, 1)

  return null
}

export default PostProcessingPasses
