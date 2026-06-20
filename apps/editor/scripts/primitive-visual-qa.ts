import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { generatePrimitiveGeometryDraft } from '../lib/ai-harness-runs/primitive-generation-service'
import { installCloudProfilePack } from '../lib/profile-packs'

type VisualQaSample = {
  id: string
  label: string
  prompt: string
  installPacks?: string[]
  requiredRoles?: string[]
  requiredRoleGroups?: string[][]
  forbiddenRoles?: string[]
  minQualityScore?: number
  maxShapeCount?: number
}

type RenderResult = {
  screenshotPath?: string
  artifactPath?: string
  renderWarning?: string
}

type VisualQaResult = {
  id: string
  label: string
  prompt: string
  runId?: string
  status: 'passed' | 'failed'
  qualityScore: number
  shapeCount: number
  screenshotPath?: string
  artifactPath?: string
  missingRoles: string[]
  missingRoleGroups: string[][]
  forbiddenRolesPresent: string[]
  warnings: string[]
}

const repoRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)))
const samplesPath = path.join(repoRoot, 'apps/editor/data/primitive-visual-qa-samples.json')
const outputRoot = path.join(repoRoot, 'apps/editor/.generated/primitive-visual-qa')

function parsePackRef(ref: string) {
  const [id, version] = ref.split('@')
  return { id, version }
}

async function readSamples(): Promise<VisualQaSample[]> {
  const raw = JSON.parse(await fs.readFile(samplesPath, 'utf8')) as unknown
  if (!Array.isArray(raw)) throw new Error('primitive visual QA samples must be an array')
  return raw as VisualQaSample[]
}

async function installPacks(refs: string[] = []) {
  for (const ref of refs) {
    const { id, version } = parsePackRef(ref)
    if (!id) continue
    await installCloudProfilePack(id, version)
  }
}

function rolesFromArtifact(artifact: { shapes?: Array<{ semanticRole?: string }> } | undefined) {
  return new Set((artifact?.shapes ?? []).map((shape) => shape.semanticRole).filter(Boolean))
}

function renderHtml(artifact: unknown) {
  const payload = JSON.stringify(artifact).replace(/</g, '\\u003c')
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#eef1f4}
      #label{position:fixed;left:16px;top:14px;z-index:2;padding:7px 9px;border-radius:6px;background:rgba(255,255,255,.78);font:600 12px/1.35 system-ui;color:#111827}
    </style>
  </head>
  <body>
    <div id="label"></div>
    <script type="module">
      import * as THREE from '/apps/editor/node_modules/three/build/three.module.js';
      const artifact = ${payload};
      document.querySelector('#label').textContent = artifact.title || artifact.assemblyName || 'primitive visual QA';
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0xeef1f4);
      const camera = new THREE.PerspectiveCamera(36, innerWidth / innerHeight, 0.01, 100);
      const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setSize(innerWidth, innerHeight);
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.shadowMap.enabled = true;
      document.body.appendChild(renderer.domElement);
      scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa4b2, 2.25));
      const key = new THREE.DirectionalLight(0xffffff, 2.8);
      key.position.set(4, 7, 5);
      key.castShadow = true;
      scene.add(key);
      const fill = new THREE.DirectionalLight(0xdbeafe, 1.1);
      fill.position.set(-4, 4, -3);
      scene.add(fill);
      const grid = new THREE.GridHelper(8, 32, 0xb7c0cb, 0xd5dbe3);
      grid.position.y = -0.004;
      scene.add(grid);
      const group = new THREE.Group();
      scene.add(group);
      function mat(shape) {
        const p = shape.material?.properties || {};
        return new THREE.MeshStandardMaterial({
          color: p.color || shape.color || '#94a3b8',
          roughness: p.roughness ?? 0.42,
          metalness: p.metalness ?? 0.35,
          opacity: p.opacity ?? 1,
          transparent: Boolean(p.transparent),
        });
      }
      function axisQuaternion(axis, kind) {
        const e = new THREE.Euler(0, 0, 0, 'XYZ');
        if (kind === 'torus') {
          if (axis === 'y') e.x = Math.PI / 2;
          if (axis === 'x') e.y = Math.PI / 2;
          return new THREE.Quaternion().setFromEuler(e);
        }
        if (axis === 'x') e.z = Math.PI / 2;
        if (axis === 'z') e.x = Math.PI / 2;
        return new THREE.Quaternion().setFromEuler(e);
      }
      function geo(shape) {
        const r = shape.radius || 0.06;
        const h = shape.height || shape.length || 0.2;
        if (shape.kind === 'sphere') return new THREE.SphereGeometry(r, shape.widthSegments || 32, shape.heightSegments || 16);
        if (shape.kind === 'torus') return new THREE.TorusGeometry(shape.majorRadius || r, shape.tubeRadius || 0.015, 12, 56);
        if (shape.kind === 'capsule') return new THREE.CapsuleGeometry(r, Math.max(0.01, h - r * 2), 6, shape.radialSegments || 16);
        if (shape.kind === 'frustum') return new THREE.CylinderGeometry(shape.radiusTop || r, shape.radiusBottom || r * 0.5, h, shape.radialSegments || 32);
        if (shape.kind === 'cylinder' || shape.kind === 'hollow-cylinder') return new THREE.CylinderGeometry(r, shape.radiusBottom || r, h, shape.radialSegments || 40);
        if (shape.kind === 'rounded-panel') return new THREE.BoxGeometry(shape.length || 0.2, shape.width || 0.2, shape.thickness || 0.02);
        return new THREE.BoxGeometry(shape.length || 0.2, shape.height || 0.2, shape.width || shape.depth || 0.2);
      }
      for (const shape of artifact.shapes || []) {
        const mesh = new THREE.Mesh(geo(shape), mat(shape));
        mesh.position.set(...(shape.position || [0, 0, 0]));
        const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(shape.rotation || [0, 0, 0]), 'XYZ'));
        mesh.quaternion.copy(rotation.multiply(axisQuaternion(shape.axis || 'y', shape.kind)));
        const scale = shape.scale || [1, 1, 1];
        mesh.scale.set(scale[0] || 1, scale[1] || 1, scale[2] || 1);
        group.add(mesh);
      }
      const box = new THREE.Box3().setFromObject(group);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      group.position.x -= center.x;
      group.position.z -= center.z;
      group.position.y -= box.min.y;
      const maxDim = Math.max(size.x || 1, size.y || 1, size.z || 1);
      camera.position.set(-maxDim * 1.35, Math.max(size.y * 0.75, 1), maxDim * 1.55);
      camera.lookAt(new THREE.Vector3(0, size.y * 0.5, 0));
      renderer.render(scene, camera);
      window.__renderReady = true;
    </script>
  </body>
</html>`
}

async function runNodeRenderer(htmlPath: string, screenshotPath: string) {
  const rendererScript = path.join(repoRoot, 'apps/editor/scripts/render-primitive-visual-qa.mjs')
  await new Promise<void>((resolve, reject) => {
    const child = spawn('node', [rendererScript, repoRoot, htmlPath, screenshotPath], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('renderer timed out'))
    }, 60_000)
    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(stderr.trim() || `renderer exited with code ${code}`))
    })
  })
}

async function renderArtifact(sample: VisualQaSample, artifact: unknown): Promise<RenderResult> {
  const sampleDir = path.join(outputRoot, sample.id)
  await fs.mkdir(sampleDir, { recursive: true })
  const htmlPath = path.join(sampleDir, 'render.html')
  const screenshotPath = path.join(sampleDir, 'screenshot.png')
  const artifactPath = path.join(sampleDir, 'artifact.json')
  await fs.writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8')
  await fs.writeFile(htmlPath, renderHtml(artifact), 'utf8')
  try {
    await runNodeRenderer(htmlPath, screenshotPath)
    return { screenshotPath, artifactPath }
  } catch (error) {
    return {
      artifactPath,
      renderWarning: error instanceof Error ? error.message : 'render failed',
    }
  }
}

async function runSample(sample: VisualQaSample): Promise<VisualQaResult> {
  const warnings: string[] = []
  await installPacks(sample.installPacks)
  const result = await generatePrimitiveGeometryDraft({
    prompt: sample.prompt,
    conversationId: `primitive-visual-qa:${sample.id}`,
    source: 'primitive-visual-qa',
  })
  const artifact = result.artifact
  const shapeCount = artifact?.shapes?.length ?? 0
  const qualityScore = artifact?.profileQuality?.overallScore ?? 0
  const roles = rolesFromArtifact(artifact)
  const missingRoles = (sample.requiredRoles ?? []).filter((role) => !roles.has(role))
  const missingRoleGroups = (sample.requiredRoleGroups ?? []).filter(
    (group) => !group.some((role) => roles.has(role)),
  )
  const forbiddenRolesPresent = (sample.forbiddenRoles ?? []).filter((role) => roles.has(role))
  if (qualityScore < (sample.minQualityScore ?? 0))
    warnings.push(`quality ${qualityScore.toFixed(2)} below ${sample.minQualityScore}`)
  if (shapeCount > (sample.maxShapeCount ?? Number.POSITIVE_INFINITY))
    warnings.push(`shapeCount ${shapeCount} above ${sample.maxShapeCount}`)
  if (missingRoles.length) warnings.push(`missing roles: ${missingRoles.join(', ')}`)
  if (missingRoleGroups.length)
    warnings.push(
      `missing role groups: ${missingRoleGroups.map((group) => group.join('|')).join(', ')}`,
    )
  if (forbiddenRolesPresent.length)
    warnings.push(`forbidden roles: ${forbiddenRolesPresent.join(', ')}`)
  const rendered: RenderResult = artifact ? await renderArtifact(sample, artifact) : {}
  if ('renderWarning' in rendered && rendered.renderWarning) {
    warnings.push(`render: ${rendered.renderWarning}`)
  }
  const { renderWarning: _renderWarning, ...renderedResult } = rendered
  return {
    id: sample.id,
    label: sample.label,
    prompt: sample.prompt,
    runId: result.runId,
    status: warnings.length === 0 && result.status === 'succeeded' ? 'passed' : 'failed',
    qualityScore,
    shapeCount,
    ...renderedResult,
    missingRoles,
    missingRoleGroups,
    forbiddenRolesPresent,
    warnings,
  }
}

async function main() {
  await fs.mkdir(outputRoot, { recursive: true })
  const samples = await readSamples()
  const only = new Set(process.argv.slice(2).filter(Boolean))
  const selected = only.size ? samples.filter((sample) => only.has(sample.id)) : samples
  const results: VisualQaResult[] = []
  for (const sample of selected) {
    console.log(`primitive visual QA: ${sample.id}`)
    results.push(await runSample(sample))
  }
  const report = {
    createdAt: new Date().toISOString(),
    outputRoot,
    passed: results.filter((result) => result.status === 'passed').length,
    failed: results.filter((result) => result.status === 'failed').length,
    results,
  }
  const reportPath = path.join(outputRoot, 'visual-qa-report.json')
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ reportPath, passed: report.passed, failed: report.failed }, null, 2))
  if (report.failed > 0) process.exitCode = 1
}

await main()
