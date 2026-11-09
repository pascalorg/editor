import { afterAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const executable = path.join(import.meta.dir, 'bin/pascal.ts')
const testRoot = await mkdtemp(path.join(os.tmpdir(), 'pascal-cli-command-test-'))
const testHome = path.join(testRoot, 'home')
const claimFetchPreload = path.join(testRoot, 'claim-fetch-preload.mjs')
const architectFetchPreload = path.join(testRoot, 'architect-fetch-preload.mjs')

await writeFile(
  architectFetchPreload,
  `globalThis.fetch = async (input, init) => {
    if (init?.redirect !== 'error') throw new Error('Redirects must be disabled')
    if (process.env.PASCAL_API_KEY !== undefined) {
      throw new Error('PASCAL_API_KEY remained in the process environment')
    }
    const request = { method: init?.method, url: String(input), body: init?.body ? JSON.parse(init.body) : null }
    if (JSON.stringify(request) !== process.env.PASCAL_ARCHITECT_TEST_REQUEST) {
      throw new Error('Unexpected architect request ' + JSON.stringify(request))
    }
    if (new Headers(init?.headers).get('authorization') !== 'Bearer sk_live_architect-cli-key') {
      throw new Error('Unexpected architect authorization')
    }
    return new Response(process.env.PASCAL_ARCHITECT_TEST_BODY, {
      headers: { 'content-type': process.env.PASCAL_ARCHITECT_TEST_CONTENT_TYPE },
      status: Number(process.env.PASCAL_ARCHITECT_TEST_STATUS),
    })
  }
`,
)

await writeFile(
  claimFetchPreload,
  `globalThis.fetch = async (input, init) => {
    if (String(input) !== process.env.PASCAL_AGENT_TEST_ENDPOINT) {
      throw new Error('Unexpected agent endpoint')
    }
    if (init?.method !== process.env.PASCAL_AGENT_TEST_METHOD) throw new Error('Unexpected method')
    if (init?.redirect !== 'error') throw new Error('Redirects must be disabled')
    if (process.env.PASCAL_API_KEY !== undefined) {
      throw new Error('PASCAL_API_KEY remained in the process environment')
    }
    const authorization = new Headers(init?.headers).get('authorization')
    if (authorization !== process.env.PASCAL_AGENT_TEST_AUTHORIZATION) {
      throw new Error('Unexpected agent authorization')
    }
    return new Response(process.env.PASCAL_AGENT_TEST_BODY, {
      headers: { 'content-type': 'application/json' },
      status: Number(process.env.PASCAL_AGENT_TEST_STATUS),
    })
  }
`,
)

afterAll(() => rm(testRoot, { recursive: true, force: true }))

describe('command parsing', () => {
  test('shows the command reference for subcommand help', async () => {
    const result = await runCli('status', '--help')

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('pascal editor')
    expect(result.stdout).toContain('npx @pascal-app/cli <command>')
    expect(result.stdout).toContain('npm install --global @pascal-app/cli')
  })

  test('shows focused help for MCP commands', async () => {
    const result = await runCli('mcp', '--help')

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('pascal mcp setup codex')
    expect(result.stdout).toContain('dynamic loopback port')
    expect(result.stdout).not.toContain('pascal plugin list')
  })

  test('shows focused help for hosted agent claims', async () => {
    const result = await runCli('agent', '--help')

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('pascal agent claim')
    expect(result.stdout).toContain('PASCAL_API_KEY')
    expect(result.stdout).toContain('does not transfer project ownership')
    expect(result.stdout).not.toContain('pascal plugin list')
  })

  test('requires an environment credential before starting an agent claim', async () => {
    const result = await runCli('agent', 'claim', '--no-open', '--json')

    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stderr)).toEqual({
      error: 'agent_api_key_missing',
      message: "Set PASCAL_API_KEY to this autonomous agent's API key and try again.",
    })
    expect(result.stdout).toBe('')
  })

  test('prints the exact successful JSON claim contract without opening a browser', async () => {
    const claim = {
      claimCode: 'BCDF-GHJK-LMNP',
      claimUrl: 'https://editor.pascal.app/settings/agents/claim',
      expiresAt: '2026-09-10T18:30:00.000Z',
    }

    const result = await runClaimCli(
      200,
      { ...claim, agent: { name: '\u001b[2J', client: 'test' } },
      '--json',
    )

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual(claim)
    expect(result.stderr).toBe('')
  })

  test('prints a terminal-safe human claim without server-controlled identity text', async () => {
    const result = await runClaimCli(
      200,
      {
        claimCode: 'BCDF-GHJK-LMNP',
        claimUrl: 'https://editor.pascal.app/settings/agents/claim',
        expiresAt: '2026-09-10T18:30:00.000Z',
        agent: { name: '\u001b[2Jmalicious', client: 'test' },
      },
      '--no-open',
    )

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Claim code: BCDF-GHJK-LMNP')
    expect(result.stdout).toContain(
      'Claim page: https://editor.pascal.app/settings/agents/claim?code=BCDF-GHJK-LMNP',
    )
    expect(result.stdout).toContain('Claiming links accountability.')
    expect(result.stdout).not.toContain('malicious')
    expect(result.stdout).not.toContain('\u001b')
    expect(result.stderr).toBe('')
  })

  test.each([
    [401, 'agent_claim_unauthorized'],
    [409, 'agent_already_claimed'],
  ])('preserves the hosted HTTP %i error contract', async (status, errorCode) => {
    const result = await runClaimCli(status, '<html>untrusted error</html>', '--json')

    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stderr)).toMatchObject({
      details: { status },
      error: errorCode,
    })
    expect(result.stdout).toBe('')
  })

  test('prints the exact successful JSON agent status contract', async () => {
    const status = {
      schemaVersion: 1,
      agentId: 'agent_cli_test',
      mode: 'autonomous',
      claimed: false,
      organizationScoped: true,
    }

    const result = await runStatusCli(200, { ...status, credentialName: '\u001b[2J' }, '--json')

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual(status)
    expect(result.stderr).toBe('')
  })

  test('prints terminal-safe human status and an unclaimed next action', async () => {
    const result = await runStatusCli(200, {
      schemaVersion: 1,
      agentId: '\u001b[2Jmalicious',
      mode: 'autonomous',
      claimed: false,
      organizationScoped: false,
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Mode: autonomous')
    expect(result.stdout).toContain('Claimed: no')
    expect(result.stdout).toContain('pascal agent claim')
    expect(result.stdout).not.toContain('\u001b')
    expect(result.stderr).toBe('')
  })

  test.each([
    [401, 'agent_status_unauthorized'],
    [403, 'agent_status_forbidden'],
  ])('preserves the hosted status HTTP %i error contract', async (status, errorCode) => {
    const result = await runStatusCli(status, '<html>untrusted error</html>', '--json')

    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stderr)).toMatchObject({
      details: { status },
      error: errorCode,
    })
    expect(result.stdout).toBe('')
  })

  test('rejects unknown agent account commands', async () => {
    const result = await runCli('agent', 'login', '--json')

    expect(result.exitCode).toBe(2)
    expect(JSON.parse(result.stderr)).toMatchObject({ error: 'unknown_command' })
  })

  test('shows focused help for hosted architect runs', async () => {
    const result = await runCli('architect', '--help')

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('pascal architect run "<brief>"')
    expect(result.stdout).toContain('--effort low|medium|high|pro')
    expect(result.stdout).not.toContain('pascal plugin list')
  })

  test('rejects an unknown architect effort before contacting Pascal', async () => {
    const result = await runCli('architect', 'run', 'A cabin', '--effort', 'max', '--json')

    expect(result.exitCode).toBe(2)
    expect(JSON.parse(result.stderr)).toMatchObject({ error: 'invalid_option' })
  })

  test('detaches a background run and prints the stable JSON run contract', async () => {
    const result = await runArchitectCli(
      {
        method: 'POST',
        url: 'https://editor.pascal.app/api/v1/responses',
        body: {
          model: 'architect-pro',
          input: 'A courtyard house',
          background: true,
          store: true,
          stream: false,
          metadata: { project_id: 'proj_cli', pascal_max_credits: '25' },
        },
      },
      200,
      {
        id: 'resp_cli',
        status: 'queued',
        model: 'architect-pro',
        metadata: { project_id: 'proj_cli', pascal_max_credits: '25' },
      },
      ['run', 'A', 'courtyard house', '--effort', 'pro', '--project', 'proj_cli'],
      ['--max-credits', '25', '--detach', '--json'],
    )

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      schemaVersion: 1,
      id: 'resp_cli',
      status: 'queued',
      model: 'architect-pro',
      projectId: 'proj_cli',
      maxCredits: 25,
      createdAt: null,
      outputText: null,
      error: null,
    })
    expect(result.stderr).toBe('')
  })

  test('streams architect output to stdout and progress to stderr', async () => {
    const queued = { id: 'resp_cli', status: 'queued', model: 'architect' }
    const events = [
      { type: 'response.created', response: queued },
      { type: 'response.output_text.delta', delta: 'Placed four walls.' },
      { type: 'response.completed', response: { ...queued, status: 'completed' } },
    ]
    const result = await runArchitectCli(
      {
        method: 'POST',
        url: 'https://editor.pascal.app/api/v1/responses',
        body: { model: 'architect', input: 'A shed', background: true, store: true, stream: true },
      },
      200,
      events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''),
      ['run', 'A shed'],
      [],
      'text/event-stream',
    )

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('Placed four walls.\n')
    expect(result.stderr).toContain('Architect run resp_cli started on architect.')
    expect(result.stderr).toContain('Status: completed')
  })

  test('reports a missing executor as a retryable error', async () => {
    const result = await runArchitectCli(
      {
        method: 'POST',
        url: 'https://editor.pascal.app/api/v1/responses',
        body: {
          model: 'architect',
          input: 'A shed',
          background: true,
          store: true,
          stream: false,
        },
      },
      503,
      { error: { type: 'server_error', code: 'executor_unavailable', message: 'busy' } },
      ['run', 'A shed', '--detach'],
      ['--json'],
    )

    expect(result.exitCode).toBe(75)
    expect(JSON.parse(result.stderr)).toMatchObject({
      error: 'architect_executor_unavailable',
      details: { status: 503, code: 'executor_unavailable' },
    })
    expect(result.stdout).toBe('')
  })

  test('prints a failed run status with exit code 0 and its bounded error', async () => {
    const result = await runArchitectCli(
      { method: 'GET', url: 'https://editor.pascal.app/api/v1/responses/resp_cli', body: null },
      200,
      {
        id: 'resp_cli',
        status: 'failed',
        model: 'architect',
        error: { code: 'credit_limit_reached', message: 'Stopped at\u001b[2J the limit.' },
      },
      ['status', 'resp_cli'],
    )

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Status: failed')
    expect(result.stdout).toContain('Error: credit_limit_reached: Stopped at[2J the limit.')
    expect(result.stdout).not.toContain('\u001b')
  })

  test('maps a revoked credential on cancel to the auth error contract', async () => {
    const result = await runArchitectCli(
      {
        method: 'POST',
        url: 'https://editor.pascal.app/api/v1/responses/resp_cli/cancel',
        body: null,
      },
      401,
      '<html>untrusted</html>',
      ['cancel', 'resp_cli'],
      ['--json'],
    )

    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stderr)).toMatchObject({
      error: 'architect_unauthorized',
      details: { status: 401 },
    })
  })

  test('rejects a partially numeric port', async () => {
    const result = await runCli('editor', '--port', '3000junk', '--no-open', '--json')

    expect(result.exitCode).toBe(2)
    expect(JSON.parse(result.stderr)).toMatchObject({ error: 'invalid_option' })
  })

  test('rejects a non-numeric log line count', async () => {
    const result = await runCli('logs', '--lines', 'many')

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('--lines must be an integer')
  })

  test('rejects non-registry update sources before invoking npm', async () => {
    const result = await runCli('update', '--version', 'file:/tmp/untrusted', '--json')

    expect(result.exitCode).toBe(2)
    expect(JSON.parse(result.stderr)).toMatchObject({ error: 'invalid_version' })
  })

  test('reports unknown options as command errors', async () => {
    const result = await runCli('project', 'list', '--unknown', '--json')

    expect(result.exitCode).toBe(2)
    expect(JSON.parse(result.stderr)).toMatchObject({ error: 'invalid_option' })
  })

  test('prints stable local MCP client configuration', async () => {
    const result = await runCli('mcp', 'config', '--json')

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      mcpServers: { pascal: { command: 'pascal', args: ['mcp', 'connect'] } },
    })
  })

  test('rejects unsupported automatic MCP client setup', async () => {
    const result = await runCli('mcp', 'setup', 'cursor', '--json')

    expect(result.exitCode).toBe(2)
    expect(JSON.parse(result.stderr)).toMatchObject({ error: 'invalid_option' })
  })

  test('reports a malformed plugin lock as managed-state corruption', async () => {
    await mkdir(testHome, { recursive: true })
    await writeFile(path.join(testHome, 'pascal.plugins.lock'), '{"schemaVersion":1}')

    const result = await runCli('plugin', 'list', '--json')

    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stderr)).toMatchObject({ error: 'invalid_plugin_state' })
  })
})

async function runCli(...args: string[]) {
  const child = Bun.spawn([process.execPath, executable, ...args], {
    env: {
      ...process.env,
      PASCAL_API_KEY: '',
      PASCAL_HOME: testHome,
      PASCAL_NO_OPEN: '1',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { exitCode, stdout, stderr }
}

async function runClaimCli(status: number, body: unknown, ...args: string[]) {
  const apiKey = 'sk_live_cli-test-key'
  const child = Bun.spawn(
    [process.execPath, '--preload', claimFetchPreload, executable, 'agent', 'claim', ...args],
    {
      env: {
        ...process.env,
        PASCAL_API_KEY: apiKey,
        PASCAL_AGENT_TEST_AUTHORIZATION: `Bearer ${apiKey}`,
        PASCAL_AGENT_TEST_BODY: typeof body === 'string' ? body : JSON.stringify(body),
        PASCAL_AGENT_TEST_ENDPOINT: 'https://editor.pascal.app/api/auth/agent/claim/start',
        PASCAL_AGENT_TEST_METHOD: 'POST',
        PASCAL_AGENT_TEST_STATUS: String(status),
        PASCAL_HOME: testHome,
        PASCAL_NO_OPEN: '1',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { exitCode, stdout, stderr }
}

async function runStatusCli(status: number, body: unknown, ...args: string[]) {
  const apiKey = 'sk_live_cli-status-test-key'
  const child = Bun.spawn(
    [process.execPath, '--preload', claimFetchPreload, executable, 'agent', 'status', ...args],
    {
      env: {
        ...process.env,
        PASCAL_API_KEY: apiKey,
        PASCAL_AGENT_TEST_AUTHORIZATION: `Bearer ${apiKey}`,
        PASCAL_AGENT_TEST_BODY: typeof body === 'string' ? body : JSON.stringify(body),
        PASCAL_AGENT_TEST_ENDPOINT: 'https://editor.pascal.app/api/auth/agent/status',
        PASCAL_AGENT_TEST_METHOD: 'GET',
        PASCAL_AGENT_TEST_STATUS: String(status),
        PASCAL_HOME: testHome,
        PASCAL_NO_OPEN: '1',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { exitCode, stdout, stderr }
}

async function runArchitectCli(
  request: { method: string; url: string; body: unknown },
  status: number,
  body: unknown,
  args: string[],
  extraArgs: string[] = [],
  contentType = 'application/json',
) {
  const child = Bun.spawn(
    [
      process.execPath,
      '--preload',
      architectFetchPreload,
      executable,
      'architect',
      ...args,
      ...extraArgs,
    ],
    {
      env: {
        ...process.env,
        PASCAL_API_KEY: 'sk_live_architect-cli-key',
        PASCAL_ARCHITECT_TEST_BODY: typeof body === 'string' ? body : JSON.stringify(body),
        PASCAL_ARCHITECT_TEST_CONTENT_TYPE: contentType,
        PASCAL_ARCHITECT_TEST_REQUEST: JSON.stringify(request),
        PASCAL_ARCHITECT_TEST_STATUS: String(status),
        PASCAL_HOME: testHome,
        PASCAL_NO_OPEN: '1',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { exitCode, stdout, stderr }
}
