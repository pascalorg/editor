import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { findRepoRoot, sanitizeSegment } from '../lib/generated-assets/manifest'

type FactoryReleaseCandidateStepStatus = 'passed' | 'failed' | 'skipped'

export type FactoryReleaseCandidateStep = {
  id: string
  command: string[]
  durationMs: number
  status: FactoryReleaseCandidateStepStatus
  exitCode?: number
  outputTail?: string[]
}

export type FactoryReleaseCandidateOptions = {
  outputDir?: string
  withVisualSmoke: boolean
  baseUrl: string
}

export type FactoryReleaseCandidateReport = {
  ok: boolean
  generatedAt: string
  repoRoot: string
  outputDir: string
  withVisualSmoke: boolean
  steps: FactoryReleaseCandidateStep[]
}

const CORE_TEST_FILES = [
  'apps/editor/scripts/factory-release-readiness.test.ts',
  'apps/editor/lib/ai-harness-runs/factory-planner.test.ts',
  'apps/editor/lib/ai-harness-runs/factory-runner.test.ts',
]

const BIOME_FILES = [
  'apps/editor/scripts/factory-release-candidate.ts',
  'apps/editor/scripts/factory-release-candidate.test.ts',
  'apps/editor/scripts/factory-release-readiness.ts',
  'apps/editor/scripts/factory-release-readiness.test.ts',
  'apps/editor/package.json',
  'docs/3d-factory-product-workflow-design.md',
]

const REFINERY_KEY_STATIONS = [
  'crude_storage_tank',
  'atmospheric_distillation_unit',
  'fluid_catalytic_cracking_unit',
  'hydrotreating_unit',
  'catalytic_reformer_unit',
  'flare_system',
  'pipe_rack',
]

export function parseFactoryReleaseCandidateArgs(argv: string[]): FactoryReleaseCandidateOptions {
  const options: FactoryReleaseCandidateOptions = {
    withVisualSmoke: false,
    baseUrl: process.env.FACTORY_RENDER_QA_BASE_URL ?? 'http://localhost:3002',
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg) continue
    if (arg === '--out-dir') {
      const value = argv[++index]
      if (!value) throw new Error('--out-dir requires a path')
      options.outputDir = value
      continue
    }
    if (arg === '--with-visual-smoke') {
      options.withVisualSmoke = true
      continue
    }
    if (arg === '--base-url') {
      const value = argv[++index]
      if (!value) throw new Error('--base-url requires a URL')
      options.baseUrl = value
      continue
    }
    if (arg === '--help' || arg === '-h') {
      console.log(
        [
          'Usage: bun apps/editor/scripts/factory-release-candidate.ts [options]',
          '',
          'Options:',
          '  --out-dir <path>       Write factory-release-candidate.json and nested QA artifacts.',
          '  --with-visual-smoke    Include refinery browser smoke QA. Requires a running editor server.',
          '  --base-url <url>       Editor URL for visual smoke. Default: http://localhost:3002',
          '  --help                 Show this help.',
        ].join('\n'),
      )
      process.exit(0)
    }
    throw new Error(`Unknown option ${arg}`)
  }
  return options
}

function tailLines(value: string, maxLines = 30) {
  return value
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .slice(-maxLines)
}

async function runStep(input: {
  cwd: string
  id: string
  command: string[]
}): Promise<FactoryReleaseCandidateStep> {
  const started = Date.now()
  const [command, ...args] = input.command
  if (!command) throw new Error(`Step ${input.id} has no command.`)
  const output: string[] = []
  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: input.cwd,
      env: process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout.on('data', (chunk) => output.push(String(chunk)))
    child.stderr.on('data', (chunk) => output.push(String(chunk)))
    child.on('error', reject)
    child.on('close', (code) => resolve(code ?? 1))
  })
  const status: FactoryReleaseCandidateStepStatus = exitCode === 0 ? 'passed' : 'failed'
  return {
    id: input.id,
    command: input.command,
    durationMs: Date.now() - started,
    status,
    exitCode,
    outputTail: tailLines(output.join('')),
  }
}

function bunCommand(repoRoot: string) {
  return process.execPath.endsWith('bun.exe') || path.basename(process.execPath) === 'bun'
    ? process.execPath
    : path.join(repoRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'bun.cmd' : 'bun')
}

function buildSteps(input: {
  repoRoot: string
  outputDir: string
  options: FactoryReleaseCandidateOptions
}) {
  const bun = bunCommand(input.repoRoot)
  const readinessDir = path.join(input.outputDir, 'release-readiness')
  const steps = [
    {
      id: 'factory-release-readiness',
      command: [
        bun,
        'run',
        '--cwd',
        'apps/editor',
        'factory:release-qa',
        '--',
        '--out-dir',
        readinessDir,
      ],
    },
    {
      id: 'factory-core-tests',
      command: [bun, 'test', ...CORE_TEST_FILES],
    },
    {
      id: 'editor-typecheck',
      command: [bun, 'run', '--cwd', 'apps/editor', 'check-types'],
    },
    {
      id: 'factory-biome-check',
      command: [
        bun,
        'x',
        'biome',
        'check',
        '--formatter-enabled=false',
        '--assist-enabled=false',
        ...BIOME_FILES,
      ],
    },
  ]
  if (input.options.withVisualSmoke) {
    const visualDir = path.join(input.outputDir, 'refinery-smoke')
    steps.push({
      id: 'refinery-visual-smoke',
      command: [
        bun,
        'apps/editor/scripts/factory-full-run-qa.ts',
        '--prompt',
        'generate a refinery',
        '--base-url',
        input.options.baseUrl,
        '--out-dir',
        visualDir,
        '--conversation-id',
        `factory-rc-refinery-${Date.now()}`,
        '--scene-id',
        `factory-rc-refinery-${Date.now()}`,
        '--mode',
        'smoke',
        ...REFINERY_KEY_STATIONS.flatMap((stationId) => ['--key-station', stationId]),
        '--timeout-ms',
        '600000',
      ],
    })
  }
  return steps
}

export async function runFactoryReleaseCandidate(
  options: FactoryReleaseCandidateOptions,
): Promise<FactoryReleaseCandidateReport> {
  const repoRoot = await findRepoRoot()
  const outputDir = path.resolve(
    repoRoot,
    options.outputDir ??
      path.join(
        'apps/editor/qa-artifacts/factory-release-candidate',
        `${Date.now()}-${sanitizeSegment(options.withVisualSmoke ? 'visual' : 'fast', 'rc')}`,
      ),
  )
  await fs.mkdir(outputDir, { recursive: true })

  const steps: FactoryReleaseCandidateStep[] = []
  for (const step of buildSteps({ repoRoot, outputDir, options })) {
    console.log(`factory release candidate: ${step.id}`)
    const result = await runStep({ cwd: repoRoot, id: step.id, command: step.command })
    steps.push(result)
    if (result.status === 'failed') break
  }

  const report: FactoryReleaseCandidateReport = {
    ok: steps.every((step) => step.status === 'passed'),
    generatedAt: new Date().toISOString(),
    repoRoot,
    outputDir,
    withVisualSmoke: options.withVisualSmoke,
    steps,
  }
  await fs.writeFile(
    path.join(outputDir, 'factory-release-candidate.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  )
  return report
}

if (import.meta.main) {
  const options = parseFactoryReleaseCandidateArgs(process.argv.slice(2))
  const report = await runFactoryReleaseCandidate(options)
  console.log(
    JSON.stringify(
      {
        ok: report.ok,
        outputDir: report.outputDir,
        steps: report.steps.map((step) => ({
          id: step.id,
          status: step.status,
          durationMs: step.durationMs,
          exitCode: step.exitCode,
        })),
      },
      null,
      2,
    ),
  )
  if (!report.ok) process.exitCode = 1
}
