// Hostinger Node.js Web App entry point. The build step copies this file to
// .next/standalone/server.js. It hands off to the server Next generates
// inside the standalone bundle (apps/editor/server.js), which chdirs into
// the app directory and wires PORT/HOSTNAME itself. A CJS shim with dynamic
// import() because apps/editor is ESM ("type": "module").
const path = require('node:path')
const { pathToFileURL } = require('node:url')

import(pathToFileURL(path.join(__dirname, 'apps', 'editor', 'server.js')).href).catch((err) => {
  console.error('Failed to start Next.js standalone server:', err)
  process.exit(1)
})
