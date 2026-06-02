import { randomBytes } from 'node:crypto'
import { mkdir, readFile, readdir, stat, symlink, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type JobStatus = 'pending' | 'validating' | 'processing' | 'merged' | 'imported' | 'failed'

/** Which parsing pipeline was used for this job. */
export type JobPipeline = 'geo+ai' | 'madori'

export type RunRecord = {
  runAt: string
  coordsFile: string | null
  semanticFile: string | null
  mergedFile: string | null
  channelBSkipped: boolean
  /** XML file written by the 3dMadori analyze-dxf pipeline (pipeline=madori only). */
  madoriXmlFile?: string | null
  error: string | null
}

export type Job = {
  jobId: string
  createdAt: string
  status: JobStatus
  pipeline: JobPipeline
  sourceFile: 'original.dxf'
  sceneId: string | null
  params: { wallThicknessMin: number; wallThicknessMax: number }
  runs: RunRecord[]
}

function dataDir(): string {
  const env = process.env['PASCAL_DATA_DIR']
  return env && env.length > 0 ? env : join(homedir(), '.pascal')
}

function todayFolder(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function hhmmss(): string {
  const d = new Date()
  return (
    String(d.getHours()).padStart(2, '0') +
    String(d.getMinutes()).padStart(2, '0') +
    String(d.getSeconds()).padStart(2, '0')
  )
}

async function findJobDir(jobId: string): Promise<string> {
  const importsBase = join(dataDir(), 'dxf-imports')
  let dateDirs: string[]
  try {
    dateDirs = await readdir(importsBase)
  } catch {
    throw new Error(`Job not found: ${jobId}`)
  }
  // Search today first, then remaining dirs newest-first
  const today = todayFolder()
  const ordered = [today, ...dateDirs.filter(d => d !== today).sort().reverse()]
  for (const dateDir of ordered) {
    const candidate = join(importsBase, dateDir, `job_${jobId}`)
    try {
      await stat(candidate)
      return candidate
    } catch {
      // not in this date dir
    }
  }
  throw new Error(`Job not found: ${jobId}`)
}

async function readJobFile(jobDir: string): Promise<Job> {
  const raw = await readFile(join(jobDir, 'job.json'), 'utf-8')
  return JSON.parse(raw) as Job
}

async function writeJobFile(jobDir: string, job: Job): Promise<void> {
  await writeFile(join(jobDir, 'job.json'), JSON.stringify(job, null, 2), 'utf-8')
}

export async function createJob(
  dxfBuffer: Uint8Array,
  previewPng: Uint8Array,
  params?: { wallThicknessMin: number; wallThicknessMax: number },
  pipeline: JobPipeline = 'geo+ai',
): Promise<Job> {
  const jobId = randomBytes(4).toString('hex')
  const jobDir = join(dataDir(), 'dxf-imports', todayFolder(), `job_${jobId}`)
  await mkdir(jobDir, { recursive: true })

  await writeFile(join(jobDir, 'original.dxf'), dxfBuffer)
  await writeFile(join(jobDir, 'preview.png'), previewPng)

  const job: Job = {
    jobId,
    createdAt: new Date().toISOString(),
    status: 'pending',
    pipeline,
    sourceFile: 'original.dxf',
    sceneId: null,
    params: params ?? { wallThicknessMin: 0.08, wallThicknessMax: 0.4 },
    runs: [],
  }
  await writeJobFile(jobDir, job)
  return job
}

export async function updateJobStatus(jobId: string, status: JobStatus): Promise<void> {
  const jobDir = await findJobDir(jobId)
  const job = await readJobFile(jobDir)
  job.status = status
  await writeJobFile(jobDir, job)
}

export async function writeRunOutput(
  jobId: string,
  type: 'coords' | 'semantic' | 'merged',
  data: unknown,
): Promise<string> {
  const jobDir = await findJobDir(jobId)
  const filename = `${type}_${hhmmss()}.json`
  await writeFile(join(jobDir, filename), JSON.stringify(data, null, 2), 'utf-8')

  const linkPath = join(jobDir, `${type}_latest.json`)
  try {
    await unlink(linkPath)
  } catch {
    // symlink didn't exist yet
  }
  // target is relative so the symlink stays valid if the parent dir is moved
  await symlink(filename, linkPath)

  return filename
}

export async function readLatest(
  jobId: string,
  type: 'coords' | 'semantic' | 'merged',
): Promise<unknown> {
  const jobDir = await findJobDir(jobId)
  const raw = await readFile(join(jobDir, `${type}_latest.json`), 'utf-8')
  return JSON.parse(raw)
}

export async function appendRun(jobId: string, runRecord: RunRecord): Promise<void> {
  const jobDir = await findJobDir(jobId)
  const job = await readJobFile(jobDir)
  job.runs.push(runRecord)
  await writeJobFile(jobDir, job)
}

/** Write 3dMadori analyze-dxf XML to the job folder and update the symlink. */
export async function writeMadoriXml(jobId: string, xml: string): Promise<string> {
  const jobDir = await findJobDir(jobId)
  const filename = `madori_${hhmmss()}.xml`
  await writeFile(join(jobDir, filename), xml, 'utf-8')

  const linkPath = join(jobDir, 'madori_latest.xml')
  try { await unlink(linkPath) } catch { /* symlink didn't exist yet */ }
  await symlink(filename, linkPath)
  return filename
}

/** Read the most recent 3dMadori XML from the job folder. */
export async function readMadoriXml(jobId: string): Promise<string> {
  const jobDir = await findJobDir(jobId)
  return readFile(join(jobDir, 'madori_latest.xml'), 'utf-8')
}

/** Read original.dxf bytes from the job folder. */
export async function readOriginalDxf(jobId: string): Promise<Buffer> {
  const jobDir = await findJobDir(jobId)
  return readFile(join(jobDir, 'original.dxf')) as Promise<Buffer>
}

/** Read job metadata. */
export async function getJob(jobId: string): Promise<Job> {
  const jobDir = await findJobDir(jobId)
  return readJobFile(jobDir)
}

/** Update sceneId in job.json after a successful import. */
export async function setJobSceneId(jobId: string, sceneId: string): Promise<void> {
  const jobDir = await findJobDir(jobId)
  const job = await readJobFile(jobDir)
  job.sceneId = sceneId
  await writeJobFile(jobDir, job)
}
