'use client'

import { Bounds, OrbitControls, useGLTF } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { Box, Loader2 } from 'lucide-react'
import { Suspense, useMemo } from 'react'
import * as THREE from 'three'

function normalizeSceneForPreview(scene: THREE.Object3D): THREE.Group {
  const root = new THREE.Group()
  const model = scene.clone(true)

  model.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh
      if (Array.isArray(mesh.material)) {
        for (const mat of mesh.material) {
          if (mat && 'side' in mat) mat.side = THREE.DoubleSide
        }
      } else if (mesh.material && 'side' in mesh.material) {
        mesh.material.side = THREE.DoubleSide
      }
    }
  })

  const box = new THREE.Box3()
  model.updateMatrixWorld(true)
  model.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh.isMesh && mesh.geometry) {
      box.expandByObject(mesh)
    }
  })

  if (!box.isEmpty()) {
    const center = new THREE.Vector3()
    box.getCenter(center)
    model.position.set(-center.x, -box.min.y, -center.z)
  }

  root.add(model)
  return root
}

function GlbModel({ url }: { url: string }) {
  const { scene } = useGLTF(url)
  const content = useMemo(() => normalizeSceneForPreview(scene), [scene])

  return (
    <Bounds clip fit margin={1.35} observe>
      <primitive object={content} />
    </Bounds>
  )
}

function PreviewCanvas({ url }: { url: string }) {
  return (
    <Canvas
      camera={{ fov: 45, near: 0.01, far: 2000 }}
      className="!block h-full w-full"
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
      style={{ width: '100%', height: '100%', display: 'block' }}
    >
      <color attach="background" args={['#f4f4f5']} />
      <ambientLight intensity={0.7} />
      <directionalLight intensity={1.15} position={[4, 8, 5]} />
      <directionalLight intensity={0.4} position={[-4, 3, -5]} />
      <Suspense fallback={null}>
        <GlbModel url={url} />
      </Suspense>
      <OrbitControls enableDamping makeDefault />
    </Canvas>
  )
}

export function GlbPreviewPanel({
  glbUrl,
  downloadUrl,
  downloadName,
  status,
  statusText,
}: {
  glbUrl: string | null
  downloadUrl: string | null
  downloadName: string
  status: 'idle' | 'uploading' | 'processing' | 'complete' | 'error'
  statusText?: string
}) {
  return (
    <div className="flex h-[min(70vh,640px)] min-h-[320px] flex-col overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">
      <div className="flex shrink-0 items-center justify-between gap-2 border-border/60 border-b px-4 py-3">
        <h2 className="font-semibold text-sm">3Dプレビュー</h2>
        {downloadUrl && status === 'complete' && (
          <a
            className="rounded-lg bg-primary px-3 py-1.5 font-medium text-primary-foreground text-xs hover:opacity-90"
            download={downloadName}
            href={downloadUrl}
          >
            GLBをダウンロード
          </a>
        )}
      </div>

      <div className="relative min-h-0 flex-1 bg-muted/20">
        {glbUrl ? (
          <div className="absolute inset-0">
            <PreviewCanvas key={glbUrl} url={glbUrl} />
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            {status === 'processing' || status === 'uploading' ? (
              <Loader2 className="size-8 animate-spin text-muted-foreground" />
            ) : (
              <Box className="size-10 text-muted-foreground/50" />
            )}
            <p className="max-w-xs text-muted-foreground text-sm leading-relaxed">
              {status === 'idle' && '生成が完了すると、ここにモデルが表示されます。ドラッグで回転、ホイールでズーム。'}
              {status === 'uploading' && '画像をアップロード中…'}
              {status === 'processing' && (statusText ?? '3Dモデルを生成中…')}
              {status === 'error' && (statusText ?? '生成に失敗しました')}
              {status === 'complete' && !glbUrl && 'プレビューを読み込み中…'}
            </p>
          </div>
        )}
      </div>

      {glbUrl && (
        <p className="shrink-0 border-border/60 border-t px-4 py-2 text-center text-[10px] text-muted-foreground">
          左ドラッグ：回転 · ホイール：ズーム · 右ドラッグ：パン
        </p>
      )}
    </div>
  )
}
