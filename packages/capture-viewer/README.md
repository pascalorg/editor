# `@pascal-app/capture-viewer`

Reference capture layers for `@pascal-app/viewer`.

Mount `CaptureRuntime` as a child of `Viewer` and provide a source resolver. The host owns access
control and transport; the runtime owns source lifecycle, scan-node placement, layer visibility,
and reference renderers for RoomPlan models, device trajectories, and PLY/live point clouds.

```tsx
<Viewer>
  <CaptureRuntime
    onError={(error, context) => reportCaptureError(error, context)}
    resolveSource={(locator) =>
      createHttpCaptureSource(locator, { credentials: 'include' })
    }
    retryKey={retryVersion}
  />
</Viewer>
```

Unknown streams remain in the descriptor and can be rendered by passing a custom renderer keyed by
stream role or kind. A live transport implements `CaptureSource.subscribe()`; no particular
WebSocket, WebRTC, or collaboration backend is required by this package.

`CaptureRuntime` keeps telemetry host-neutral: pass `onError` to report source or per-stream
failures in the host, then increment `retryKey` to reload every affected session. Direct
`useCaptureSource()` consumers can call its `retry()` function instead.

Hosts can pass `defaultLayerVisibility` to keep expensive optional layers disabled until a user
enables them. Persisted values in the scan node's `layers` map always override those host defaults;
without host defaults, every available layer remains visible for backwards compatibility.
Hidden sessions and layers are unmounted rather than only made visually transparent, so they stop
raycasting, artifact work, animation, and live packet subscriptions while disabled.
