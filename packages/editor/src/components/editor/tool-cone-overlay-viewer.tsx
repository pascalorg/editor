'use client'

import { Viewer } from '@pascal-app/viewer'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { type ComponentProps, useEffect, useMemo, useRef } from 'react'
import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  PerspectiveCamera,
  Quaternion,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three'
import { recordNavigationPerfSample } from '../../lib/navigation-performance'
import navigationVisualsStore, { useNavigationVisuals } from '../../store/use-navigation-visuals'

const VIEWER_FIXED_DPR = 0.85
const TREE_OVERLAY_COLOR = '#52e8ff'
const CONE_EDGE_GLOW_COLOR = TREE_OVERLAY_COLOR
const CONE_EDGE_GLOW_ATTENUATION = 0.26
const CONE_EDGE_GLOW_BRIGHTNESS = 1.24
const CONE_EDGE_GLOW_INWARD_DIFFUSION_DEPTH = 0.19504
const CONE_EDGE_GLOW_INWARD_GRADIENT_BEND = 0.1
const CONE_EDGE_GLOW_OUTWARD_DIFFUSION_DEPTH = 0.02184
const CONE_EDGE_GLOW_OUTWARD_GRADIENT_BEND = 0.09
const CONE_GRADIENT_BEND = 0.58
const CONE_EXTRA_TRANSPARENCY_PERCENT = 61
const CONE_MAX_PROJECTED_HULL_VERTEX_COUNT = 9
const EXPONENTIAL_BEND_STRENGTH_MULTIPLIER = 6
const OVERLAY_CAMERA_SCALE = new Vector3(1, 1, 1)

type ProjectedHullCandidate = {
  isApex: boolean
  projectedPoint: Vector2
  worldPoint: Vector3
}

function arraysEqual(a: number[], b: number[]) {
  if (a.length !== b.length) {
    return false
  }
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return false
    }
  }
  return true
}

function createProjectedHullGeometry() {
  const geometry = new BufferGeometry()
  const positionAttribute = new Float32BufferAttribute(
    new Array(CONE_MAX_PROJECTED_HULL_VERTEX_COUNT * 3).fill(0),
    3,
  )
  const uvAttribute = new Float32BufferAttribute(
    new Array(CONE_MAX_PROJECTED_HULL_VERTEX_COUNT * 2).fill(0),
    2,
  )
  const indices: number[] = []
  for (let index = 1; index < CONE_MAX_PROJECTED_HULL_VERTEX_COUNT - 1; index += 1) {
    indices.push(0, index, index + 1)
  }
  geometry.setAttribute('position', positionAttribute)
  geometry.setAttribute('uv', uvAttribute)
  geometry.setIndex(indices)
  geometry.setDrawRange(0, 0)
  geometry.computeVertexNormals()
  return { geometry, positionAttribute, uvAttribute }
}

function createProjectedHullEdgeGlowGeometry() {
  const geometry = new BufferGeometry()
  const maxEdgeCount = CONE_MAX_PROJECTED_HULL_VERTEX_COUNT
  const positionAttribute = new Float32BufferAttribute(new Array(maxEdgeCount * 6 * 3).fill(0), 3)
  const uvValues: number[] = []
  for (let edgeIndex = 0; edgeIndex < maxEdgeCount; edgeIndex += 1) {
    uvValues.push(0, 0, 0, 1, 1, 1)
    uvValues.push(0, 0, 1, 1, 1, 0)
  }
  geometry.setAttribute('position', positionAttribute)
  geometry.setAttribute('uv', new Float32BufferAttribute(uvValues, 2))
  geometry.setDrawRange(0, 0)
  geometry.computeVertexNormals()
  return { geometry, positionAttribute }
}

function createConeFillMaterial(opacityScale: number) {
  const material = new ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    fragmentShader: `
      varying vec2 vUv;
      uniform vec3 uColor;
      uniform float uOpacityScale;

      void main() {
        float bendNode = max(${CONE_GRADIENT_BEND.toFixed(8)}, 0.0);
        float bendMix = smoothstep(0.0, 0.03, bendNode);
        float strength = bendNode * ${EXPONENTIAL_BEND_STRENGTH_MULTIPLIER.toFixed(8)};
        float progress = clamp(vUv.x, 0.0, 1.0);
        float linearFade = 1.0 - progress;
        float expStrength = exp(-strength);
        float expFade = (exp(-strength * progress) - expStrength) / (1.0 - expStrength + 1e-5);
        float fade = mix(linearFade, expFade, bendMix);
        float alpha = fade * uOpacityScale;
        if (alpha <= 0.001) discard;
        gl_FragColor = vec4(uColor, alpha);
      }
    `,
    side: DoubleSide,
    transparent: true,
    uniforms: {
      uColor: { value: new Vector3(0x52 / 255, 0xe8 / 255, 0xff / 255) },
      uOpacityScale: { value: opacityScale },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
  })
  material.toneMapped = false
  return material
}

function cross2D(origin: Vector2, pointA: Vector2, pointB: Vector2) {
  return (
    (pointA.x - origin.x) * (pointB.y - origin.y) - (pointA.y - origin.y) * (pointB.x - origin.x)
  )
}

function computeProjectedHull(candidates: ProjectedHullCandidate[]) {
  if (candidates.length < 3) {
    return candidates
  }

  const sorted = [...candidates].sort((candidateA, candidateB) => {
    if (Math.abs(candidateA.projectedPoint.x - candidateB.projectedPoint.x) > 1e-6) {
      return candidateA.projectedPoint.x - candidateB.projectedPoint.x
    }
    return candidateA.projectedPoint.y - candidateB.projectedPoint.y
  })
  const uniqueCandidates = sorted.filter((candidate, index) => {
    if (index === 0) {
      return true
    }
    const previous = sorted[index - 1]
    if (!previous) {
      return true
    }
    return (
      Math.abs(candidate.projectedPoint.x - previous.projectedPoint.x) > 1e-6 ||
      Math.abs(candidate.projectedPoint.y - previous.projectedPoint.y) > 1e-6
    )
  })

  if (uniqueCandidates.length < 3) {
    return uniqueCandidates
  }

  const lowerHull: ProjectedHullCandidate[] = []
  for (const candidate of uniqueCandidates) {
    while (
      lowerHull.length >= 2 &&
      cross2D(
        lowerHull[lowerHull.length - 2]!.projectedPoint,
        lowerHull[lowerHull.length - 1]!.projectedPoint,
        candidate.projectedPoint,
      ) <= 0
    ) {
      lowerHull.pop()
    }
    lowerHull.push(candidate)
  }

  const upperHull: ProjectedHullCandidate[] = []
  for (let index = uniqueCandidates.length - 1; index >= 0; index -= 1) {
    const candidate = uniqueCandidates[index]
    if (!candidate) {
      continue
    }
    while (
      upperHull.length >= 2 &&
      cross2D(
        upperHull[upperHull.length - 2]!.projectedPoint,
        upperHull[upperHull.length - 1]!.projectedPoint,
        candidate.projectedPoint,
      ) <= 0
    ) {
      upperHull.pop()
    }
    upperHull.push(candidate)
  }

  lowerHull.pop()
  upperHull.pop()
  return [...lowerHull, ...upperHull]
}

function reorderHullFromApex(projectedHull: ProjectedHullCandidate[]) {
  const apexIndex = projectedHull.findIndex((candidate) => candidate.isApex)
  if (apexIndex <= 0) {
    return projectedHull
  }
  return [...projectedHull.slice(apexIndex), ...projectedHull.slice(0, apexIndex)]
}

function createConeGlowMaterial(power: number) {
  const material = new ShaderMaterial({
    blending: AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    fragmentShader: `
      varying vec2 vUv;
      uniform vec3 uColor;

      void main() {
        float edgeFade = 1.0 - pow(smoothstep(0.0, 1.0, clamp(vUv.x, 0.0, 1.0)), ${power.toFixed(8)});
        float lengthFade = pow(1.0 - clamp(vUv.y, 0.0, 1.0), ${CONE_EDGE_GLOW_ATTENUATION.toFixed(8)});
        float alpha = edgeFade * lengthFade * ${CONE_EDGE_GLOW_BRIGHTNESS.toFixed(8)};
        if (alpha <= 0.001) discard;
        gl_FragColor = vec4(uColor, alpha);
      }
    `,
    side: DoubleSide,
    transparent: true,
    uniforms: {
      uColor: { value: new Vector3(0x52 / 255, 0xe8 / 255, 0xff / 255) },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
  })
  material.toneMapped = false
  return material
}

function applyConeOverlayColor(
  color: string | null | undefined,
  coneMaterial: ShaderMaterial,
  coneInwardEdgeGlowMaterial: ShaderMaterial,
  coneOutwardEdgeGlowMaterial: ShaderMaterial,
  outlineMaterial: LineBasicMaterial,
) {
  const nextColor = new Color(color ?? TREE_OVERLAY_COLOR)
  const nextColorVector = new Vector3(nextColor.r, nextColor.g, nextColor.b)
  const coneUniform = coneMaterial.uniforms.uColor
  const inwardGlowUniform = coneInwardEdgeGlowMaterial.uniforms.uColor
  const outwardGlowUniform = coneOutwardEdgeGlowMaterial.uniforms.uColor

  if (
    coneUniform &&
    inwardGlowUniform &&
    outwardGlowUniform &&
    coneUniform.value instanceof Vector3 &&
    inwardGlowUniform.value instanceof Vector3 &&
    outwardGlowUniform.value instanceof Vector3
  ) {
    coneUniform.value.copy(nextColorVector)
    inwardGlowUniform.value.copy(nextColorVector)
    outwardGlowUniform.value.copy(nextColorVector)
  }
  outlineMaterial.color.copy(nextColor)
}

function ToolConeOverlayCameraBridge() {
  const camera = useThree((state) => state.camera)
  const previousSnapshotRef = useRef<{
    position: [number, number, number]
    projectionMatrix: number[]
    projectionMatrixInverse: number[]
    quaternion: [number, number, number, number]
  } | null>(null)

  useFrame(() => {
    const nextSnapshot = {
      position: [camera.position.x, camera.position.y, camera.position.z] as [
        number,
        number,
        number,
      ],
      projectionMatrix: camera.projectionMatrix.elements.slice(),
      projectionMatrixInverse: camera.projectionMatrixInverse.elements.slice(),
      quaternion: [
        camera.quaternion.x,
        camera.quaternion.y,
        camera.quaternion.z,
        camera.quaternion.w,
      ] as [number, number, number, number],
    }
    const previousSnapshot = previousSnapshotRef.current
    if (
      previousSnapshot &&
      arraysEqual(previousSnapshot.position, nextSnapshot.position) &&
      arraysEqual(previousSnapshot.quaternion, nextSnapshot.quaternion) &&
      arraysEqual(previousSnapshot.projectionMatrix, nextSnapshot.projectionMatrix) &&
      arraysEqual(previousSnapshot.projectionMatrixInverse, nextSnapshot.projectionMatrixInverse)
    ) {
      return
    }
    previousSnapshotRef.current = nextSnapshot
    navigationVisualsStore.getState().setToolConeOverlayCamera(nextSnapshot)
  })

  useEffect(() => {
    return () => {
      navigationVisualsStore.getState().setToolConeOverlayCamera(null)
    }
  }, [])

  return null
}

function ToolConeIsolatedOverlayScene() {
  const camera = useThree((state) => state.camera)
  const gl = useThree((state) => state.gl)
  const coneOpacityScale = Math.max(0, 1 - CONE_EXTRA_TRANSPARENCY_PERCENT / 100)
  const coneMaterial = useMemo(() => createConeFillMaterial(coneOpacityScale), [coneOpacityScale])
  const coneInwardEdgeGlowMaterial = useMemo(
    () => createConeGlowMaterial(CONE_EDGE_GLOW_INWARD_GRADIENT_BEND),
    [],
  )
  const coneOutwardEdgeGlowMaterial = useMemo(
    () => createConeGlowMaterial(CONE_EDGE_GLOW_OUTWARD_GRADIENT_BEND),
    [],
  )
  const outlineMaterial = useMemo(() => {
    const material = new LineBasicMaterial({
      color: TREE_OVERLAY_COLOR,
      depthTest: true,
      opacity: 0.96 * coneOpacityScale,
      transparent: true,
    })
    material.toneMapped = false
    return material
  }, [coneOpacityScale])

  const coneMeshRef = useRef<Mesh | null>(null)
  const coneInwardEdgeGlowMeshRef = useRef<Mesh | null>(null)
  const coneOutwardEdgeGlowMeshRef = useRef<Mesh | null>(null)
  const coneOutlineRef = useRef<LineSegments | null>(null)
  const projectedHullCandidatesRef = useRef<ProjectedHullCandidate[]>([])
  const projectedHullCentroidRef = useRef(new Vector3())
  const inwardGlowStartScratchRef = useRef(new Vector3())
  const inwardGlowEndScratchRef = useRef(new Vector3())
  const outwardGlowStartScratchRef = useRef(new Vector3())
  const outwardGlowEndScratchRef = useRef(new Vector3())
  const worldPointScratchRef = useRef(new Vector3())
  const projectedPointScratchRef = useRef(new Vector3())
  const overlayCameraPositionRef = useRef(new Vector3())
  const overlayCameraQuaternionRef = useRef(new Quaternion())
  const {
    inwardGlowGeometry,
    inwardGlowPositionAttribute,
    mainGeometry,
    mainPositionAttribute,
    mainUvAttribute,
    outlineGeometry,
    outlinePositionAttribute,
    outwardGlowGeometry,
    outwardGlowPositionAttribute,
  } = useMemo(() => {
    const {
      geometry: mainGeometry,
      positionAttribute: mainPositionAttribute,
      uvAttribute: mainUvAttribute,
    } = createProjectedHullGeometry()
    const outlineGeometry = new BufferGeometry()
    const outlinePositionAttribute = new Float32BufferAttribute(
      new Array(CONE_MAX_PROJECTED_HULL_VERTEX_COUNT * 2 * 3).fill(0),
      3,
    )
    outlineGeometry.setAttribute('position', outlinePositionAttribute)
    const { geometry: inwardGlowGeometry, positionAttribute: inwardGlowPositionAttribute } =
      createProjectedHullEdgeGlowGeometry()
    const { geometry: outwardGlowGeometry, positionAttribute: outwardGlowPositionAttribute } =
      createProjectedHullEdgeGlowGeometry()
    return {
      inwardGlowGeometry,
      inwardGlowPositionAttribute,
      mainGeometry,
      mainPositionAttribute,
      mainUvAttribute,
      outlineGeometry,
      outlinePositionAttribute,
      outwardGlowGeometry,
      outwardGlowPositionAttribute,
    }
  }, [])

  useEffect(() => {
    navigationVisualsStore.getState().setToolConeOverlayWarmupReady(false)
    const {
      geometry: warmMainGeometry,
      positionAttribute: warmMainPositionAttribute,
      uvAttribute: warmMainUvAttribute,
    } = createProjectedHullGeometry()
    const warmOutlineGeometry = new BufferGeometry()
    const warmOutlinePositionAttribute = new Float32BufferAttribute(new Array(6 * 3).fill(0), 3)
    warmOutlineGeometry.setAttribute('position', warmOutlinePositionAttribute)
    const { geometry: warmInwardGlowGeometry, positionAttribute: warmInwardGlowPositionAttribute } =
      createProjectedHullEdgeGlowGeometry()
    const {
      geometry: warmOutwardGlowGeometry,
      positionAttribute: warmOutwardGlowPositionAttribute,
    } = createProjectedHullEdgeGlowGeometry()

    const apex = new Vector3(0, -0.08, 0)
    const pointA = new Vector3(-0.18, 0.18, 0)
    const pointB = new Vector3(0.18, 0.18, 0)
    ;[
      [apex, 0, 0],
      [pointA, 1, 0.5],
      [pointB, 1, 1],
    ].forEach(([point, u, v], index) => {
      const vector = point as Vector3
      warmMainPositionAttribute.setXYZ(index, vector.x, vector.y, vector.z)
      warmMainUvAttribute.setXY(index, u as number, v as number)
    })
    warmMainPositionAttribute.needsUpdate = true
    warmMainUvAttribute.needsUpdate = true
    warmMainGeometry.setDrawRange(0, 3)
    warmMainGeometry.computeVertexNormals()

    const warmOutlinePoints = [apex, pointA, pointA, pointB, pointB, apex]
    warmOutlinePoints.forEach((point, index) => {
      warmOutlinePositionAttribute.setXYZ(index, point.x, point.y, point.z)
    })
    warmOutlinePositionAttribute.needsUpdate = true
    warmOutlineGeometry.setDrawRange(0, warmOutlinePoints.length)

    const warmGlowTriangles = [
      apex,
      pointA,
      pointB,
      apex,
      pointB,
      apex.clone().lerp(pointA.clone().add(pointB).multiplyScalar(0.5), 0.25),
    ]
    warmGlowTriangles.forEach((point, index) => {
      warmInwardGlowPositionAttribute.setXYZ(index, point.x, point.y, point.z)
      warmOutwardGlowPositionAttribute.setXYZ(index, point.x, point.y, point.z)
    })
    warmInwardGlowPositionAttribute.needsUpdate = true
    warmOutwardGlowPositionAttribute.needsUpdate = true
    warmInwardGlowGeometry.setDrawRange(0, warmGlowTriangles.length)
    warmOutwardGlowGeometry.setDrawRange(0, warmGlowTriangles.length)
    warmInwardGlowGeometry.computeVertexNormals()
    warmOutwardGlowGeometry.computeVertexNormals()

    const warmupScene = new Scene()
    const warmupCamera = new PerspectiveCamera(50, 1, 0.01, 10)
    warmupCamera.position.set(0, 0, 1)
    warmupCamera.lookAt(0, 0, 0)
    warmupCamera.updateProjectionMatrix()
    warmupCamera.updateMatrixWorld(true)

    const warmupMainMesh = new Mesh(warmMainGeometry, coneMaterial)
    const warmupInwardGlowMesh = new Mesh(warmInwardGlowGeometry, coneInwardEdgeGlowMaterial)
    const warmupOutwardGlowMesh = new Mesh(warmOutwardGlowGeometry, coneOutwardEdgeGlowMaterial)
    const warmupOutline = new LineSegments(warmOutlineGeometry, outlineMaterial)
    warmupScene.add(warmupMainMesh, warmupInwardGlowMesh, warmupOutwardGlowMesh, warmupOutline)

    const renderTarget = new WebGLRenderTarget(64, 64, { depthBuffer: true })
    const renderer = gl as WebGLRenderer
    const warmupStart = performance.now()

    try {
      renderer.compile(warmupScene, warmupCamera)
      renderer.setRenderTarget(renderTarget)
      renderer.render(warmupScene, warmupCamera)
    } catch {
    } finally {
      renderer.setRenderTarget(null)
      renderTarget.dispose()
      recordNavigationPerfSample(
        'navigationToolConeOverlay.renderWarmupMs',
        performance.now() - warmupStart,
      )
      navigationVisualsStore.getState().setToolConeOverlayWarmupReady(true)
      warmupScene.clear()
      warmMainGeometry.dispose()
      warmOutlineGeometry.dispose()
      warmInwardGlowGeometry.dispose()
      warmOutwardGlowGeometry.dispose()
    }
  }, [coneInwardEdgeGlowMaterial, coneMaterial, coneOutwardEdgeGlowMaterial, gl, outlineMaterial])

  useEffect(() => {
    return () => {
      navigationVisualsStore.getState().setToolConeOverlayWarmupReady(false)
      mainGeometry.dispose()
      outlineGeometry.dispose()
      inwardGlowGeometry.dispose()
      outwardGlowGeometry.dispose()
      coneMaterial.dispose()
      coneInwardEdgeGlowMaterial.dispose()
      coneOutwardEdgeGlowMaterial.dispose()
      outlineMaterial.dispose()
    }
  }, [
    coneInwardEdgeGlowMaterial,
    coneMaterial,
    coneOutwardEdgeGlowMaterial,
    inwardGlowGeometry,
    mainGeometry,
    outlineGeometry,
    outlineMaterial,
    outwardGlowGeometry,
  ])

  useEffect(() => {
    const overlayColor = navigationVisualsStore.getState().toolConeIsolatedOverlay?.color ?? null
    applyConeOverlayColor(
      overlayColor,
      coneMaterial,
      coneInwardEdgeGlowMaterial,
      coneOutwardEdgeGlowMaterial,
      outlineMaterial,
    )
  }, [coneInwardEdgeGlowMaterial, coneMaterial, coneOutwardEdgeGlowMaterial, outlineMaterial])

  useFrame(() => {
    const overlayCamera = navigationVisualsStore.getState().toolConeOverlayCamera
    if (overlayCamera) {
      overlayCameraPositionRef.current.fromArray(overlayCamera.position)
      overlayCameraQuaternionRef.current.set(
        overlayCamera.quaternion[0],
        overlayCamera.quaternion[1],
        overlayCamera.quaternion[2],
        overlayCamera.quaternion[3],
      )
      camera.position.copy(overlayCameraPositionRef.current)
      camera.quaternion.copy(overlayCameraQuaternionRef.current)
      camera.matrixWorld.compose(
        overlayCameraPositionRef.current,
        overlayCameraQuaternionRef.current,
        OVERLAY_CAMERA_SCALE,
      )
      camera.matrixWorldInverse.copy(camera.matrixWorld).invert()
      camera.projectionMatrix.fromArray(overlayCamera.projectionMatrix)
      camera.projectionMatrixInverse.fromArray(overlayCamera.projectionMatrixInverse)
      camera.updateMatrixWorld(false)
    }

    const coneMesh = coneMeshRef.current
    const coneInwardEdgeGlowMesh = coneInwardEdgeGlowMeshRef.current
    const coneOutwardEdgeGlowMesh = coneOutwardEdgeGlowMeshRef.current
    const coneOutline = coneOutlineRef.current
    const overlay = navigationVisualsStore.getState().toolConeIsolatedOverlay
    const hullPoints = overlay?.visible ? overlay.hullPoints : []

    if (!coneMesh || !coneInwardEdgeGlowMesh || !coneOutwardEdgeGlowMesh || !coneOutline) {
      return
    }

    applyConeOverlayColor(
      overlay?.color ?? null,
      coneMaterial,
      coneInwardEdgeGlowMaterial,
      coneOutwardEdgeGlowMaterial,
      outlineMaterial,
    )

    let renderedHullPoints = hullPoints
    if (
      overlay?.visible &&
      overlay.apexWorldPoint &&
      (overlay.supportWorldPoints?.length ?? 0) > 0
    ) {
      const projectedHullCandidates = projectedHullCandidatesRef.current
      projectedHullCandidates.length = 0

      worldPointScratchRef.current.fromArray(overlay.apexWorldPoint)
      projectedPointScratchRef.current.copy(worldPointScratchRef.current).project(camera)
      projectedHullCandidates.push({
        isApex: true,
        projectedPoint: new Vector2(
          projectedPointScratchRef.current.x,
          projectedPointScratchRef.current.y,
        ),
        worldPoint: worldPointScratchRef.current.clone(),
      })

      for (const supportWorldPoint of overlay.supportWorldPoints ?? []) {
        worldPointScratchRef.current.fromArray(supportWorldPoint)
        projectedPointScratchRef.current.copy(worldPointScratchRef.current).project(camera)
        if (
          !Number.isFinite(projectedPointScratchRef.current.x) ||
          !Number.isFinite(projectedPointScratchRef.current.y)
        ) {
          continue
        }
        projectedHullCandidates.push({
          isApex: false,
          projectedPoint: new Vector2(
            projectedPointScratchRef.current.x,
            projectedPointScratchRef.current.y,
          ),
          worldPoint: worldPointScratchRef.current.clone(),
        })
      }

      renderedHullPoints = reorderHullFromApex(computeProjectedHull(projectedHullCandidates)).map(
        (candidate) => ({
          isApex: candidate.isApex,
          worldPoint: [candidate.worldPoint.x, candidate.worldPoint.y, candidate.worldPoint.z] as [
            number,
            number,
            number,
          ],
        }),
      )
    }

    if (!overlay?.visible || renderedHullPoints.length < 3) {
      coneMesh.visible = false
      coneInwardEdgeGlowMesh.visible = false
      coneOutwardEdgeGlowMesh.visible = false
      coneOutline.visible = false
      return
    }

    projectedHullCentroidRef.current.set(0, 0, 0)
    for (const hullPoint of renderedHullPoints) {
      worldPointScratchRef.current.fromArray(hullPoint.worldPoint)
      projectedHullCentroidRef.current.add(worldPointScratchRef.current)
    }
    projectedHullCentroidRef.current.divideScalar(renderedHullPoints.length)

    for (let index = 0; index < renderedHullPoints.length; index += 1) {
      const hullPoint = renderedHullPoints[index]
      if (!hullPoint) {
        continue
      }
      worldPointScratchRef.current.fromArray(hullPoint.worldPoint)
      mainPositionAttribute.setXYZ(
        index,
        worldPointScratchRef.current.x,
        worldPointScratchRef.current.y,
        worldPointScratchRef.current.z,
      )
      mainUvAttribute.setXY(
        index,
        hullPoint.isApex ? 0 : 1,
        index / Math.max(renderedHullPoints.length - 1, 1),
      )
    }
    mainPositionAttribute.needsUpdate = true
    mainUvAttribute.needsUpdate = true
    mainGeometry.setDrawRange(0, Math.max(0, (renderedHullPoints.length - 2) * 3))
    mainGeometry.computeVertexNormals()

    let outlineVertexIndex = 0
    let glowVertexIndex = 0
    for (let index = 0; index < renderedHullPoints.length; index += 1) {
      const startPoint = renderedHullPoints[index]
      const endPoint = renderedHullPoints[(index + 1) % renderedHullPoints.length]
      if (!(startPoint && endPoint)) {
        continue
      }

      const startWorldPoint = inwardGlowStartScratchRef.current.fromArray(startPoint.worldPoint)
      const endWorldPoint = inwardGlowEndScratchRef.current.fromArray(endPoint.worldPoint)

      outlinePositionAttribute.setXYZ(
        outlineVertexIndex,
        startWorldPoint.x,
        startWorldPoint.y,
        startWorldPoint.z,
      )
      outlineVertexIndex += 1
      outlinePositionAttribute.setXYZ(
        outlineVertexIndex,
        endWorldPoint.x,
        endWorldPoint.y,
        endWorldPoint.z,
      )
      outlineVertexIndex += 1

      const inwardGlowStart = outwardGlowStartScratchRef.current
        .copy(startWorldPoint)
        .lerp(projectedHullCentroidRef.current, CONE_EDGE_GLOW_INWARD_DIFFUSION_DEPTH)
      const inwardGlowEnd = outwardGlowEndScratchRef.current
        .copy(endWorldPoint)
        .lerp(projectedHullCentroidRef.current, CONE_EDGE_GLOW_INWARD_DIFFUSION_DEPTH)
      inwardGlowPositionAttribute.setXYZ(
        glowVertexIndex,
        startWorldPoint.x,
        startWorldPoint.y,
        startWorldPoint.z,
      )
      inwardGlowPositionAttribute.setXYZ(
        glowVertexIndex + 1,
        endWorldPoint.x,
        endWorldPoint.y,
        endWorldPoint.z,
      )
      inwardGlowPositionAttribute.setXYZ(
        glowVertexIndex + 2,
        inwardGlowEnd.x,
        inwardGlowEnd.y,
        inwardGlowEnd.z,
      )
      inwardGlowPositionAttribute.setXYZ(
        glowVertexIndex + 3,
        startWorldPoint.x,
        startWorldPoint.y,
        startWorldPoint.z,
      )
      inwardGlowPositionAttribute.setXYZ(
        glowVertexIndex + 4,
        inwardGlowEnd.x,
        inwardGlowEnd.y,
        inwardGlowEnd.z,
      )
      inwardGlowPositionAttribute.setXYZ(
        glowVertexIndex + 5,
        inwardGlowStart.x,
        inwardGlowStart.y,
        inwardGlowStart.z,
      )

      const outwardGlowStart = inwardGlowStartScratchRef.current
        .copy(startWorldPoint)
        .lerp(projectedHullCentroidRef.current, -CONE_EDGE_GLOW_OUTWARD_DIFFUSION_DEPTH)
      const outwardGlowEnd = inwardGlowEndScratchRef.current
        .copy(endWorldPoint)
        .lerp(projectedHullCentroidRef.current, -CONE_EDGE_GLOW_OUTWARD_DIFFUSION_DEPTH)
      outwardGlowPositionAttribute.setXYZ(
        glowVertexIndex,
        startWorldPoint.x,
        startWorldPoint.y,
        startWorldPoint.z,
      )
      outwardGlowPositionAttribute.setXYZ(
        glowVertexIndex + 1,
        outwardGlowEnd.x,
        outwardGlowEnd.y,
        outwardGlowEnd.z,
      )
      outwardGlowPositionAttribute.setXYZ(
        glowVertexIndex + 2,
        endWorldPoint.x,
        endWorldPoint.y,
        endWorldPoint.z,
      )
      outwardGlowPositionAttribute.setXYZ(
        glowVertexIndex + 3,
        startWorldPoint.x,
        startWorldPoint.y,
        startWorldPoint.z,
      )
      outwardGlowPositionAttribute.setXYZ(
        glowVertexIndex + 4,
        outwardGlowStart.x,
        outwardGlowStart.y,
        outwardGlowStart.z,
      )
      outwardGlowPositionAttribute.setXYZ(
        glowVertexIndex + 5,
        outwardGlowEnd.x,
        outwardGlowEnd.y,
        outwardGlowEnd.z,
      )

      glowVertexIndex += 6
    }

    outlinePositionAttribute.needsUpdate = true
    coneOutline.geometry.setDrawRange(0, outlineVertexIndex)
    inwardGlowPositionAttribute.needsUpdate = true
    coneInwardEdgeGlowMesh.geometry.setDrawRange(0, glowVertexIndex)
    coneInwardEdgeGlowMesh.geometry.computeVertexNormals()
    outwardGlowPositionAttribute.needsUpdate = true
    coneOutwardEdgeGlowMesh.geometry.setDrawRange(0, glowVertexIndex)
    coneOutwardEdgeGlowMesh.geometry.computeVertexNormals()

    coneMesh.visible = true
    coneInwardEdgeGlowMesh.visible = true
    coneOutwardEdgeGlowMesh.visible = true
    coneOutline.visible = true
  })

  return (
    <>
      <mesh ref={coneMeshRef} frustumCulled={false} geometry={mainGeometry} renderOrder={50}>
        <primitive attach="material" object={coneMaterial} />
      </mesh>
      <lineSegments
        ref={coneOutlineRef}
        frustumCulled={false}
        geometry={outlineGeometry}
        renderOrder={51}
      >
        <primitive attach="material" object={outlineMaterial} />
      </lineSegments>
      <mesh
        ref={coneInwardEdgeGlowMeshRef}
        frustumCulled={false}
        geometry={inwardGlowGeometry}
        renderOrder={52}
      >
        <primitive attach="material" object={coneInwardEdgeGlowMaterial} />
      </mesh>
      <mesh
        ref={coneOutwardEdgeGlowMeshRef}
        frustumCulled={false}
        geometry={outwardGlowGeometry}
        renderOrder={53}
      >
        <primitive attach="material" object={coneOutwardEdgeGlowMaterial} />
      </mesh>
    </>
  )
}

function ToolConeIsolatedOverlayCanvas() {
  const enabled = useNavigationVisuals((state) => state.toolConeOverlayEnabled)

  if (!enabled) {
    return null
  }

  return (
    <div
      className="pointer-events-none absolute inset-0"
      data-pascal-tool-cone-isolated-overlay="1"
    >
      <Canvas
        camera={{ position: [0, 0, 1], fov: 50 }}
        className="pointer-events-none h-full w-full"
        dpr={[VIEWER_FIXED_DPR, VIEWER_FIXED_DPR]}
        frameloop="always"
        gl={(props) => {
          const { powerPreference: _ignoredPowerPreference, ...rendererProps } = props as any
          const renderer = new WebGLRenderer({
            ...rendererProps,
            alpha: true,
            premultipliedAlpha: true,
          })
          renderer.setClearColor(0x000000, 0)
          renderer.outputColorSpace = SRGBColorSpace
          renderer.toneMapping = ACESFilmicToneMapping
          renderer.toneMappingExposure = 0.9
          renderer.domElement.style.pointerEvents = 'none'
          return renderer
        }}
        style={{ pointerEvents: 'none' }}
        resize={{
          debounce: 100,
        }}
        shadows={false}
      >
        <ToolConeIsolatedOverlayScene />
      </Canvas>
    </div>
  )
}

export function ToolConeOverlayViewer({
  children,
  enabled = false,
  ...viewerProps
}: ComponentProps<typeof Viewer> & { enabled?: boolean }) {
  useEffect(() => {
    const state = navigationVisualsStore.getState()
    state.setToolConeOverlayEnabled(enabled)
    if (!enabled) {
      state.setToolConeOverlayCamera(null)
      state.setToolConeIsolatedOverlay(null)
      state.setToolConeOverlayWarmupReady(false)
    }
  }, [enabled])

  return (
    <div className="relative h-full w-full">
      <Viewer {...viewerProps}>
        {enabled ? <ToolConeOverlayCameraBridge /> : null}
        {children}
      </Viewer>
      {enabled ? <ToolConeIsolatedOverlayCanvas /> : null}
    </div>
  )
}
