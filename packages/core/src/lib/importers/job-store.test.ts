import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type RunRecord,
  appendRun,
  createJob,
  readLatest,
  updateJobStatus,
  writeRunOutput,
} from './job-store'

const DXF_BYTES = new TextEncoder().encode('DXF_DATA')
const PNG_BYTES = new TextEncoder().encode('PNG_DATA')

let tmpDir: string

async function jobDir(jobId: string): Promise<string> {
  const [dateFolder] = await readdir(join(tmpDir, 'dxf-imports'))
  return join(tmpDir, 'dxf-imports', dateFolder!, `job_${jobId}`)
}

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'pascal-job-store-'))
  process.env['PASCAL_DATA_DIR'] = tmpDir
})

afterEach(async () => {
  delete process.env['PASCAL_DATA_DIR']
  await rm(tmpDir, { recursive: true, force: true })
})

describe('createJob', () => {
  test('returns a Job with correct initial shape', async () => {
    const job = await createJob(DXF_BYTES, PNG_BYTES)

    expect(job.jobId).toMatch(/^[0-9a-f]{8}$/)
    expect(job.status).toBe('pending')
    expect(job.sourceFile).toBe('original.dxf')
    expect(job.sceneId).toBeNull()
    expect(job.runs).toHaveLength(0)
    expect(job.params.wallThicknessMin).toBe(0.08)
    expect(job.params.wallThicknessMax).toBe(0.4)
    expect(job.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  test('writes original.dxf and preview.png', async () => {
    const job = await createJob(DXF_BYTES, PNG_BYTES)
    const dir = await jobDir(job.jobId)

    expect(await readFile(join(dir, 'original.dxf'))).toEqual(Buffer.from(DXF_BYTES))
    expect(await readFile(join(dir, 'preview.png'))).toEqual(Buffer.from(PNG_BYTES))
  })

  test('writes job.json matching the returned Job', async () => {
    const job = await createJob(DXF_BYTES, PNG_BYTES)
    const dir = await jobDir(job.jobId)
    const stored = JSON.parse(await readFile(join(dir, 'job.json'), 'utf-8'))

    expect(stored).toEqual(job)
  })

  test('generates unique jobIds across concurrent calls', async () => {
    const [a, b] = await Promise.all([createJob(DXF_BYTES, PNG_BYTES), createJob(DXF_BYTES, PNG_BYTES)])
    expect(a.jobId).not.toBe(b.jobId)
  })
})

describe('updateJobStatus', () => {
  test('persists the new status to job.json', async () => {
    const job = await createJob(DXF_BYTES, PNG_BYTES)
    await updateJobStatus(job.jobId, 'processing')

    const dir = await jobDir(job.jobId)
    const stored = JSON.parse(await readFile(join(dir, 'job.json'), 'utf-8'))
    expect(stored.status).toBe('processing')
  })

  test('does not mutate other fields', async () => {
    const job = await createJob(DXF_BYTES, PNG_BYTES)
    await updateJobStatus(job.jobId, 'merged')

    const dir = await jobDir(job.jobId)
    const stored = JSON.parse(await readFile(join(dir, 'job.json'), 'utf-8'))
    expect(stored.jobId).toBe(job.jobId)
    expect(stored.sourceFile).toBe('original.dxf')
    expect(stored.runs).toHaveLength(0)
  })

  test('throws for an unknown jobId', async () => {
    await expect(updateJobStatus('00000000', 'failed')).rejects.toThrow('Job not found: 00000000')
  })
})

describe('writeRunOutput', () => {
  test('returns a timestamped filename matching <type>_HHmmss.json', async () => {
    const job = await createJob(DXF_BYTES, PNG_BYTES)
    const filename = await writeRunOutput(job.jobId, 'coords', { walls: [] })
    expect(filename).toMatch(/^coords_\d{6}\.json$/)
  })

  test('written file contains the data', async () => {
    const job = await createJob(DXF_BYTES, PNG_BYTES)
    const payload = { walls: [{ id: 'w_001', start: [0, 0], end: [5, 0] }] }
    const filename = await writeRunOutput(job.jobId, 'coords', payload)

    const dir = await jobDir(job.jobId)
    const stored = JSON.parse(await readFile(join(dir, filename), 'utf-8'))
    expect(stored).toEqual(payload)
  })

  test('creates a readable <type>_latest.json symlink', async () => {
    const job = await createJob(DXF_BYTES, PNG_BYTES)
    await writeRunOutput(job.jobId, 'semantic', { rooms: [{ name: '客厅' }] })

    const result = await readLatest(job.jobId, 'semantic')
    expect(result).toEqual({ rooms: [{ name: '客厅' }] })
  })

  test('symlink follows the most recent write', async () => {
    const job = await createJob(DXF_BYTES, PNG_BYTES)
    await writeRunOutput(job.jobId, 'merged', { v: 1 })
    await writeRunOutput(job.jobId, 'merged', { v: 2 })

    const latest = await readLatest(job.jobId, 'merged')
    expect((latest as { v: number }).v).toBe(2)
  })

  test('supports all three types independently', async () => {
    const job = await createJob(DXF_BYTES, PNG_BYTES)
    await writeRunOutput(job.jobId, 'coords', { c: true })
    await writeRunOutput(job.jobId, 'semantic', { s: true })
    await writeRunOutput(job.jobId, 'merged', { m: true })

    expect(await readLatest(job.jobId, 'coords')).toEqual({ c: true })
    expect(await readLatest(job.jobId, 'semantic')).toEqual({ s: true })
    expect(await readLatest(job.jobId, 'merged')).toEqual({ m: true })
  })
})

describe('readLatest', () => {
  test('throws when no output has been written for that type', async () => {
    const job = await createJob(DXF_BYTES, PNG_BYTES)
    await expect(readLatest(job.jobId, 'coords')).rejects.toThrow()
  })
})

describe('appendRun', () => {
  test('appends a run record to job.json runs array', async () => {
    const job = await createJob(DXF_BYTES, PNG_BYTES)
    const run: RunRecord = {
      runAt: '2026-05-28T14:30:22Z',
      coordsFile: 'coords_143022.json',
      semanticFile: 'semantic_143028.json',
      mergedFile: 'merged_143031.json',
      channelBSkipped: false,
      error: null,
    }
    await appendRun(job.jobId, run)

    const dir = await jobDir(job.jobId)
    const stored = JSON.parse(await readFile(join(dir, 'job.json'), 'utf-8'))
    expect(stored.runs).toHaveLength(1)
    expect(stored.runs[0]).toEqual(run)
  })

  test('preserves order across multiple appends', async () => {
    const job = await createJob(DXF_BYTES, PNG_BYTES)
    const makeRun = (n: number): RunRecord => ({
      runAt: `2026-05-28T14:30:0${n}Z`,
      coordsFile: `coords_run${n}.json`,
      semanticFile: null,
      mergedFile: null,
      channelBSkipped: true,
      error: null,
    })
    await appendRun(job.jobId, makeRun(1))
    await appendRun(job.jobId, makeRun(2))
    await appendRun(job.jobId, makeRun(3))

    const dir = await jobDir(job.jobId)
    const stored = JSON.parse(await readFile(join(dir, 'job.json'), 'utf-8'))
    expect(stored.runs).toHaveLength(3)
    expect(stored.runs.map((r: RunRecord) => r.coordsFile)).toEqual([
      'coords_run1.json',
      'coords_run2.json',
      'coords_run3.json',
    ])
  })
})
