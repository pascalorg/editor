# `@pascal-app/capture-viewer`

Reference capture layers for `@pascal-app/viewer`.

Mount `CaptureRuntime` as a child of `Viewer` and provide a source resolver. The host owns access
control and transport; the runtime owns source lifecycle, scan-node placement, layer visibility,
and reference renderers for RoomPlan models, device trajectories, and PLY/live point clouds.

```tsx
<Viewer>
  <CaptureRuntime
    resolveSource={(locator) =>
      createHttpCaptureSource(locator, { credentials: 'include' })
    }
  />
</Viewer>
```

Unknown streams remain in the descriptor and can be rendered by passing a custom renderer keyed by
stream role or kind. A live transport implements `CaptureSource.subscribe()`; no particular
WebSocket, WebRTC, or collaboration backend is required by this package.
