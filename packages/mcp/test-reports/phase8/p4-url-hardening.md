# Phase 8 P4 — URL Hardening Report

Worktree: `/Users/adrian/Desktop/editor/.worktrees/mcp-server`
Data dir: `/tmp/pascal-phase8-p4`
Total checks: **95** — pass **59**, fail **36**

## Scope
Verify A7's `AssetUrl` validator rejects dangerous URLs at every boundary:
- `AnyNode.safeParse` (core schema)
- `apply_patch` MCP tool (bridge dry-run)
- `save_scene` MCP tool (includeCurrentScene=false path)
- editor `POST /api/scenes` (HTTP envelope)
- `PASCAL_ALLOWED_ASSET_ORIGINS` env narrowing

## Verdict table

| URL | node_field | injected_via | rejected_by | expected | actual | result |
|---|---|---|---|---|---|---|
| `javascript:alert(1)` | ItemNode.asset.src | AnyNode.safeParse | ItemNode + AnyNode | reject | reject | PASS |
| `file:///etc/passwd` | ItemNode.asset.src | AnyNode.safeParse | ItemNode + AnyNode | reject | reject | PASS |
| `http://evil.com/beacon.glb` | ItemNode.asset.src | AnyNode.safeParse | ItemNode + AnyNode | reject | reject | PASS |
| `data:text/html,<script>alert(1)</script>` | ItemNode.asset.src | AnyNode.safeParse | ItemNode + AnyNode | reject | reject | PASS |
| `ftp://a.b.com/file` | ItemNode.asset.src | AnyNode.safeParse | ItemNode + AnyNode | reject | reject | PASS |
| `vbscript:msgbox("x")` | ItemNode.asset.src | AnyNode.safeParse | ItemNode + AnyNode | reject | reject | PASS |
| `asset://12345abcde/model.glb` | ItemNode.asset.src | AnyNode.safeParse | — | accept | accept | PASS |
| `blob:http://localhost/x-y-z` | ItemNode.asset.src | AnyNode.safeParse | — | accept | accept | PASS |
| `data:image/png;base64,iVBOR` | ItemNode.asset.src | AnyNode.safeParse | — | accept | accept | PASS |
| `https://cdn.example.com/model.glb` | ItemNode.asset.src | AnyNode.safeParse | — | accept | accept | PASS |
| `http://localhost:3002/public/a.glb` | ItemNode.asset.src | AnyNode.safeParse | — | accept | accept | PASS |
| `/static/model.glb` | ItemNode.asset.src | AnyNode.safeParse | — | accept | accept | PASS |
| `javascript:alert(1)` | ScanNode.url | AnyNode.safeParse | ScanNode + AnyNode | reject | reject | PASS |
| `file:///etc/passwd` | ScanNode.url | AnyNode.safeParse | ScanNode + AnyNode | reject | reject | PASS |
| `http://evil.com/beacon.glb` | ScanNode.url | AnyNode.safeParse | ScanNode + AnyNode | reject | reject | PASS |
| `data:text/html,<script>alert(1)</script>` | ScanNode.url | AnyNode.safeParse | ScanNode + AnyNode | reject | reject | PASS |
| `ftp://a.b.com/file` | ScanNode.url | AnyNode.safeParse | ScanNode + AnyNode | reject | reject | PASS |
| `vbscript:msgbox("x")` | ScanNode.url | AnyNode.safeParse | ScanNode + AnyNode | reject | reject | PASS |
| `asset://12345abcde/model.glb` | ScanNode.url | AnyNode.safeParse | — | accept | accept | PASS |
| `blob:http://localhost/x-y-z` | ScanNode.url | AnyNode.safeParse | — | accept | accept | PASS |
| `data:image/png;base64,iVBOR` | ScanNode.url | AnyNode.safeParse | — | accept | accept | PASS |
| `https://cdn.example.com/model.glb` | ScanNode.url | AnyNode.safeParse | — | accept | accept | PASS |
| `http://localhost:3002/public/a.glb` | ScanNode.url | AnyNode.safeParse | — | accept | accept | PASS |
| `/static/model.glb` | ScanNode.url | AnyNode.safeParse | — | accept | accept | PASS |
| `javascript:alert(1)` | GuideNode.url | AnyNode.safeParse | GuideNode + AnyNode | reject | reject | PASS |
| `file:///etc/passwd` | GuideNode.url | AnyNode.safeParse | GuideNode + AnyNode | reject | reject | PASS |
| `http://evil.com/beacon.glb` | GuideNode.url | AnyNode.safeParse | GuideNode + AnyNode | reject | reject | PASS |
| `data:text/html,<script>alert(1)</script>` | GuideNode.url | AnyNode.safeParse | GuideNode + AnyNode | reject | reject | PASS |
| `ftp://a.b.com/file` | GuideNode.url | AnyNode.safeParse | GuideNode + AnyNode | reject | reject | PASS |
| `vbscript:msgbox("x")` | GuideNode.url | AnyNode.safeParse | GuideNode + AnyNode | reject | reject | PASS |
| `asset://12345abcde/model.glb` | GuideNode.url | AnyNode.safeParse | — | accept | accept | PASS |
| `blob:http://localhost/x-y-z` | GuideNode.url | AnyNode.safeParse | — | accept | accept | PASS |
| `data:image/png;base64,iVBOR` | GuideNode.url | AnyNode.safeParse | — | accept | accept | PASS |
| `https://cdn.example.com/model.glb` | GuideNode.url | AnyNode.safeParse | — | accept | accept | PASS |
| `http://localhost:3002/public/a.glb` | GuideNode.url | AnyNode.safeParse | — | accept | accept | PASS |
| `/static/model.glb` | GuideNode.url | AnyNode.safeParse | — | accept | accept | PASS |
| `javascript:alert(1)` | ItemNode.asset.src | apply_patch | apply_patch (AssetUrl) | reject | reject | PASS |
| `file:///etc/passwd` | ItemNode.asset.src | apply_patch | apply_patch (AssetUrl) | reject | reject | PASS |
| `http://evil.com/beacon.glb` | ItemNode.asset.src | apply_patch | apply_patch (AssetUrl) | reject | reject | PASS |
| `data:text/html,<script>alert(1)</script>` | ItemNode.asset.src | apply_patch | apply_patch (AssetUrl) | reject | reject | PASS |
| `ftp://a.b.com/file` | ItemNode.asset.src | apply_patch | apply_patch (AssetUrl) | reject | reject | PASS |
| `vbscript:msgbox("x")` | ItemNode.asset.src | apply_patch | apply_patch (AssetUrl) | reject | reject | PASS |
| `javascript:alert(1)` | ScanNode.url | apply_patch | apply_patch (AssetUrl) | reject | reject | PASS |
| `file:///etc/passwd` | ScanNode.url | apply_patch | apply_patch (AssetUrl) | reject | reject | PASS |
| `http://evil.com/beacon.glb` | ScanNode.url | apply_patch | apply_patch (AssetUrl) | reject | reject | PASS |
| `data:text/html,<script>alert(1)</script>` | ScanNode.url | apply_patch | apply_patch (AssetUrl) | reject | reject | PASS |
| `ftp://a.b.com/file` | ScanNode.url | apply_patch | apply_patch (AssetUrl) | reject | reject | PASS |
| `vbscript:msgbox("x")` | ScanNode.url | apply_patch | apply_patch (AssetUrl) | reject | reject | PASS |
| `javascript:alert(1)` | GuideNode.url | apply_patch | apply_patch (AssetUrl) | reject | reject | PASS |
| `file:///etc/passwd` | GuideNode.url | apply_patch | apply_patch (AssetUrl) | reject | reject | PASS |
| `http://evil.com/beacon.glb` | GuideNode.url | apply_patch | apply_patch (AssetUrl) | reject | reject | PASS |
| `data:text/html,<script>alert(1)</script>` | GuideNode.url | apply_patch | apply_patch (AssetUrl) | reject | reject | PASS |
| `ftp://a.b.com/file` | GuideNode.url | apply_patch | apply_patch (AssetUrl) | reject | reject | PASS |
| `vbscript:msgbox("x")` | GuideNode.url | apply_patch | apply_patch (AssetUrl) | reject | reject | PASS |
| `javascript:alert(1)` | ItemNode.asset.src | save_scene | NONE | reject | accept | FAIL |
| `file:///etc/passwd` | ItemNode.asset.src | save_scene | NONE | reject | accept | FAIL |
| `http://evil.com/beacon.glb` | ItemNode.asset.src | save_scene | NONE | reject | accept | FAIL |
| `data:text/html,<script>alert(1)</script>` | ItemNode.asset.src | save_scene | NONE | reject | accept | FAIL |
| `ftp://a.b.com/file` | ItemNode.asset.src | save_scene | NONE | reject | accept | FAIL |
| `vbscript:msgbox("x")` | ItemNode.asset.src | save_scene | NONE | reject | accept | FAIL |
| `javascript:alert(1)` | ScanNode.url | save_scene | NONE | reject | accept | FAIL |
| `file:///etc/passwd` | ScanNode.url | save_scene | NONE | reject | accept | FAIL |
| `http://evil.com/beacon.glb` | ScanNode.url | save_scene | NONE | reject | accept | FAIL |
| `data:text/html,<script>alert(1)</script>` | ScanNode.url | save_scene | NONE | reject | accept | FAIL |
| `ftp://a.b.com/file` | ScanNode.url | save_scene | NONE | reject | accept | FAIL |
| `vbscript:msgbox("x")` | ScanNode.url | save_scene | NONE | reject | accept | FAIL |
| `javascript:alert(1)` | GuideNode.url | save_scene | NONE | reject | accept | FAIL |
| `file:///etc/passwd` | GuideNode.url | save_scene | NONE | reject | accept | FAIL |
| `http://evil.com/beacon.glb` | GuideNode.url | save_scene | NONE | reject | accept | FAIL |
| `data:text/html,<script>alert(1)</script>` | GuideNode.url | save_scene | NONE | reject | accept | FAIL |
| `ftp://a.b.com/file` | GuideNode.url | save_scene | NONE | reject | accept | FAIL |
| `vbscript:msgbox("x")` | GuideNode.url | save_scene | NONE | reject | accept | FAIL |
| `javascript:alert(1)` | ItemNode | editor POST /api/scenes | NONE | reject | accept | FAIL |
| `file:///etc/passwd` | ItemNode | editor POST /api/scenes | NONE | reject | accept | FAIL |
| `http://evil.com/beacon.glb` | ItemNode | editor POST /api/scenes | NONE | reject | accept | FAIL |
| `data:text/html,<script>alert(1)</script>` | ItemNode | editor POST /api/scenes | NONE | reject | accept | FAIL |
| `ftp://a.b.com/file` | ItemNode | editor POST /api/scenes | NONE | reject | accept | FAIL |
| `vbscript:msgbox("x")` | ItemNode | editor POST /api/scenes | NONE | reject | accept | FAIL |
| `javascript:alert(1)` | ScanNode | editor POST /api/scenes | NONE | reject | accept | FAIL |
| `file:///etc/passwd` | ScanNode | editor POST /api/scenes | NONE | reject | accept | FAIL |
| `http://evil.com/beacon.glb` | ScanNode | editor POST /api/scenes | NONE | reject | accept | FAIL |
| `data:text/html,<script>alert(1)</script>` | ScanNode | editor POST /api/scenes | NONE | reject | accept | FAIL |
| `ftp://a.b.com/file` | ScanNode | editor POST /api/scenes | NONE | reject | accept | FAIL |
| `vbscript:msgbox("x")` | ScanNode | editor POST /api/scenes | NONE | reject | accept | FAIL |
| `javascript:alert(1)` | GuideNode | editor POST /api/scenes | NONE | reject | accept | FAIL |
| `file:///etc/passwd` | GuideNode | editor POST /api/scenes | NONE | reject | accept | FAIL |
| `http://evil.com/beacon.glb` | GuideNode | editor POST /api/scenes | NONE | reject | accept | FAIL |
| `data:text/html,<script>alert(1)</script>` | GuideNode | editor POST /api/scenes | NONE | reject | accept | FAIL |
| `ftp://a.b.com/file` | GuideNode | editor POST /api/scenes | NONE | reject | accept | FAIL |
| `vbscript:msgbox("x")` | GuideNode | editor POST /api/scenes | NONE | reject | accept | FAIL |
| `https://cdn.pascal.app/x.glb` | env allowlist | spawnSync + PASCAL_ALLOWED_ASSET_ORIGINS=https://cdn.pascal.app | — | accept | accept | PASS |
| `https://otherhost.com/x.glb` | env allowlist | spawnSync + PASCAL_ALLOWED_ASSET_ORIGINS=https://cdn.pascal.app | AssetUrl (env) | reject | reject | PASS |
| `https://cdn.pascal.app.evil.com/x` | env allowlist | spawnSync + PASCAL_ALLOWED_ASSET_ORIGINS=https://cdn.pascal.app | AssetUrl (env) | reject | reject | PASS |
| `asset://abc` | env allowlist | spawnSync + PASCAL_ALLOWED_ASSET_ORIGINS=https://cdn.pascal.app | — | accept | accept | PASS |
| `https://cdn.pascal.app/deep/path?q=1` | env allowlist | spawnSync + PASCAL_ALLOWED_ASSET_ORIGINS=https://cdn.pascal.app | — | accept | accept | PASS |

## Summary of findings

- Schema layer (`AssetUrl` → `ItemNode`/`ScanNode`/`GuideNode` → `AnyNode`)
  rejects every bad URL vector (javascript:, file:, foreign http:, data:text/html,
  ftp:, vbscript:) in every slot (asset.src, scan.url, guide.url).
- `apply_patch` forwards the rejection: `SceneBridge.applyPatch` re-parses each
  create node with `AnyNode` before mutating the store, so the bad URL is
  caught before the scene mutates.
- `save_scene` with `includeCurrentScene: false` does NOT re-run
  `AnyNode.safeParse` on the provided graph — it treats the graph as opaque
  and hands it to the storage layer. See next section.
- `PASCAL_ALLOWED_ASSET_ORIGINS=https://cdn.pascal.app` correctly narrows
  `https:` URLs to that origin; other schemes remain accepted.
- Editor `POST /api/scenes` uses `graphSchema = z.unknown().refine(...object)`
  which also does NOT re-validate per-node schema. It relies on the editor UI
  having generated a validated graph.

## Layer that catches bad URLs in `save_scene`

When `includeCurrentScene: false` is used, the only URL-validation layer hit
is the in-memory `AnyNode` pre-parse inside `save_scene`'s `validateScene()`
path — but that branch is ONLY run when `includeCurrentScene=true`. With
`includeCurrentScene: false`, the graph is passed through to
`FilesystemSceneStore.save` which enforces only size + node-envelope checks
(type is a non-empty string, node is an object). This means a malicious
`graph` can bypass `AssetUrl` at the save_scene boundary.

The A7 hardening therefore is fully effective at `apply_patch` and at
`save_scene` with `includeCurrentScene: true` (bridge validate); but when a
caller supplies `graph` directly, URL validation is deferred until the scene
is later loaded into the bridge (`setScene` → editor renderer). The same gap
applies to the editor `POST /api/scenes` endpoint.

## Recommendations

1. `save_scene` should re-parse each node of the incoming `graph` with
   `AnyNode` when `includeCurrentScene === false` before calling
   `store.save`, matching the strictness of `apply_patch`.
2. The editor's `POST /api/scenes` route should apply the same per-node
   validation instead of treating the graph as opaque.
3. `FilesystemSceneStore.save` could optionally validate node shape with
   `AnyNode` as a defence-in-depth layer (size-bounded and acceptably cheap).

## Run log

```
==== Phase 8 P4 URL hardening ====
BIN_PATH=/Users/adrian/Desktop/editor/.worktrees/mcp-server/packages/mcp/dist/bin/pascal-mcp.js
PASCAL_DATA_DIR=/tmp/pascal-phase8-p4

==== Tier 1: AssetUrl / AnyNode.safeParse schema layer ====
  [ItemNode.asset.src] BAD url javascript:alert(1)                                → ItemNode=reject / AnyNode=reject OK
  [ItemNode.asset.src] BAD url file:///etc/passwd                                 → ItemNode=reject / AnyNode=reject OK
  [ItemNode.asset.src] BAD url http://evil.com/beacon.glb                         → ItemNode=reject / AnyNode=reject OK
  [ItemNode.asset.src] BAD url data:text/html,<script>alert(1)</script>           → ItemNode=reject / AnyNode=reject OK
  [ItemNode.asset.src] BAD url ftp://a.b.com/file                                 → ItemNode=reject / AnyNode=reject OK
  [ItemNode.asset.src] BAD url vbscript:msgbox("x")                               → ItemNode=reject / AnyNode=reject OK
  [ItemNode.asset.src] GOOD url asset://12345abcde/model.glb                       → ItemNode=accept / AnyNode=accept OK
  [ItemNode.asset.src] GOOD url blob:http://localhost/x-y-z                        → ItemNode=accept / AnyNode=accept OK
  [ItemNode.asset.src] GOOD url data:image/png;base64,iVBOR                        → ItemNode=accept / AnyNode=accept OK
  [ItemNode.asset.src] GOOD url https://cdn.example.com/model.glb                  → ItemNode=accept / AnyNode=accept OK
  [ItemNode.asset.src] GOOD url http://localhost:3002/public/a.glb                 → ItemNode=accept / AnyNode=accept OK
  [ItemNode.asset.src] GOOD url /static/model.glb                                  → ItemNode=accept / AnyNode=accept OK
  [ScanNode.url] BAD url javascript:alert(1)                                → ScanNode=reject / AnyNode=reject OK
  [ScanNode.url] BAD url file:///etc/passwd                                 → ScanNode=reject / AnyNode=reject OK
  [ScanNode.url] BAD url http://evil.com/beacon.glb                         → ScanNode=reject / AnyNode=reject OK
  [ScanNode.url] BAD url data:text/html,<script>alert(1)</script>           → ScanNode=reject / AnyNode=reject OK
  [ScanNode.url] BAD url ftp://a.b.com/file                                 → ScanNode=reject / AnyNode=reject OK
  [ScanNode.url] BAD url vbscript:msgbox("x")                               → ScanNode=reject / AnyNode=reject OK
  [ScanNode.url] GOOD url asset://12345abcde/model.glb                       → ScanNode=accept / AnyNode=accept OK
  [ScanNode.url] GOOD url blob:http://localhost/x-y-z                        → ScanNode=accept / AnyNode=accept OK
  [ScanNode.url] GOOD url data:image/png;base64,iVBOR                        → ScanNode=accept / AnyNode=accept OK
  [ScanNode.url] GOOD url https://cdn.example.com/model.glb                  → ScanNode=accept / AnyNode=accept OK
  [ScanNode.url] GOOD url http://localhost:3002/public/a.glb                 → ScanNode=accept / AnyNode=accept OK
  [ScanNode.url] GOOD url /static/model.glb                                  → ScanNode=accept / AnyNode=accept OK
  [GuideNode.url] BAD url javascript:alert(1)                                → GuideNode=reject / AnyNode=reject OK
  [GuideNode.url] BAD url file:///etc/passwd                                 → GuideNode=reject / AnyNode=reject OK
  [GuideNode.url] BAD url http://evil.com/beacon.glb                         → GuideNode=reject / AnyNode=reject OK
  [GuideNode.url] BAD url data:text/html,<script>alert(1)</script>           → GuideNode=reject / AnyNode=reject OK
  [GuideNode.url] BAD url ftp://a.b.com/file                                 → GuideNode=reject / AnyNode=reject OK
  [GuideNode.url] BAD url vbscript:msgbox("x")                               → GuideNode=reject / AnyNode=reject OK
  [GuideNode.url] GOOD url asset://12345abcde/model.glb                       → GuideNode=accept / AnyNode=accept OK
  [GuideNode.url] GOOD url blob:http://localhost/x-y-z                        → GuideNode=accept / AnyNode=accept OK
  [GuideNode.url] GOOD url data:image/png;base64,iVBOR                        → GuideNode=accept / AnyNode=accept OK
  [GuideNode.url] GOOD url https://cdn.example.com/model.glb                  → GuideNode=accept / AnyNode=accept OK
  [GuideNode.url] GOOD url http://localhost:3002/public/a.glb                 → GuideNode=accept / AnyNode=accept OK
  [GuideNode.url] GOOD url /static/model.glb                                  → GuideNode=accept / AnyNode=accept OK

==== Tier 2+3: apply_patch + save_scene via stdio MCP ====
  apply_patch create ItemNode.asset.src BAD javascript:alert(1)                                → reject OK
  apply_patch create ItemNode.asset.src BAD file:///etc/passwd                                 → reject OK
  apply_patch create ItemNode.asset.src BAD http://evil.com/beacon.glb                         → reject OK
  apply_patch create ItemNode.asset.src BAD data:text/html,<script>alert(1)</script>           → reject OK
  apply_patch create ItemNode.asset.src BAD ftp://a.b.com/file                                 → reject OK
  apply_patch create ItemNode.asset.src BAD vbscript:msgbox("x")                               → reject OK
  apply_patch create ScanNode.url BAD javascript:alert(1)                                → reject OK
  apply_patch create ScanNode.url BAD file:///etc/passwd                                 → reject OK
  apply_patch create ScanNode.url BAD http://evil.com/beacon.glb                         → reject OK
  apply_patch create ScanNode.url BAD data:text/html,<script>alert(1)</script>           → reject OK
  apply_patch create ScanNode.url BAD ftp://a.b.com/file                                 → reject OK
  apply_patch create ScanNode.url BAD vbscript:msgbox("x")                               → reject OK
  apply_patch create GuideNode.url BAD javascript:alert(1)                                → reject OK
  apply_patch create GuideNode.url BAD file:///etc/passwd                                 → reject OK
  apply_patch create GuideNode.url BAD http://evil.com/beacon.glb                         → reject OK
  apply_patch create GuideNode.url BAD data:text/html,<script>alert(1)</script>           → reject OK
  apply_patch create GuideNode.url BAD ftp://a.b.com/file                                 → reject OK
  apply_patch create GuideNode.url BAD vbscript:msgbox("x")                               → reject OK
  save_scene graph with ItemNode.asset.src BAD javascript:alert(1)                              → accept FAIL
  save_scene graph with ItemNode.asset.src BAD file:///etc/passwd                               → accept FAIL
  save_scene graph with ItemNode.asset.src BAD http://evil.com/beacon.glb                       → accept FAIL
  save_scene graph with ItemNode.asset.src BAD data:text/html,<script>alert(1)</script>         → accept FAIL
  save_scene graph with ItemNode.asset.src BAD ftp://a.b.com/file                               → accept FAIL
  save_scene graph with ItemNode.asset.src BAD vbscript:msgbox("x")                             → accept FAIL
  save_scene graph with ScanNode.url BAD javascript:alert(1)                              → accept FAIL
  save_scene graph with ScanNode.url BAD file:///etc/passwd                               → accept FAIL
  save_scene graph with ScanNode.url BAD http://evil.com/beacon.glb                       → accept FAIL
  save_scene graph with ScanNode.url BAD data:text/html,<script>alert(1)</script>         → accept FAIL
  save_scene graph with ScanNode.url BAD ftp://a.b.com/file                               → accept FAIL
  save_scene graph with ScanNode.url BAD vbscript:msgbox("x")                             → accept FAIL
  save_scene graph with GuideNode.url BAD javascript:alert(1)                              → accept FAIL
  save_scene graph with GuideNode.url BAD file:///etc/passwd                               → accept FAIL
  save_scene graph with GuideNode.url BAD http://evil.com/beacon.glb                       → accept FAIL
  save_scene graph with GuideNode.url BAD data:text/html,<script>alert(1)</script>         → accept FAIL
  save_scene graph with GuideNode.url BAD ftp://a.b.com/file                               → accept FAIL
  save_scene graph with GuideNode.url BAD vbscript:msgbox("x")                             → accept FAIL

==== Tier 4: editor POST /api/scenes ====
  POST /api/scenes ItemNode BAD javascript:alert(1)                              → HTTP 201 ACCEPT (bad!)
  POST /api/scenes ItemNode BAD file:///etc/passwd                               → HTTP 201 ACCEPT (bad!)
  POST /api/scenes ItemNode BAD http://evil.com/beacon.glb                       → HTTP 201 ACCEPT (bad!)
  POST /api/scenes ItemNode BAD data:text/html,<script>alert(1)</script>         → HTTP 201 ACCEPT (bad!)
  POST /api/scenes ItemNode BAD ftp://a.b.com/file                               → HTTP 201 ACCEPT (bad!)
  POST /api/scenes ItemNode BAD vbscript:msgbox("x")                             → HTTP 201 ACCEPT (bad!)
  POST /api/scenes ScanNode BAD javascript:alert(1)                              → HTTP 201 ACCEPT (bad!)
  POST /api/scenes ScanNode BAD file:///etc/passwd                               → HTTP 201 ACCEPT (bad!)
  POST /api/scenes ScanNode BAD http://evil.com/beacon.glb                       → HTTP 201 ACCEPT (bad!)
  POST /api/scenes ScanNode BAD data:text/html,<script>alert(1)</script>         → HTTP 201 ACCEPT (bad!)
  POST /api/scenes ScanNode BAD ftp://a.b.com/file                               → HTTP 201 ACCEPT (bad!)
  POST /api/scenes ScanNode BAD vbscript:msgbox("x")                             → HTTP 201 ACCEPT (bad!)
  POST /api/scenes GuideNode BAD javascript:alert(1)                              → HTTP 201 ACCEPT (bad!)
  POST /api/scenes GuideNode BAD file:///etc/passwd                               → HTTP 201 ACCEPT (bad!)
  POST /api/scenes GuideNode BAD http://evil.com/beacon.glb                       → HTTP 201 ACCEPT (bad!)
  POST /api/scenes GuideNode BAD data:text/html,<script>alert(1)</script>         → HTTP 201 ACCEPT (bad!)
  POST /api/scenes GuideNode BAD ftp://a.b.com/file                               → HTTP 201 ACCEPT (bad!)
  POST /api/scenes GuideNode BAD vbscript:msgbox("x")                             → HTTP 201 ACCEPT (bad!)

==== Tier 5: PASCAL_ALLOWED_ASSET_ORIGINS narrowing ====
  env-narrow https://cdn.pascal.app/x.glb                     expected=accept got=accept OK
  env-narrow https://otherhost.com/x.glb                      expected=reject got=reject OK
  env-narrow https://cdn.pascal.app.evil.com/x                expected=reject got=reject OK
  env-narrow asset://abc                                      expected=accept got=accept OK
  env-narrow https://cdn.pascal.app/deep/path?q=1             expected=accept got=accept OK
```
