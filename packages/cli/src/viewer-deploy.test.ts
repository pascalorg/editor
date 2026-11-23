import { afterAll, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CliError } from './errors.js'
import {
  deployViewer,
  isValidViewerDeployPath,
  scanViewerBuild,
  type ViewerDeployOptions,
} from './viewer-deploy.js'

const root = await mkdtemp(join(tmpdir(), 'pascal-viewer-deploy-'))
const API_KEY = 'sk_live_viewer-test-secret'
const VIEWER_ID = 'viewer_Abc123DEF456ghi7'
const DEPLOYMENT_ID = 'viewerdeploy_Abc123DEF456ghi7'
const SIGNED_URL = 'https://storage.example/upload?signature=private-test-signature'
afterAll(() => rm(root, { recursive: true, force: true }))

async function build(
  files: Record<string, string | Uint8Array> = { 'index.html': '<html>Hello</html>' },
) {
  const directory = await mkdtemp(join(root, 'build-'))
  for (const [path, body] of Object.entries(files)) {
    const absolutePath = join(directory, path)
    await mkdir(join(absolutePath, '..'), { recursive: true })
    await writeFile(absolutePath, body)
  }
  return directory
}

async function captureError(action: () => Promise<unknown>): Promise<CliError> {
  try {
    await action()
  } catch (error) {
    if (error instanceof CliError) return error
    throw error
  }
  throw new Error('Expected a CliError')
}

interface FileManifest {
  path: string
  size: number
  sha256: string
  contentType: string
}
function created(files: FileManifest[]) {
  return {
    deploymentId: DEPLOYMENT_ID,
    expiresIn: 900,
    uploads: files.map((file) => ({
      path: file.path,
      url: `${SIGNED_URL}&path=${file.path}`,
      headers: {
        'Content-Type': file.contentType,
        'Content-Length': String(file.size),
        'x-amz-checksum-sha256': Buffer.from(file.sha256, 'hex').toString('base64'),
        'If-None-Match': '*',
      },
    })),
  }
}
function active(extra: Record<string, unknown> = {}) {
  return Response.json({ deploymentId: DEPLOYMENT_ID, status: 'active', ...extra })
}
async function deploy(directory: string, options: ViewerDeployOptions) {
  return deployViewer(API_KEY, { viewerId: VIEWER_ID, directory }, options)
}
function flow(
  put: (init?: RequestInit) => Response | Promise<Response>,
  finalize = () => active(),
): typeof fetch {
  return async (_url, init) => {
    if (init?.method === 'PUT') return put(init)
    if (init?.body)
      return Response.json(created(JSON.parse(String(init.body)).files), { status: 201 })
    return finalize()
  }
}

describe('viewer build scan', () => {
  test('sorts paths, streams SHA-256 hashes and picks static content types', async () => {
    const directory = await build({
      'z.js': 'javascript',
      'index.html': 'hello',
      'assets/a.bin': new Uint8Array([0, 255, 10]),
    })
    const result = await scanViewerBuild(directory)
    expect(result.files.map((file) => file.path)).toEqual(['assets/a.bin', 'index.html', 'z.js'])
    expect(result.totalBytes).toBe(18)
    expect(result.files[1]).toEqual({
      path: 'index.html',
      absolutePath: join(directory, 'index.html'),
      size: 5,
      sha256: createHash('sha256').update('hello').digest('hex'),
      contentType: 'text/html',
    })
    expect(result.files[0]?.contentType).toBe('application/octet-stream')
  })

  test('skips hidden entries once and keeps only the top-level .well-known directory', async () => {
    const directory = await build({
      'index.html': '',
      '.DS_Store': 'metadata',
      '.vite/a.json': '{}',
      '.well-known/asset.txt': 'ok',
      '.well-known/.hidden': '',
      'assets/.cache/x.js': '',
    })
    const result = await scanViewerBuild(directory)
    expect(result.skipped).toEqual(['.DS_Store', '.vite/', '.well-known/.hidden', 'assets/.cache/'])
    expect(result.files.map((file) => file.path)).toEqual(['.well-known/asset.txt', 'index.html'])
  })

  test.each(['file', 'directory', 'root'])('refuses a %s symlink', async (kind) => {
    const directory = await build()
    const link = kind === 'root' ? join(root, 'root-link') : join(directory, 'linked')
    await symlink(kind === 'file' ? join(directory, 'index.html') : directory, link)
    const error = await captureError(() => scanViewerBuild(kind === 'root' ? link : directory))
    expect(error.code).toBe('viewer_invalid_build')
    expect(error.message).toContain('Symlink refused')
    if (kind !== 'root') expect(error.message).toContain('linked')
  })

  test('skips hidden symlinks without following their targets', async () => {
    const directory = await build()
    await symlink(join(directory, 'missing-target'), join(directory, '.cache'))
    await symlink(directory, join(directory, '.well-known'))
    const result = await scanViewerBuild(directory)
    expect(result.skipped).toEqual(['.cache', '.well-known'])
    expect(result.files.map((file) => file.path)).toEqual(['index.html'])
  })

  test('strips control characters from skipped names', async () => {
    const directory = await build({
      'index.html': '',
      '.hidden\u001b[2J.txt': '',
      '.cache\nname/file.js': '',
    })
    expect((await scanViewerBuild(directory)).skipped).toEqual(['.cachename/', '.hidden[2J.txt'])
  })

  test.skipIf(process.getuid?.() === 0 || process.platform === 'win32')(
    'names unreadable files and nested directories with the permission cause',
    async () => {
      const directory = await build({ 'index.html': '', 'assets/secret.js': 'secret' })
      const file = join(directory, 'assets/secret.js')
      const assets = join(directory, 'assets')
      try {
        await chmod(file, 0)
        const fileError = await captureError(() => scanViewerBuild(directory))
        expect(fileError.code).toBe('viewer_read_failed')
        expect(fileError.message).toBe('Cannot read assets/secret.js (permission denied).')
        await chmod(file, 0o600)
        await chmod(assets, 0)
        expect((await captureError(() => scanViewerBuild(directory))).message).toBe(
          'Cannot read assets (permission denied).',
        )
      } finally {
        await chmod(assets, 0o700)
        await chmod(file, 0o600)
      }
    },
  )

  test('refuses non-regular files', async () => {
    const directory = await build()
    execFileSync('mkfifo', [join(directory, 'pipe.txt')])
    expect((await captureError(() => scanViewerBuild(directory))).message).toContain(
      'Non-regular file refused: pipe.txt',
    )
  })

  test('reports multiple bad extensions and paths, capped at ten with a docs link', async () => {
    const files: Record<string, string> = { 'index.html': '', 'bad path.js': '', 'bad%.js': '' }
    for (let i = 0; i < 11; i++) files[`file${i}.exe`] = ''
    const error = await captureError(async () => scanViewerBuild(await build(files)))
    expect(error.message).toContain('bad path.js, bad%.js')
    expect(error.message).toContain('and 3 more')
    expect(error.message).toContain('https://editor.pascal.app/docs/developers/api')
    expect(error.message).not.toContain('file9.exe')
  })

  test.each([
    '',
    '/a.js',
    'a//b.js',
    '../x.js',
    'a/./x.js',
    'a\\x.js',
    'a%.js',
    'a?.js',
    'a#.js',
    'a:.js',
    'a b.js',
    'é.js',
    '.hidden/a.js',
    'a/.well-known/x.js',
    '.well-known',
    'a'.repeat(513),
  ])('rejects noncanonical path %j', (path) => {
    expect(isValidViewerDeployPath(path)).toBe(false)
  })
  test.each(['index.html', 'assets/foo.js', '.well-known/file.txt'])(
    'accepts canonical path %s',
    (path) => {
      expect(isValidViewerDeployPath(path)).toBe(true)
    },
  )

  test('requires root index.html and a readable directory', async () => {
    expect(
      (await captureError(async () => scanViewerBuild(await build({ 'nested/index.html': '' }))))
        .message,
    ).toContain('Pass the build output directory')
    expect((await captureError(() => scanViewerBuild(join(root, 'missing')))).message).toContain(
      'exists',
    )
    const directory = await build()
    expect(
      (await captureError(() => scanViewerBuild(join(directory, 'index.html')))).message,
    ).toContain('must be a directory')
  })
  test.each([
    [{ maxFiles: 1 }, '2-file', 'file limit'],
    [{ maxTotalBytes: 4 }, 'total', 'total-size limit'],
    [{ maxFileBytes: 3 }, 'per-file', 'per-file limit'],
  ] as const)('enforces injected limits %j', async (limits, _label, message) => {
    const directory = await build({ 'index.html': '1234', 'x.js': 'x' })
    expect((await captureError(() => scanViewerBuild(directory, limits))).message).toContain(
      message,
    )
  })
})

describe('viewer deployment', () => {
  test('creates, uploads exact bytes with only returned headers, then activates', async () => {
    const contents = {
      'index.html': '<html>Hello</html>',
      'assets/a.bin': new Uint8Array([0, 255, 10]),
    }
    const directory = await build(contents)
    const calls: string[] = []
    const phases: string[] = []
    let uploads: ReturnType<typeof created>['uploads'] = []
    const result = await deploy(directory, {
      onProgress: (progress) =>
        phases.push(`${progress.phase}:${progress.uploaded}/${progress.total}`),
      fetch: async (url, init) => {
        expect(init?.redirect).toBe('error')
        expect(init?.signal).toBeInstanceOf(AbortSignal)
        calls.push(`${init?.method} ${String(url)}`)
        if (init?.method === 'PUT') {
          const upload = uploads.find((value) => value.url === String(url))!
          expect(init.headers).toEqual(upload.headers)
          expect(new Headers(init.headers).has('authorization')).toBe(false)
          expect(init.credentials).toBe('omit')
          expect(Buffer.from(init.body as Uint8Array)).toEqual(
            Buffer.from(contents[upload.path as keyof typeof contents]),
          )
          return new Response(null, { status: 200 })
        }
        expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${API_KEY}`)
        if (init?.body) {
          const manifest = JSON.parse(String(init.body))
          expect(
            manifest.files.every((file: Record<string, unknown>) => !('absolutePath' in file)),
          ).toBe(true)
          uploads = created(manifest.files).uploads
          return Response.json(
            { deploymentId: DEPLOYMENT_ID, expiresIn: 900, uploads },
            { status: 201 },
          )
        }
        expect(init?.body).toBeUndefined()
        return active({ url: 'https://demo.pascal-viewer.app/' })
      },
    })
    expect(calls[0]).toBe(`POST https://editor.pascal.app/api/viewers/${VIEWER_ID}/deployments`)
    expect(calls.slice(1, -1).every((call) => call.startsWith('PUT '))).toBe(true)
    expect(calls.at(-1)).toEndWith(`/${DEPLOYMENT_ID}/finalize`)
    expect(phases).toEqual([
      'checking:0/0',
      'checking:0/2',
      'uploading:0/2',
      'uploading:1/2',
      'uploading:2/2',
      'activating:2/2',
    ])
    expect(result).toEqual({
      schemaVersion: 1,
      viewerId: VIEWER_ID,
      deploymentId: DEPLOYMENT_ID,
      status: 'active',
      fileCount: 2,
      totalBytes: 21,
      skipped: [],
      url: 'https://demo.pascal-viewer.app/',
    })
  })

  test.each([undefined, 'http://example.com/', 'javascript:alert(1)', 'not a URL'])(
    'ignores an absent or invalid live URL %j',
    async (url) => {
      expect(
        (
          await deploy(await build(), {
            fetch: flow(
              () => new Response(),
              () => active({ url }),
            ),
          })
        ).url,
      ).toBeNull()
    },
  )

  test.each(['../admin', '', 'other_abc', 'viewer_a/b'])(
    'rejects viewer ID %j before fetching',
    async (viewerId) => {
      let called = false
      const error = await captureError(() =>
        deployViewer(
          API_KEY,
          { viewerId, directory: root },
          {
            fetch: async () => {
              called = true
              return active()
            },
          },
        ),
      )
      expect(error.code).toBe('invalid_option')
      expect(called).toBe(false)
    },
  )

  test('requires a key able to manage the workspace', async () => {
    const error = await captureError(() =>
      deployViewer(undefined, { viewerId: VIEWER_ID, directory: root }),
    )
    expect(error.code).toBe('agent_api_key_missing')
    expect(error.message).toBe(
      "Set PASCAL_API_KEY to an API key that can manage the viewer's workspace and try again.",
    )
  })

  test.each([
    'missing',
    'extra',
    'duplicate',
    'http',
    'id',
    'headers',
    'credential headers',
    'expires',
    'status',
  ])('rejects malformed create response: %s', async (kind) => {
    const directory = await build({ 'index.html': '', 'x.js': '' })
    let puts = 0
    const error = await captureError(() =>
      deploy(directory, {
        fetch: async (_url, init) => {
          if (init?.method === 'PUT') {
            puts++
            return new Response()
          }
          const response = created(JSON.parse(String(init?.body)).files)
          if (kind === 'missing') response.uploads.pop()
          if (kind === 'extra') response.uploads[0]!.path = 'extra.js'
          if (kind === 'duplicate') response.uploads[1] = response.uploads[0]!
          if (kind === 'http') response.uploads[0]!.url = 'http://evil.example/?secret=abc'
          if (kind === 'id') response.deploymentId = '../admin'
          if (kind === 'headers') response.uploads[0]!.headers = { invalid: 42 } as never
          if (kind === 'credential headers')
            response.uploads[0]!.headers = { Authorization: API_KEY } as never
          if (kind === 'expires') response.expiresIn = 0
          return Response.json(response, { status: kind === 'status' ? 200 : 201 })
        },
      }),
    )
    expect(error.code).toBe('viewer_invalid_response')
    expect(puts).toBe(0)
    expect(error.message).not.toContain('secret')
    expect(error.message).not.toContain(API_KEY)
  })

  test('reports checking before attempting the scan', async () => {
    const phases: string[] = []
    await captureError(() =>
      deploy(join(root, 'missing'), { onProgress: ({ phase }) => phases.push(phase) }),
    )
    expect(phases).toEqual(['checking'])
  })

  test('uses a separate upload deadline and does not retry it', async () => {
    let attempts = 0
    const error = await captureError(async () =>
      deploy(await build(), {
        timeoutMs: 1,
        uploadTimeoutMs: 30,
        fetch: flow(async (init) => {
          attempts++
          await new Promise((resolve) => setTimeout(resolve, 10))
          expect(init?.signal?.aborted).toBe(false)
          return new Response(new ReadableStream())
        }),
      }),
    )
    expect(attempts).toBe(1)
    expect(error.code).toBe('viewer_upload_timeout')
    expect(error.message).toContain('index.html')
    expect(error.message).toContain('connection may be too slow')
    expect(error.message).toContain('upload window (15 minutes) ran out')
    expect(error.message).toContain('fresh deployment')
  })

  test('caps an in-flight upload by the remaining signed URL window', async () => {
    let attempts = 0
    const error = await captureError(async () =>
      deploy(await build(), {
        uploadWindowMs: 30,
        fetch: flow(() => {
          attempts++
          return new Response(new ReadableStream())
        }),
      }),
    )
    expect(error.code).toBe('viewer_upload_timeout')
    expect(error.message).toContain('index.html')
    expect(attempts).toBe(1)
  })

  test('does not send files when the window expired while reading the create response', async () => {
    let puts = 0
    const error = await captureError(async () =>
      deploy(await build(), {
        uploadWindowMs: 10,
        fetch: async (_url, init) => {
          if (init?.method === 'PUT') {
            puts++
            return new Response()
          }
          const body = JSON.stringify(created(JSON.parse(String(init?.body)).files))
          return new Response(
            new ReadableStream({
              start(controller) {
                setTimeout(() => {
                  controller.enqueue(new TextEncoder().encode(body))
                  controller.close()
                }, 30)
              },
            }),
            { status: 201 },
          )
        },
      }),
    )
    expect(error.code).toBe('viewer_upload_timeout')
    expect(error.message).toContain('index.html')
    expect(puts).toBe(0)
  })

  test('honors the server expiry minus the safety margin without sending an expired upload', async () => {
    let puts = 0
    const error = await captureError(async () =>
      deploy(await build(), {
        fetch: async (_url, init) => {
          if (init?.method === 'PUT') {
            puts++
            return new Response()
          }
          return Response.json(
            { ...created(JSON.parse(String(init?.body)).files), expiresIn: 1 },
            { status: 201 },
          )
        },
      }),
    )
    expect(error.code).toBe('viewer_upload_timeout')
    expect(puts).toBe(0)
  })

  test('does not give finalize the short API timeout', async () => {
    for (const finalizeTimeoutMs of [undefined, 100]) {
      const result = await deploy(await build(), {
        timeoutMs: 5,
        finalizeTimeoutMs,
        fetch: async (_url, init) => {
          if (init?.method === 'PUT') return new Response()
          if (init?.body)
            return Response.json(created(JSON.parse(String(init.body)).files), { status: 201 })
          await new Promise((resolve) => setTimeout(resolve, 20))
          expect(init?.signal?.aborted).toBe(false)
          return active()
        },
      })
      expect(result.status).toBe('active')
    }
  })

  test.each([
    ['viewer_unavailable', 'not hosted on Pascal'],
    ['deployment_not_ready', 'not ready for activation'],
    ['uploads_incomplete', 'not finished uploading'],
    ['upload_mismatch', 'do not match the build manifest'],
  ])('explains the 409 reason %s with an actionable next step', async (reason, message) => {
    const error = await captureError(async () =>
      deploy(await build(), {
        fetch: async () => Response.json({ error: reason }, { status: 409 }),
      }),
    )
    expect(error.code).toBe('viewer_conflict')
    expect(error.message).toContain(message)
    expect(error.message).not.toContain(reason)
    expect(error.message).toContain(
      reason === 'viewer_unavailable' ? 'Settings → Viewers (Host on Pascal)' : 'fresh deployment',
    )
  })

  test('explains an unclaimed agent key on 401', async () => {
    const error = await captureError(async () =>
      deploy(await build(), {
        fetch: async () => Response.json({ error: 'unauthorized' }, { status: 401 }),
      }),
    )
    expect(error.message).toContain(
      'invalid, revoked, or an agent key that has not been claimed yet',
    )
    expect(error.message).toContain('pascal agent status')
    expect(error.message).toContain('pascal agent claim')
  })

  test('explains a missing deployment at finalize instead of blaming the viewer ID', async () => {
    const error = await captureError(async () =>
      deploy(await build(), {
        fetch: flow(
          () => new Response(),
          () => Response.json({ error: 'deployment_not_found' }, { status: 404 }),
        ),
      }),
    )
    expect(error.code).toBe('viewer_deployment_not_found')
    expect(error.message).toContain('may have been cleaned up')
    expect(error.message).toContain('fresh deployment')
    expect(error.message).not.toContain('No hosted viewer')
  })

  test.each(['localhost', '127.0.0.1', '[::1]'])(
    'rejects HTTP storage at %s when the API uses HTTPS',
    async (hostname) => {
      let puts = 0
      const error = await captureError(async () =>
        deploy(await build(), {
          fetch: async (_url, init) => {
            if (init?.method === 'PUT') {
              puts++
              return new Response()
            }
            const response = created(JSON.parse(String(init?.body)).files)
            response.uploads[0]!.url = `http://${hostname}:1234/upload`
            return Response.json(response, { status: 201 })
          },
        }),
      )
      expect(error.code).toBe('viewer_invalid_response')
      expect(puts).toBe(0)
    },
  )

  test.skipIf(process.getuid?.() === 0 || process.platform === 'win32')(
    'reports an upload read permission error without calling the file changed',
    async () => {
      const directory = await build()
      const file = join(directory, 'index.html')
      let puts = 0
      try {
        const error = await captureError(() =>
          deploy(directory, {
            fetch: async (_url, init) => {
              if (init?.method === 'PUT') {
                puts++
                return new Response()
              }
              await chmod(file, 0)
              return Response.json(created(JSON.parse(String(init?.body)).files), { status: 201 })
            },
          }),
        )
        expect(error.code).toBe('viewer_read_failed')
        expect(error.message).toBe('Cannot read index.html (permission denied).')
        expect(puts).toBe(0)
      } finally {
        await chmod(file, 0o600)
      }
    },
  )

  test.each([408, 429, 500, 'network'] as const)(
    'retries upload %s then accepts 412 from the earlier attempt',
    async (status) => {
      let attempts = 0
      const result = await deploy(await build(), {
        fetch: flow(() => {
          if (++attempts === 1) {
            if (status === 'network') throw new Error(`${SIGNED_URL} ${API_KEY}`)
            return new Response(null, { status })
          }
          return new Response(null, { status: 412 })
        }),
      })
      expect(result.status).toBe('active')
      expect(attempts).toBe(2)
    },
  )

  test('caps upload attempts at three', async () => {
    let attempts = 0
    const error = await captureError(async () =>
      deploy(await build(), {
        fetch: flow(() => {
          attempts++
          return new Response(null, { status: 503 })
        }),
      }),
    )
    expect(attempts).toBe(3)
    expect(error.code).toBe('viewer_upload_failed')
  })
  test.each([412, 403])(
    'requires a fresh deployment on first-attempt upload %i',
    async (status) => {
      let attempts = 0
      const error = await captureError(async () =>
        deploy(await build(), {
          fetch: flow(() => {
            attempts++
            return new Response(null, { status })
          }),
        }),
      )
      expect(attempts).toBe(1)
      expect(error.code).toBe('viewer_upload_expired')
      expect(error.message).toContain('Rerun the command')
      expect(error.message).toContain('index.html')
    },
  )

  test.each(['different size', 'same size', 'symlink', 'missing'])(
    'detects a file changed after scanning: %s',
    async (kind) => {
      const directory = await build({ 'index.html': 'hello' })
      let puts = 0
      const error = await captureError(() =>
        deploy(directory, {
          fetch: async (_url, init) => {
            if (init?.method === 'PUT') {
              puts++
              return new Response()
            }
            if (kind === 'missing') await rm(join(directory, 'index.html'))
            else if (kind === 'symlink') {
              await rm(join(directory, 'index.html'))
              await symlink(join(directory, 'missing'), join(directory, 'index.html'))
            } else
              await writeFile(
                join(directory, 'index.html'),
                kind === 'same size' ? 'world' : 'grown file',
              )
            return Response.json(created(JSON.parse(String(init?.body)).files), { status: 201 })
          },
        }),
      )
      expect(error.message).toContain('index.html changed during the deploy; rebuild and rerun')
      expect(puts).toBe(0)
    },
  )

  test('limits uploads to eight and stops scheduling after a hard failure', async () => {
    const files: Record<string, string> = { 'index.html': '' }
    for (let i = 0; i < 20; i++) files[`asset${i}.js`] = ''
    let inFlight = 0
    let peak = 0
    let count = 0
    let finalize = false
    const error = await captureError(async () =>
      deploy(await build(files), {
        fetch: flow(
          async () => {
            count++
            peak = Math.max(peak, ++inFlight)
            const status = count === 1 ? 403 : 200
            await new Promise((done) => setTimeout(done, status === 403 ? 1 : 10))
            inFlight--
            return new Response(null, { status })
          },
          () => {
            finalize = true
            return active()
          },
        ),
      }),
    )
    expect(error.code).toBe('viewer_upload_expired')
    expect(peak).toBeLessThanOrEqual(8)
    expect(count).toBe(8)
    expect(finalize).toBe(false)
  })

  test.each([
    [400, 'viewer_invalid_manifest', 1],
    [401, 'viewer_unauthorized', 1],
    [403, 'viewer_forbidden', 1],
    [404, 'viewer_not_found', 1],
    [409, 'viewer_conflict', 1],
    [413, 'viewer_body_too_large', 1],
    [429, 'viewer_rate_limited', 75],
    [502, 'viewer_unavailable', 75],
    [503, 'viewer_unavailable', 75],
    [504, 'viewer_unavailable', 75],
    [500, 'viewer_failed', 1],
  ])('maps API HTTP %i', async (status, code, exitCode) => {
    const error = await captureError(async () =>
      deploy(await build(), {
        fetch: async () =>
          Response.json(
            { error: 'upload_mismatch' },
            { status, headers: { 'Retry-After': '3600' } },
          ),
      }),
    )
    expect(error.code).toBe(code)
    expect(error.exitCode).toBe(exitCode)
    expect(error.details).toEqual({ status })
    if (status === 400) expect(error.message).toContain('upload_mismatch')
    if (status === 409) expect(error.message).toContain('uploaded files do not match')
    if (status === 429) expect(error.message).toContain('3600 seconds')
    if (status === 404) expect(error.message).toContain('Settings → Viewers')
  })

  test.each([502, 503, 504, 'network'] as const)('retries finalize once on %s', async (status) => {
    let attempts = 0
    const result = await deploy(await build(), {
      fetch: flow(
        () => new Response(),
        () => {
          if (++attempts === 1) {
            if (status === 'network') throw new Error(SIGNED_URL)
            return Response.json({ error: 'storage_unavailable' }, { status })
          }
          return active()
        },
      ),
    })
    expect(result.status).toBe('active')
    expect(attempts).toBe(2)
  })
  test('does not retry finalize state conflicts and caps temporary retries', async () => {
    for (const status of [409, 503]) {
      let attempts = 0
      await captureError(async () =>
        deploy(await build(), {
          fetch: flow(
            () => new Response(),
            () => {
              attempts++
              return Response.json({ error: 'deployment_not_ready' }, { status })
            },
          ),
        }),
      )
      expect(attempts).toBe(status === 409 ? 1 : 2)
    }
  })

  test.each([
    'http://example.com',
    'ftp://localhost',
    'https://user:pass@example.com',
    'https://example.com/api',
  ])('rejects unsafe API origin %s', async (apiOrigin) => {
    expect((await captureError(async () => deploy(await build(), { apiOrigin }))).code).toBe(
      'invalid_option',
    )
  })
  test.each(['localhost', '127.0.0.1', '[::1]'])(
    'allows loopback http for API and storage: %s',
    async (hostname) => {
      const origin = `http://${hostname}:1234`
      const result = await deploy(await build(), {
        apiOrigin: origin,
        fetch: async (url, init) => {
          expect(String(url)).toStartWith(origin)
          if (init?.method === 'PUT') return new Response()
          if (!init?.body) return active()
          const response = created(JSON.parse(String(init.body)).files)
          response.uploads[0]!.url = `${origin}/upload`
          return Response.json(response, { status: 201 })
        },
      })
      expect(result.status).toBe('active')
    },
  )

  test('sanitizes, bounds and redacts server reasons and network failures', async () => {
    for (const status of [400, 409]) {
      const error = await captureError(async () =>
        deploy(await build(), {
          fetch: async () =>
            Response.json(
              { error: `bad\u001b[2J ${API_KEY} ${SIGNED_URL} ${'x'.repeat(1000)}` },
              { status },
            ),
        }),
      )
      expect(error.message).not.toContain(API_KEY)
      expect(error.message).not.toContain('private-test-signature')
      expect(error.message).not.toContain('https://storage')
      expect(error.message).not.toContain('\u001b')
      expect(error.message.length).toBeLessThan(600)
    }
    const error = await captureError(async () =>
      deploy(await build(), {
        fetch: async () => {
          throw new Error(`${API_KEY} ${SIGNED_URL}`)
        },
      }),
    )
    expect(error.code).toBe('viewer_unreachable')
    expect(`${error.message} ${JSON.stringify(error)}`).not.toContain(API_KEY)
    expect(error.message).not.toContain('signature')
  })

  test('rejects oversized and malformed responses without echoing their bodies', async () => {
    for (const response of [
      new Response('{bad json'),
      new Response('secret', { headers: { 'Content-Length': String(9 * 1024 * 1024) } }),
      new Response('x'.repeat(8 * 1024 * 1024 + 1)),
    ]) {
      const error = await captureError(async () =>
        deploy(await build(), { fetch: async () => response }),
      )
      expect(error.code).toBe('viewer_invalid_response')
      expect(error.message).not.toContain('secret')
    }
  })

  test('times out while reading a stalled response body', async () => {
    const error = await captureError(async () =>
      deploy(await build(), {
        timeoutMs: 5,
        fetch: async () => new Response(new ReadableStream()),
      }),
    )
    expect(error.code).toBe('viewer_timeout')
    expect(error.exitCode).toBe(75)
  })
  test('rejects unexpected finalize status', async () => {
    const error = await captureError(async () =>
      deploy(await build(), {
        fetch: flow(
          () => new Response(),
          () => Response.json({ deploymentId: DEPLOYMENT_ID, status: 'pending' }),
        ),
      }),
    )
    expect(error.code).toBe('viewer_invalid_response')
  })
})
