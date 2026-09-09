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

## Local surface previews

`@pascal-app/capture-viewer/preview` exports `createSurfaceMeshGeometry` and `createClayMatcap`
without importing the React viewer runtime. A host can render a locally saved surface immediately,
before its archive is uploaded. Browser and React Native exports resolve source, so an embedded
DOM bundle does not depend on generated workspace `dist` files.

The geometry decoder uses the shared capture-protocol validator, including the native
20,000-face budget, byte lengths, and index bounds. It returns `null` for invalid input.
The host owns the returned geometry and matcap texture and must dispose them on teardown.

Direct `CaptureStreamLayer` consumers can pass
`meshPresentation={{ previewMaterial: 'clay', dollhouse: true }}`. Clay replaces preliminary
vertex colors; dollhouse enables front-face rendering for surface previews and room models,
revealing inward-facing room surfaces from outside. It changes per-instance materials, not
geometry or loader-cached materials. Omitting these options preserves the existing presentation.
