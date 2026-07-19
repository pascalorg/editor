# @pascal-app/nodes

Built-in node definitions for the Pascal viewer and editor.

## Installation

```bash
npm install @pascal-app/core @pascal-app/viewer @pascal-app/editor @pascal-app/nodes
```

The package declares the remaining React, Next.js, Three.js, and UI libraries it needs as peer
dependencies. Install any peers reported by your package manager.

## Usage

Load `builtinPlugin` once before mounting a Pascal viewer or editor:

```typescript
import { loadPlugin } from '@pascal-app/core'
import { builtinPlugin } from '@pascal-app/nodes'

await loadPlugin(builtinPlugin)
```

The plugin registers the built-in schemas, renderers, geometry builders, tools, and systems. Hosts
can load additional plugins through the same `loadPlugin` API.

See the
[`@pascal-app/viewer` quick start](https://github.com/pascalorg/editor/tree/main/packages/viewer#usage)
for bootstrap ordering in a React application.

## License

MIT
