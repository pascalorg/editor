// Hostinger Node.js Web App entry point. The build step copies this file to
// .next/standalone/server.js, next to the standalone bundle's node_modules.
//
// Why not Next's generated server.js:
// - Hostinger may hand PORT over as a Unix socket path instead of a number;
//   the generated server parseInt()s it and silently falls back to 3000.
//   node:http's listen() accepts both, so we pass PORT through untouched.
// - The process cwd on Hostinger is not the app dir, so the generated server
//   cannot resolve .next/ and public/ by relative path. We chdir first.

const path = require('node:path')
const { createServer } = require('node:http')
const { parse } = require('node:url')
const next = require('next')

const appDir = path.join(__dirname, 'apps', 'editor')
process.chdir(appDir)

const app = next({ dev: false, dir: appDir })
const handle = app.getRequestHandler()

app
  .prepare()
  .then(() => {
    const server = createServer((req, res) => {
      handle(req, res, parse(req.url, true))
    })

    const listenTarget = process.env.PORT || 3000
    server.listen(listenTarget, () => {
      console.log(`Pascal Editor listening on ${listenTarget}`)
    })
  })
  .catch((err) => {
    console.error('Failed to start Next.js:', err)
    process.exit(1)
  })
