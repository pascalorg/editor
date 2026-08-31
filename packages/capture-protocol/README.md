# `@pascal-app/capture-protocol`

Transport-neutral capture-session contracts for Pascal viewers and hosts.

The package contains versioned static manifests, a normalized session descriptor, packet headers
for incremental data, and a `CaptureSource` interface that can be backed by HTTP, WebSocket,
WebRTC, local files, or an in-memory producer. It does not contain authentication, persistence,
React, Three.js, or a canonical network transport.

```ts
import {
  createHttpCaptureSource,
  type CaptureSessionLocator,
} from '@pascal-app/capture-protocol'

const locator: CaptureSessionLocator = {
  sessionId: 'capture_123',
  manifestUrl: '/api/captures/capture_123/manifest',
}

const source = createHttpCaptureSource(locator, { credentials: 'include' })
const descriptor = await source.describe()
```

For live producers, use `PushCaptureSource` directly or implement `CaptureSource.subscribe()` with
the same descriptor and packet event contract.

The package exports its TypeScript source under the `react-native` condition so Metro can consume
the workspace package from a clean checkout. Web and Node consumers continue to use the compiled
ES module output.
