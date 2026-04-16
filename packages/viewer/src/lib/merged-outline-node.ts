// @ts-nocheck — Three.js TSL/WebGPU internal APIs have incomplete type definitions;
// this file is a fork of OutlineNode and is intentionally exempt from strict TS checking.

/**
 * MergedOutlineNode — a fork of Three.js OutlineNode that processes two object
 * groups (primary = selected, secondary = hovered) in a single pass, sharing the
 * expensive non-selected depth pre-render between both groups.
 *
 * Cost comparison vs two separate OutlineNode instances:
 *   Before: depth_A + mask_A + edge_A×6 + depth_B + mask_B + edge_B×6 = 2 depth passes
 *   After:  depth_AB (shared) + mask_A + edge_A×6 + mask_B + edge_B×6 = 1 depth pass
 *
 * Additional early-outs:
 *   - Both empty       → skip everything (0 passes)
 *   - Only primary     → skip secondary mask/edge/blur
 *   - Only secondary   → skip primary mask/edge/blur
 */

import { DepthTexture, FloatType, type Object3D, RenderTarget, Vector2 } from 'three'
import {
  color,
  exp,
  Fn,
  float,
  int,
  Loop,
  min,
  mul,
  nodeObject,
  orthographicDepthToViewZ,
  passTexture,
  perspectiveDepthToViewZ,
  positionView,
  reference,
  screenUV,
  texture,
  textureSize,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import {
  NodeMaterial,
  NodeUpdateType,
  QuadMesh,
  RendererUtils,
  SpriteNodeMaterial,
  TempNode,
} from 'three/webgpu'

const _quadMesh = new QuadMesh()
const _size = new Vector2()
const _BLUR_X = new Vector2(1.0, 0.0)
const _BLUR_Y = new Vector2(0.0, 1.0)
let _rendererState: any // eslint-disable-line @typescript-eslint/no-explicit-any

// ---------------------------------------------------------------------------
// Helper: render targets for one outline group
// ---------------------------------------------------------------------------
function makeGroupTargets(downSampleRatio: number) {
  const maskBuffer = new RenderTarget()
  const maskDownSample = new RenderTarget(1, 1, { depthBuffer: false })
  const edgeBuffer1 = new RenderTarget(1, 1, { depthBuffer: false })
  const edgeBuffer2 = new RenderTarget(1, 1, { depthBuffer: false })
  const blurBuffer1 = new RenderTarget(1, 1, { depthBuffer: false })
  const blurBuffer2 = new RenderTarget(1, 1, { depthBuffer: false })
  const composite = new RenderTarget(1, 1, { depthBuffer: false })

  function setSize(w: number, h: number) {
    maskBuffer.setSize(w, h)
    composite.setSize(w, h)
    let rx = Math.round(w / downSampleRatio)
    let ry = Math.round(h / downSampleRatio)
    maskDownSample.setSize(rx, ry)
    edgeBuffer1.setSize(rx, ry)
    blurBuffer1.setSize(rx, ry)
    rx = Math.round(rx / 2)
    ry = Math.round(ry / 2)
    edgeBuffer2.setSize(rx, ry)
    blurBuffer2.setSize(rx, ry)
  }

  function dispose() {
    maskBuffer.dispose()
    maskDownSample.dispose()
    edgeBuffer1.dispose()
    edgeBuffer2.dispose()
    blurBuffer1.dispose()
    blurBuffer2.dispose()
    composite.dispose()
  }

  return {
    maskBuffer,
    maskDownSample,
    edgeBuffer1,
    edgeBuffer2,
    blurBuffer1,
    blurBuffer2,
    composite,
    setSize,
    dispose,
  }
}

type GroupTargets = ReturnType<typeof makeGroupTargets>

// ---------------------------------------------------------------------------
// MergedOutlineNode
// ---------------------------------------------------------------------------
export class MergedOutlineNode extends TempNode {
  static get type() {
    return 'MergedOutlineNode'
  }

  scene: any
  camera: any
  primaryObjects: Object3D[]
  secondaryObjects: Object3D[]
  primaryEdgeThicknessNode: any
  secondaryEdgeThicknessNode: any
  primaryEdgeGlowNode: any
  secondaryEdgeGlowNode: any
  downSampleRatio: number
  updateBeforeType: string

  private readonly _depthRT: RenderTarget
  private readonly _depthTexUniform: any

  private readonly _groupA: GroupTargets
  private readonly _groupB: GroupTargets
  private readonly _maskTexA: any
  private readonly _maskDownTexA: any
  private readonly _edge1TexA: any
  private readonly _edge2TexA: any
  private readonly _blurColorTexA: any
  private readonly _maskTexB: any
  private readonly _maskDownTexB: any
  private readonly _edge1TexB: any
  private readonly _edge2TexB: any
  private readonly _blurColorTexB: any
  private readonly _blurDirectionA: any
  private readonly _blurDirectionB: any
  private readonly _cameraNear: any
  private readonly _cameraFar: any

  private readonly _depthMaterial: NodeMaterial
  private readonly _depthSpriteMaterial: SpriteNodeMaterial
  private readonly _prepareMaskMatA: NodeMaterial
  private readonly _prepareMaskSpriteMatA: SpriteNodeMaterial
  private readonly _copyMatA: NodeMaterial
  private readonly _edgeDetectMatA: NodeMaterial
  private readonly _blurMat1A: NodeMaterial
  private readonly _blurMat2A: NodeMaterial
  private readonly _compositeMatA: NodeMaterial
  private readonly _prepareMaskMatB: NodeMaterial
  private readonly _prepareMaskSpriteMatB: SpriteNodeMaterial
  private readonly _copyMatB: NodeMaterial
  private readonly _edgeDetectMatB: NodeMaterial
  private readonly _blurMat1B: NodeMaterial
  private readonly _blurMat2B: NodeMaterial
  private readonly _compositeMatB: NodeMaterial

  private readonly _cacheA = new Set<Object3D>()
  private readonly _cacheB = new Set<Object3D>()

  private readonly _textureNodeA: any
  private readonly _textureNodeB: any

  constructor(
    scene: any,
    camera: any,
    params: {
      primaryObjects?: Object3D[]
      secondaryObjects?: Object3D[]
      primaryEdgeThickness?: any
      secondaryEdgeThickness?: any
      primaryEdgeGlow?: any
      secondaryEdgeGlow?: any
      downSampleRatio?: number
    } = {},
  ) {
    super('vec4')

    const {
      primaryObjects = [],
      secondaryObjects = [],
      primaryEdgeThickness = float(1),
      secondaryEdgeThickness = float(1),
      primaryEdgeGlow = float(0),
      secondaryEdgeGlow = float(0),
      downSampleRatio = 2,
    } = params

    this.scene = scene
    this.camera = camera
    this.primaryObjects = primaryObjects
    this.secondaryObjects = secondaryObjects
    this.primaryEdgeThicknessNode = nodeObject(primaryEdgeThickness)
    this.secondaryEdgeThicknessNode = nodeObject(secondaryEdgeThickness)
    this.primaryEdgeGlowNode = nodeObject(primaryEdgeGlow)
    this.secondaryEdgeGlowNode = nodeObject(secondaryEdgeGlow)
    this.downSampleRatio = downSampleRatio
    this.updateBeforeType = NodeUpdateType.FRAME

    this._depthRT = new RenderTarget()
    this._depthRT.depthTexture = new DepthTexture()
    this._depthRT.depthTexture.type = FloatType

    this._groupA = makeGroupTargets(downSampleRatio)
    this._groupB = makeGroupTargets(downSampleRatio)

    this._cameraNear = reference('near', 'float', camera)
    this._cameraFar = reference('far', 'float', camera)
    this._blurDirectionA = uniform(new Vector2())
    this._blurDirectionB = uniform(new Vector2())
    this._depthTexUniform = texture(this._depthRT.depthTexture)

    this._maskTexA = texture(this._groupA.maskBuffer.texture)
    this._maskDownTexA = texture(this._groupA.maskDownSample.texture)
    this._edge1TexA = texture(this._groupA.edgeBuffer1.texture)
    this._edge2TexA = texture(this._groupA.edgeBuffer2.texture)
    this._blurColorTexA = texture(this._groupA.edgeBuffer1.texture)

    this._maskTexB = texture(this._groupB.maskBuffer.texture)
    this._maskDownTexB = texture(this._groupB.maskDownSample.texture)
    this._edge1TexB = texture(this._groupB.edgeBuffer1.texture)
    this._edge2TexB = texture(this._groupB.edgeBuffer2.texture)
    this._blurColorTexB = texture(this._groupB.edgeBuffer1.texture)

    this._depthMaterial = new NodeMaterial()
    this._depthMaterial.colorNode = color(0, 0, 0)
    this._depthMaterial.name = 'MergedOutline.depth'
    this._depthSpriteMaterial = new SpriteNodeMaterial()
    this._depthSpriteMaterial.colorNode = color(0, 0, 0)
    this._depthSpriteMaterial.name = 'MergedOutline.depthSprite'

    this._prepareMaskMatA = new NodeMaterial()
    this._prepareMaskMatA.name = 'MergedOutline.maskA'
    this._prepareMaskSpriteMatA = new SpriteNodeMaterial()
    this._prepareMaskSpriteMatA.name = 'MergedOutline.maskSpriteA'
    this._copyMatA = new NodeMaterial()
    this._copyMatA.name = 'MergedOutline.copyA'
    this._edgeDetectMatA = new NodeMaterial()
    this._edgeDetectMatA.name = 'MergedOutline.edgeA'
    this._blurMat1A = new NodeMaterial()
    this._blurMat1A.name = 'MergedOutline.blur1A'
    this._blurMat2A = new NodeMaterial()
    this._blurMat2A.name = 'MergedOutline.blur2A'
    this._compositeMatA = new NodeMaterial()
    this._compositeMatA.name = 'MergedOutline.compositeA'

    this._prepareMaskMatB = new NodeMaterial()
    this._prepareMaskMatB.name = 'MergedOutline.maskB'
    this._prepareMaskSpriteMatB = new SpriteNodeMaterial()
    this._prepareMaskSpriteMatB.name = 'MergedOutline.maskSpriteB'
    this._copyMatB = new NodeMaterial()
    this._copyMatB.name = 'MergedOutline.copyB'
    this._edgeDetectMatB = new NodeMaterial()
    this._edgeDetectMatB.name = 'MergedOutline.edgeB'
    this._blurMat1B = new NodeMaterial()
    this._blurMat1B.name = 'MergedOutline.blur1B'
    this._blurMat2B = new NodeMaterial()
    this._blurMat2B.name = 'MergedOutline.blur2B'
    this._compositeMatB = new NodeMaterial()
    this._compositeMatB.name = 'MergedOutline.compositeB'

    // Output: R = visibleEdge, G = hiddenEdge
    this._textureNodeA = passTexture(this, this._groupA.composite.texture)
    this._textureNodeB = passTexture(this, this._groupB.composite.texture)
  }

  get primaryVisibleEdge() {
    return this._textureNodeA.r
  }
  get primaryHiddenEdge() {
    return this._textureNodeA.g
  }
  get secondaryVisibleEdge() {
    return this._textureNodeB.r
  }
  get secondaryHiddenEdge() {
    return this._textureNodeB.g
  }

  setSize(width: number, height: number) {
    this._depthRT.setSize(width, height)
    this._groupA.setSize(width, height)
    this._groupB.setSize(width, height)
  }

  updateBefore(frame: any) {
    const hasPrimary = this.primaryObjects.length > 0
    const hasSecondary = this.secondaryObjects.length > 0

    const { renderer } = frame
    const { camera, scene } = this

    _rendererState = RendererUtils.resetRendererAndSceneState(renderer, scene, _rendererState)

    const size = renderer.getDrawingBufferSize(_size)
    this.setSize(size.width, size.height)

    // Clear composites for inactive groups so stale outlines don't persist on GPU.
    // Must happen inside resetRendererAndSceneState to avoid MSAA state corruption.
    if (!hasPrimary) {
      renderer.setRenderTarget(this._groupA.composite)
      renderer.clearColor()
    }
    if (!hasSecondary) {
      renderer.setRenderTarget(this._groupB.composite)
      renderer.clearColor()
    }

    const hasAny = hasPrimary || hasSecondary
    if (!hasAny) {
      RendererUtils.restoreRendererAndSceneState(renderer, scene, _rendererState)
      return
    }

    renderer.setClearColor(0xff_ff_ff, 1)

    if (hasPrimary) this._buildCache(this.primaryObjects, this._cacheA)
    if (hasSecondary) this._buildCache(this.secondaryObjects, this._cacheB)

    const savedName = scene.name

    // ── 1. Shared depth pass: all objects NOT in either group ─────────────────
    renderer.setRenderTarget(this._depthRT)
    renderer.setRenderObjectFunction(
      (obj: any, sc: any, cam: any, geo: any, _mat: any, grp: any, lights: any, clip: any) => {
        const inCache = this._cacheA.has(obj) || this._cacheB.has(obj)
        if (!inCache) {
          const m = obj.isSprite ? this._depthSpriteMaterial : this._depthMaterial
          renderer.renderObject(obj, sc, cam, geo, m, grp, lights, clip)
        }
      },
    )
    scene.name = 'MergedOutline [ Depth ]'
    renderer.render(scene, camera)

    // ── 2a. Primary mask pass ─────────────────────────────────────────────────
    if (hasPrimary) {
      renderer.setRenderTarget(this._groupA.maskBuffer)
      renderer.setRenderObjectFunction(
        (obj: any, sc: any, cam: any, geo: any, _mat: any, grp: any, lights: any, clip: any) => {
          if (this._cacheA.has(obj)) {
            const m = obj.isSprite ? this._prepareMaskSpriteMatA : this._prepareMaskMatA
            renderer.renderObject(obj, sc, cam, geo, m, grp, lights, clip)
          }
        },
      )
      scene.name = 'MergedOutline [ Mask A ]'
      renderer.render(scene, camera)
    }

    // ── 2b. Secondary mask pass ───────────────────────────────────────────────
    if (hasSecondary) {
      renderer.setRenderTarget(this._groupB.maskBuffer)
      renderer.setRenderObjectFunction(
        (obj: any, sc: any, cam: any, geo: any, _mat: any, grp: any, lights: any, clip: any) => {
          if (this._cacheB.has(obj)) {
            const m = obj.isSprite ? this._prepareMaskSpriteMatB : this._prepareMaskMatB
            renderer.renderObject(obj, sc, cam, geo, m, grp, lights, clip)
          }
        },
      )
      scene.name = 'MergedOutline [ Mask B ]'
      renderer.render(scene, camera)
    }

    renderer.setRenderObjectFunction(_rendererState.renderObjectFunction)
    this._cacheA.clear()
    this._cacheB.clear()
    scene.name = savedName

    // ── 3–7. Edge detect + blur + composite per active group ──────────────────
    if (hasPrimary) this._runEdgePipeline(renderer, 'A')
    if (hasSecondary) this._runEdgePipeline(renderer, 'B')

    RendererUtils.restoreRendererAndSceneState(renderer, scene, _rendererState)
  }

  private _runEdgePipeline(renderer: any, group: 'A' | 'B') {
    const isA = group === 'A'
    const g = isA ? this._groupA : this._groupB
    const copyMat = isA ? this._copyMatA : this._copyMatB
    const edgeMat = isA ? this._edgeDetectMatA : this._edgeDetectMatB
    const blur1 = isA ? this._blurMat1A : this._blurMat1B
    const blur2 = isA ? this._blurMat2A : this._blurMat2B
    const blurDir = isA ? this._blurDirectionA : this._blurDirectionB
    const blurColorTex = isA ? this._blurColorTexA : this._blurColorTexB
    const compositeMat = isA ? this._compositeMatA : this._compositeMatB

    _quadMesh.material = copyMat
    renderer.setRenderTarget(g.maskDownSample)
    _quadMesh.render(renderer)

    _quadMesh.material = edgeMat
    renderer.setRenderTarget(g.edgeBuffer1)
    _quadMesh.render(renderer)

    blurColorTex.value = g.edgeBuffer1.texture
    blurDir.value.copy(_BLUR_X)
    _quadMesh.material = blur1
    renderer.setRenderTarget(g.blurBuffer1)
    _quadMesh.render(renderer)

    blurColorTex.value = g.blurBuffer1.texture
    blurDir.value.copy(_BLUR_Y)
    renderer.setRenderTarget(g.edgeBuffer1)
    _quadMesh.render(renderer)

    blurColorTex.value = g.edgeBuffer1.texture
    blurDir.value.copy(_BLUR_X)
    _quadMesh.material = blur2
    renderer.setRenderTarget(g.blurBuffer2)
    _quadMesh.render(renderer)

    blurColorTex.value = g.blurBuffer2.texture
    blurDir.value.copy(_BLUR_Y)
    renderer.setRenderTarget(g.edgeBuffer2)
    _quadMesh.render(renderer)

    _quadMesh.material = compositeMat
    renderer.setRenderTarget(g.composite)
    _quadMesh.render(renderer)
  }

  setup(_builder: any) {
    // ── prepareMask ───────────────────────────────────────────────────────────
    const buildPrepareMask = () => {
      const depth = this._depthTexUniform.sample(screenUV)
      const viewZ = this.camera.isPerspectiveCamera
        ? perspectiveDepthToViewZ(depth, this._cameraNear, this._cameraFar)
        : orthographicDepthToViewZ(depth, this._cameraNear, this._cameraFar)
      const depthTest = positionView.z.lessThanEqual(viewZ).select(1, 0)
      return vec3(0.0, depthTest, 1.0)
    }

    const maskColorA = buildPrepareMask()
    this._prepareMaskMatA.colorNode = maskColorA
    this._prepareMaskMatA.needsUpdate = true
    this._prepareMaskSpriteMatA.colorNode = maskColorA
    this._prepareMaskSpriteMatA.needsUpdate = true

    const maskColorB = buildPrepareMask()
    this._prepareMaskMatB.colorNode = maskColorB
    this._prepareMaskMatB.needsUpdate = true
    this._prepareMaskSpriteMatB.colorNode = maskColorB
    this._prepareMaskSpriteMatB.needsUpdate = true

    // ── Copy ──────────────────────────────────────────────────────────────────
    this._copyMatA.fragmentNode = this._maskTexA
    this._copyMatA.needsUpdate = true
    this._copyMatB.fragmentNode = this._maskTexB
    this._copyMatB.needsUpdate = true

    // ── Edge detection ────────────────────────────────────────────────────────
    const buildEdgeDetect = (maskDownTex: any) =>
      Fn(() => {
        const resolution = textureSize(maskDownTex)
        const invSize = vec2(1).div(resolution).toVar()
        const uvOffset = vec4(1.0, 0.0, 0.0, 1.0).mul(vec4(invSize, invSize))
        const uvNode = uv()
        const c1 = maskDownTex.sample(uvNode.add(uvOffset.xy)).toVar()
        const c2 = maskDownTex.sample(uvNode.sub(uvOffset.xy)).toVar()
        const c3 = maskDownTex.sample(uvNode.add(uvOffset.yw)).toVar()
        const c4 = maskDownTex.sample(uvNode.sub(uvOffset.yw)).toVar()
        const diff1 = mul(c1.r.sub(c2.r), 0.5)
        const diff2 = mul(c3.r.sub(c4.r), 0.5)
        const d = vec2(diff1, diff2).length()
        const a1 = min(c1.g, c2.g)
        const a2 = min(c3.g, c4.g)
        const visibilityFactor = min(a1, a2)
        // R = visible edge, G = hidden edge (matches OutlineNode convention)
        const edgeColor = visibilityFactor
          .oneMinus()
          .greaterThan(0.001)
          .select(vec3(1, 0, 0), vec3(0, 1, 0))
        return vec4(edgeColor, 1).mul(d)
      })()

    this._edgeDetectMatA.fragmentNode = buildEdgeDetect(this._maskDownTexA)
    this._edgeDetectMatA.needsUpdate = true
    this._edgeDetectMatB.fragmentNode = buildEdgeDetect(this._maskDownTexB)
    this._edgeDetectMatB.needsUpdate = true

    // ── Separable blur ────────────────────────────────────────────────────────
    const MAX_RADIUS = 4

    const gaussianPdf = Fn(([x, sigma]: any[]) =>
      float(0.398_94).mul(exp(float(-0.5).mul(x).mul(x).div(sigma.mul(sigma))).div(sigma)),
    )

    const buildBlur = (maskDownTex: any, blurColorTex: any, blurDir: any, kernelRadius: any) =>
      Fn(() => {
        const resolution = textureSize(maskDownTex)
        const invSize = vec2(1).div(resolution).toVar()
        const uvNode = uv()
        const sigma = kernelRadius.div(2).toVar()
        const weightSum = gaussianPdf(0, sigma).toVar()
        const diffuseSum = blurColorTex.sample(uvNode).mul(weightSum).toVar()
        const delta = blurDir.mul(invSize).mul(kernelRadius).div(MAX_RADIUS).toVar()
        const uvOffset = delta.toVar()
        Loop(
          { start: int(1), end: int(MAX_RADIUS), type: 'int', condition: '<=' },
          ({ i }: any) => {
            const x = kernelRadius.mul(float(i)).div(MAX_RADIUS)
            const w = gaussianPdf(x, sigma)
            diffuseSum.addAssign(
              blurColorTex
                .sample(uvNode.add(uvOffset))
                .add(blurColorTex.sample(uvNode.sub(uvOffset)))
                .mul(w),
            )
            weightSum.addAssign(w.mul(2))
            uvOffset.addAssign(delta)
          },
        )
        return diffuseSum.div(weightSum)
      })()

    this._blurMat1A.fragmentNode = buildBlur(
      this._maskDownTexA,
      this._blurColorTexA,
      this._blurDirectionA,
      this.primaryEdgeThicknessNode,
    )
    this._blurMat1A.needsUpdate = true
    this._blurMat2A.fragmentNode = buildBlur(
      this._maskDownTexA,
      this._blurColorTexA,
      this._blurDirectionA,
      float(MAX_RADIUS),
    )
    this._blurMat2A.needsUpdate = true
    this._blurMat1B.fragmentNode = buildBlur(
      this._maskDownTexB,
      this._blurColorTexB,
      this._blurDirectionB,
      this.secondaryEdgeThicknessNode,
    )
    this._blurMat1B.needsUpdate = true
    this._blurMat2B.fragmentNode = buildBlur(
      this._maskDownTexB,
      this._blurColorTexB,
      this._blurDirectionB,
      float(MAX_RADIUS),
    )
    this._blurMat2B.needsUpdate = true

    // ── Composite ─────────────────────────────────────────────────────────────
    const buildComposite = (maskTex: any, edge1Tex: any, edge2Tex: any, edgeGlowNode: any) =>
      Fn(() => maskTex.r.mul(edge1Tex.add(edge2Tex.mul(edgeGlowNode))))()

    this._compositeMatA.fragmentNode = buildComposite(
      this._maskTexA,
      this._edge1TexA,
      this._edge2TexA,
      this.primaryEdgeGlowNode,
    )
    this._compositeMatA.needsUpdate = true
    this._compositeMatB.fragmentNode = buildComposite(
      this._maskTexB,
      this._edge1TexB,
      this._edge2TexB,
      this.secondaryEdgeGlowNode,
    )
    this._compositeMatB.needsUpdate = true

    return this._textureNodeA
  }

  dispose() {
    this.primaryObjects.length = 0
    this.secondaryObjects.length = 0
    this._depthRT.dispose()
    this._groupA.dispose()
    this._groupB.dispose()
    this._depthMaterial.dispose()
    this._depthSpriteMaterial.dispose()
    this._prepareMaskMatA.dispose()
    this._prepareMaskSpriteMatA.dispose()
    this._copyMatA.dispose()
    this._edgeDetectMatA.dispose()
    this._blurMat1A.dispose()
    this._blurMat2A.dispose()
    this._compositeMatA.dispose()
    this._prepareMaskMatB.dispose()
    this._prepareMaskSpriteMatB.dispose()
    this._copyMatB.dispose()
    this._edgeDetectMatB.dispose()
    this._blurMat1B.dispose()
    this._blurMat2B.dispose()
    this._compositeMatB.dispose()
  }

  private _buildCache(objects: Object3D[], cache: Set<Object3D>) {
    for (const obj of objects) {
      if (!obj || !obj.traverse) continue
      try {
        obj.traverse((child: any) => {
          if (child.isMesh || child.isSprite) cache.add(child)
        })
      } catch {
        // Skip objects that were disposed or removed from the scene graph
      }
    }
  }
}

export const mergedOutline = (
  scene: any,
  camera: any,
  params?: ConstructorParameters<typeof MergedOutlineNode>[2],
) => new MergedOutlineNode(scene, camera, params)
