import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DeviceProfileDefinition } from '@pascal-app/core/lib/device-profile-registry'
import { generatePrimitiveGeometryDraft } from '../lib/ai-harness-runs/primitive-generation-service'
import { findRepoRoot, sanitizeSegment } from '../lib/generated-assets/manifest'
import {
  auditProfilePackValidation,
  installCloudProfilePack,
  type ProfilePackValidationResult,
  simulatedProfilePackCloudRoot,
  validateProfilePackDir,
  validateProfilePackZip,
} from '../lib/profile-packs'

type CliOptions = {
  packRef: string
  validateOnly: boolean
  profileIds: Set<string>
  limit?: number
}

type ProfilePackQaResult = {
  profileId: string
  prompt: string
  runId?: string
  status: 'passed' | 'failed'
  qualityScore: number
  shapeCount: number
  detailBudgetMaxShapes?: number
  detailBudgetApplied?: boolean
  editableSchemaRef?: string
  requiredRoles: string[]
  missingRoles: string[]
  warnings: string[]
  screenshotPath?: string
  artifactPath?: string
}

const repoRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)))

function parseArgs(argv: string[]): CliOptions {
  const positional: string[] = []
  const profileIds = new Set<string>()
  let validateOnly = false
  let limit: number | undefined
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg) continue
    if (arg === '--validate-only') {
      validateOnly = true
      continue
    }
    if (arg === '--profile') {
      const value = argv[index + 1]
      if (value) profileIds.add(value)
      index += 1
      continue
    }
    if (arg === '--limit') {
      const value = Number.parseInt(argv[index + 1] ?? '', 10)
      if (Number.isFinite(value) && value > 0) limit = value
      index += 1
      continue
    }
    positional.push(arg)
  }
  const packRef = positional[0]
  if (!packRef) {
    throw new Error(
      'Usage: bun apps/editor/scripts/profile-pack-qa.ts <pack-id[@version]|pack-dir|pack-zip> [--validate-only] [--profile <id>] [--limit <n>]',
    )
  }
  return { packRef, validateOnly, profileIds, ...(limit ? { limit } : {}) }
}

function parsePackRef(ref: string) {
  const atIndex = ref.lastIndexOf('@')
  if (atIndex <= 0) return { id: ref, version: undefined }
  return { id: ref.slice(0, atIndex), version: ref.slice(atIndex + 1) }
}

async function loadValidation(packRef: string): Promise<ProfilePackValidationResult> {
  const maybePath = path.resolve(packRef)
  try {
    const stat = await fs.stat(maybePath)
    if (stat.isDirectory()) return validateProfilePackDir(maybePath)
    if (stat.isFile()) return validateProfilePackZip(await fs.readFile(maybePath))
  } catch {
    // Treat non-path refs as simulated cloud package refs.
  }

  const { id, version } = parsePackRef(packRef)
  const cloudRoot = simulatedProfilePackCloudRoot(await findRepoRoot())
  const zipName = `${id}-${version ?? '0.1.0'}.zip`
  return validateProfilePackZip(await fs.readFile(path.join(cloudRoot, zipName)))
}

function resourceId(value: Record<string, unknown>) {
  return typeof value.id === 'string' && value.id.trim() ? value.id.trim() : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function qualityRuleForProfile(
  validation: ProfilePackValidationResult,
  profile: DeviceProfileDefinition,
) {
  const ref =
    typeof profile.qualityRules === 'string'
      ? profile.qualityRules
      : isRecord(profile.qualityRules) && typeof profile.qualityRules.id === 'string'
        ? profile.qualityRules.id
        : undefined
  return validation.resources.qualityRules.find((rule) => resourceId(rule) === ref)
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function asciiAlias(profile: DeviceProfileDefinition) {
  return (
    profile.aliases.find((alias) => /^[\x20-\x7e]+$/.test(alias) && /[a-z]/i.test(alias)) ??
    (/^[\x20-\x7e]+$/.test(profile.name) ? profile.name : undefined) ??
    profile.id
  )
}

function promptForProfile(profile: DeviceProfileDefinition) {
  const label = asciiAlias(profile)
  return `Create a ${label} industrial equipment using the ${profile.id} profile. Keep the geometry clean, recognizable, and not over-decorated.`
}

function rolesFromArtifact(artifact: { shapes?: Array<{ semanticRole?: string }> } | undefined) {
  return new Set((artifact?.shapes ?? []).map((shape) => shape.semanticRole).filter(Boolean))
}

function profileDetailBudgetMaxShapes(profile: DeviceProfileDefinition) {
  const budget = profile.detailBudget
  if (!isRecord(budget)) return undefined
  const maxShapes = budget.maxShapes
  return typeof maxShapes === 'number' && Number.isFinite(maxShapes) && maxShapes > 0
    ? Math.floor(maxShapes)
    : undefined
}

function artifactSourceArgs(artifact: unknown) {
  if (!isRecord(artifact)) return {}
  return isRecord(artifact.sourceArgs) ? artifact.sourceArgs : {}
}

function renderHtml(artifact: unknown, label: string) {
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
    <div id="label">${label}</div>
    <script type="module">
      import * as THREE from '/apps/editor/node_modules/three/build/three.module.js';
      const artifact = ${payload};
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0xeef1f4);
      const camera = new THREE.PerspectiveCamera(36, innerWidth / innerHeight, 0.01, 100);
      const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setSize(innerWidth, innerHeight);
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      document.body.appendChild(renderer.domElement);
      scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa4b2, 2.25));
      const key = new THREE.DirectionalLight(0xffffff, 2.8);
      key.position.set(4, 7, 5);
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
        return new THREE.BoxGeometry(shape.length || 0.2, shape.height || 0.2, shape.width || shape.depth || 0.2);
      }
      for (const shape of artifact.shapes || []) {
        const mesh = new THREE.Mesh(geo(shape), mat(shape));
        mesh.position.set(...(shape.position || [0, 0, 0]));
        const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(shape.rotation || [0, 0, 0]), 'XYZ'));
        mesh.quaternion.copy(rotation.multiply(axisQuaternion(shape.axis || 'y', shape.kind)));
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

async function renderArtifact(
  outputDir: string,
  profile: DeviceProfileDefinition,
  artifact: unknown,
) {
  const safeProfile = sanitizeSegment(profile.id, 'profile')
  const htmlPath = path.join(outputDir, `${safeProfile}.html`)
  const screenshotPath = path.join(outputDir, `${safeProfile}.png`)
  const artifactPath = path.join(outputDir, `${safeProfile}.artifact.json`)
  await fs.writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8')
  await fs.writeFile(htmlPath, renderHtml(artifact, profile.id), 'utf8')
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      'node',
      ['apps/editor/scripts/render-primitive-visual-qa.mjs', repoRoot, htmlPath, screenshotPath],
      { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(stderr.trim() || `renderer exited with code ${code}`))
    })
  })
  return { screenshotPath, artifactPath }
}

async function runProfileQa(
  validation: ProfilePackValidationResult,
  profile: DeviceProfileDefinition,
  outputDir: string,
): Promise<ProfilePackQaResult> {
  const qualityRule = qualityRuleForProfile(validation, profile)
  const requiredRoles = stringArray(qualityRule?.requiredRoles)
  const prompt = promptForProfile(profile)
  const warnings: string[] = []
  const result = await generatePrimitiveGeometryDraft({
    prompt,
    conversationId: `profile-pack-qa:${validation.manifest.id}:${profile.id}`,
    context: {
      industrySourcePack: {
        id: validation.manifest.id,
        version: validation.manifest.version,
        industry: validation.manifest.industry,
      },
    },
    source: 'profile-pack-qa',
  })
  const artifact = result.artifact
  const roles = rolesFromArtifact(artifact)
  const missingRoles = requiredRoles.filter((role) => !roles.has(role))
  if (missingRoles.length) warnings.push(`missing roles: ${missingRoles.join(', ')}`)
  const qualityScore = artifact?.profileQuality?.overallScore ?? 0
  const shapeCount = artifact?.shapes?.length ?? 0
  const maxShapes = profileDetailBudgetMaxShapes(profile)
  const sourceArgs = artifactSourceArgs(artifact)
  const detailBudgetApplied = sourceArgs.detailBudgetApplied === true
  if (maxShapes != null && shapeCount > maxShapes) {
    warnings.push(`shape count ${shapeCount} exceeds detailBudget.maxShapes ${maxShapes}`)
  }
  const minQualityScore = 0.72
  if (qualityScore < minQualityScore) {
    warnings.push(`quality ${qualityScore.toFixed(2)} below ${minQualityScore}`)
  }
  let rendered: { screenshotPath?: string; artifactPath?: string } = {}
  if (artifact) {
    try {
      rendered = await renderArtifact(outputDir, profile, artifact)
    } catch (error) {
      warnings.push(`render: ${error instanceof Error ? error.message : 'failed'}`)
    }
  } else {
    warnings.push('missing artifact')
  }
  return {
    profileId: profile.id,
    prompt,
    runId: result.runId,
    status: result.status === 'succeeded' && warnings.length === 0 ? 'passed' : 'failed',
    qualityScore,
    shapeCount,
    ...(maxShapes != null ? { detailBudgetMaxShapes: maxShapes } : {}),
    ...(detailBudgetApplied ? { detailBudgetApplied } : {}),
    ...(profile.editableSchemaRef ? { editableSchemaRef: profile.editableSchemaRef } : {}),
    requiredRoles,
    missingRoles,
    warnings,
    ...rendered,
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const validation = await loadValidation(options.packRef)
  const audit = auditProfilePackValidation(validation)
  const outputDir = path.join(
    repoRoot,
    'apps/editor/.generated/profile-pack-qa',
    `${sanitizeSegment(validation.manifest.id, 'pack')}@${sanitizeSegment(
      validation.manifest.version,
      '0.0.0',
    )}`,
  )
  await fs.mkdir(outputDir, { recursive: true })

  if (!audit.ok || options.validateOnly) {
    const report = {
      createdAt: new Date().toISOString(),
      pack: validation.manifest,
      audit,
      results: [],
    }
    const reportPath = path.join(outputDir, 'profile-pack-qa-report.json')
    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    console.log(JSON.stringify({ reportPath, auditOk: audit.ok, validateOnly: true }, null, 2))
    if (!audit.ok) process.exitCode = 1
    return
  }

  const { id, version } = parsePackRef(`${validation.manifest.id}@${validation.manifest.version}`)
  await installCloudProfilePack(id, version)
  const selectedProfiles = validation.profiles
    .filter((profile) => options.profileIds.size === 0 || options.profileIds.has(profile.id))
    .slice(0, options.limit)
  const results: ProfilePackQaResult[] = []
  for (const profile of selectedProfiles) {
    console.log(`profile pack QA: ${profile.id}`)
    results.push(await runProfileQa(validation, profile, outputDir))
  }
  const report = {
    createdAt: new Date().toISOString(),
    pack: validation.manifest,
    audit,
    passed: results.filter((result) => result.status === 'passed').length,
    failed: results.filter((result) => result.status === 'failed').length,
    results,
  }
  const reportPath = path.join(outputDir, 'profile-pack-qa-report.json')
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ reportPath, passed: report.passed, failed: report.failed }, null, 2))
  if (report.failed > 0) process.exitCode = 1
}

await main()
