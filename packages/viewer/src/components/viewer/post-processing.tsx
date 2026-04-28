import { useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Color, Layers, type Object3D, UnsignedByteType } from 'three'
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
  sample,
  time,
  uniform,
  vec4,
} from 'three/tsl'
import { RenderPipeline, type WebGPURenderer } from 'three/webgpu'
import { SCENE_LAYER, ZONE_LAYER } from '../../lib/layers'
import { mergedOutline } from '../../lib/merged-outline-node'
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

const MAX_PIPELINE_RETRIES = 3
const RETRY_DELAY_MS = 500

const DARK_BG = '#1f2433'
const LIGHT_BG = '#ffffff'

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
}: {
  hoverStyles?: HoverStyles
}) => {
  const { gl: renderer, invalidate, scene, camera } = useThree()
  const renderPipelineRef = useRef<RenderPipeline | null>(null)
  const hasPipelineErrorRef = useRef(false)
  const retryCountRef = useRef(0)
  const rebuildTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Background color uniform — updated every frame via lerp, read by the TSL pipeline.
  // Initialised from the current theme so there's no flash on first render.
  const initBg = useViewer.getState().theme === 'dark' ? DARK_BG : LIGHT_BG
  const bgUniform = useRef(uniform(new Color(initBg)))
  const bgCurrent = useRef(new Color(initBg))
  const bgTarget = useRef(new Color())

  const zoneLayers = useMemo(() => {
    const l = new Layers()
    l.enable(ZONE_LAYER)
    l.disable(SCENE_LAYER)
    return l
  }, [])
  const hoverHighlightMode = useViewer((s) => s.hoverHighlightMode)
  const hoverVisibleColor = useMemo(() => uniform(new Color(DEFAULT_HOVER_STYLE.visibleColor)), [])
  const hoverHiddenColor = useMemo(() => uniform(new Color(DEFAULT_HOVER_STYLE.hiddenColor)), [])
  const hoverStrength = useMemo(() => uniform(DEFAULT_HOVER_STYLE.strength), [])
  const hoverPulseMix = useMemo(() => uniform(DEFAULT_HOVER_STYLE.pulse ? 0 : 1), [])

  // Subscribe to projectId so the pipeline rebuilds on project switch
  const projectId = useViewer((s) => s.projectId)

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
    // Intentionally touch projectId so the effect reruns on project switches.
    void projectId
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
    // Intentionally touch these so React/biome treat project switches and retry bumps
    // as explicit rebuild triggers instead of accidental extra dependencies.
    void projectId
    void pipelineVersion

    if (!(renderer && scene && camera)) {
      console.warn('[viewer/post-processing] Skipping pipeline build — missing dependency.', {
        hasRenderer: !!renderer,
        hasScene: !!scene,
        hasCamera: !!camera,
      })
      return
    }

    console.log('[viewer/post-processing] Building pipeline', {
      version: pipelineVersion,
      ssgi: SSGI_PARAMS.enabled,
      hoverHighlightMode,
      projectId,
      rendererCtor: (renderer as any).constructor?.name,
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
      console.warn(
        '[viewer] WebGPU unavailable — rendering without post-processing (SSGI, outlines, denoise).',
      )
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
      const zonePass = pass(scene, camera)
      zonePass.setLayers(zoneLayers)

      const scenePassColor = scenePass.getTextureNode('output')

      // Background detection via alpha: renderer clears with alpha=0 (setClearAlpha(0) in useFrame),
      // so background pixels have scenePassColor.a=0 while geometry pixels have output.a=1.
      // WebGPU only applies clearColorValue to MRT attachment 0 (output), so scenePassColor.a
      // is the reliable geometry mask — no normals, no flicker.
      const hasGeometry = scenePassColor.a
      const contentAlpha = hasGeometry.max(zonePass.a)

      let sceneColor = scenePassColor as unknown as ReturnType<typeof vec4>

      if (SSGI_PARAMS.enabled) {
        // MRT only needed for SSGI (diffuse for GI, normal for SSGI sampling)
        scenePass.setMRT(
          mrt({
            output,
            diffuseColor,
            normal: directionToColor(normalView),
          }),
        )

        const scenePassDiffuse = scenePass.getTextureNode('diffuseColor')
        const scenePassDepth = scenePass.getTextureNode('depth')
        const scenePassNormal = scenePass.getTextureNode('normal')

        // Optimize texture bandwidth
        const diffuseTexture = scenePass.getTexture('diffuseColor')
        diffuseTexture.type = UnsignedByteType
        const normalTexture = scenePass.getTexture('normal')
        normalTexture.type = UnsignedByteType

        // Extract normal from color-encoded texture
        const sceneNormal = sample((uv) => colorToDirection(scenePassNormal.sample(uv)))

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

        // DenoiseNode only denoises RGB — alpha is passed through unchanged.
        // SSGI packs AO into alpha, so we remap it into RGB before denoising.
        const aoAsRgb = vec4(giTexture.a, giTexture.a, giTexture.a, float(1))
        const denoisePass = denoise(aoAsRgb, scenePassDepth, sceneNormal, camera)
        denoisePass.index.value = 0
        denoisePass.radius.value = 4

        const gi = giPass.rgb
        const ao = (denoisePass as any).r

        // Composite: scene * AO + diffuse * GI
        sceneColor = vec4(
          add(scenePassColor.rgb.mul(ao), add(zonePass.rgb, scenePassDiffuse.rgb.mul(gi))),
          contentAlpha,
        )
      }

      // Single merged outline node: one shared depth pass for both selected + hovered groups.
      const outliner = useViewer.getState().outliner
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

      const compositeWithOutlines = vec4(
        add(sceneColor.rgb, selectedOutline.add(hoverOutline)),
        sceneColor.a,
      )

      const finalOutput = vec4(
        mix(bgUniform.current, compositeWithOutlines.rgb, contentAlpha),
        float(1),
      )

      const renderPipeline = new RenderPipeline(renderer as unknown as WebGPURenderer)
      renderPipeline.outputNode = finalOutput
      renderPipelineRef.current = renderPipeline
      retryCountRef.current = 0
      console.log('[viewer/post-processing] Pipeline built OK', { version: pipelineVersion })
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
    camera,
    hoverHiddenColor,
    hoverPulseMix,
    hoverStrength,
    hoverVisibleColor,
    pipelineVersion,
    projectId,
    renderer,
    scene,
    zoneLayers,
  ])

  useFrame((_, delta) => {
    // Animate background colour toward the current theme target (same lerp as AnimatedBackground)
    bgTarget.current.set(useViewer.getState().theme === 'dark' ? DARK_BG : LIGHT_BG)
    bgCurrent.current.lerp(bgTarget.current, Math.min(delta, 0.1) * 4)
    bgUniform.current.value.copy(bgCurrent.current)

    const outliner = useViewer.getState().outliner
    sanitizeOutlineObjects(outliner.selectedObjects)
    sanitizeOutlineObjects(outliner.hoveredObjects)

    if (hasPipelineErrorRef.current || !renderPipelineRef.current) {
      try {
        if ((renderer as any).setClearAlpha) {
          ;(renderer as any).setClearAlpha(1)
        }
        ;(renderer as any).render(scene, camera)
      } catch (fallbackError) {
        console.error('[viewer/post-processing] Fallback render failed.', fallbackError)
      }
      return
    }

    try {
      // Clear alpha=0 so background pixels in the output MRT attachment (index 0) get a=0,
      // making scenePassColor.a a reliable geometry mask (geometry pixels write a=1 via output node).
      ;(renderer as any).setClearAlpha(0)
      renderPipelineRef.current.render()
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
        console.warn(
          `[viewer/post-processing] Scheduling pipeline rebuild (attempt ${retryCountRef.current}/${MAX_PIPELINE_RETRIES})`,
        )
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
