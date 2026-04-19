# R10 — Ideas, Edges, and Unlocks

*Agent: Research Agent R10*
*Date: 2026-04-18*
*Scope: brainstorm, not specification*

Grounded in the `@pascal-app/mcp` package. MCP today exposes 21 tools, 4 resources, 3 prompts, runs headless in Node, mutates a Zustand (+ Zundo) scene graph, and can round-trip JSON. The editor is Next.js + R3F + WebGPU, persists to IndexedDB, has three Zustand stores (`useScene`, `useViewer`, `useEditor`), and has no user-account backend today beyond a `health` API route. GLB export is stubbed; catalog resolves `asset://` URLs only in the browser. That surface area is the substrate I brainstorm against.

Legend: **S** ≤ 2 dev-days, **M** 1–2 weeks, **L** 3+ weeks / cross-cutting.

---

## 1. Workflows unlocked

1.1 **Prompt → Pascal one-shot studio**
Value: a landing page textarea ("design me a 90 m² south-facing apartment in Barcelona") that spawns a scene and drops the user into the editor with orbit camera pre-aimed. Lowest-friction wedge for consumer acquisition.
Effort: M (needs hosted MCP + auth + an agent loop that calls `from_brief`).
Risk: expectations calibration — generated scenes will look schematic without finishes.

1.2 **Photo → Pascal via `analyze_floorplan_image`**
Value: the tool exists but currently only the MCP host calls it. Exposing a drag-and-drop upload in the editor (`viewer-overlay`) that posts to MCP and returns a ready-made scene turns Pascal into a floorplan digitiser. Realtors and renovators will pay for this alone.
Effort: M (client upload, MCP host with sampling, progress UI).
Risk: the vision model is approximate; users will expect dimensional exactness and blame Pascal for mis-reads.

1.3 **Listing URL → Pascal (Zillow / Idealista / Rightmove)**
Value: paste a listing URL, a scraper extracts the floor plan image + listed area, `analyze_floorplan_image` produces the scene, then "remodel" prompts run on top. Enormous cold-start value — the user arrives with a house they already care about.
Effort: L (scraping layer, anti-bot, per-site parsers, legal).
Risk: ToS / legal on scraping; drives a category of "renovation-before-offer" anxiety that may alienate listings.

1.4 **Multi-variant generation**
Value: "give me 5 kitchen variations" → 5 forked scenes saved as siblings, tiled in a comparison view. Pattern-matches Midjourney's grid. Encourages exploration, sells more generations.
Effort: M (needs scene forking + a comparison UI; the `forkSceneGraph` helper exists already in `core/clone-scene-graph`).
Risk: without a scored objective ("cheapest", "most storage"), users get lost choosing; need ranking.

1.5 **Regulatory/accessibility lints**
Value: "ensure this scene complies with Spanish Código Técnico de la Edificación accessibility." MCP walks zones/doors/stairs, flags minimum door widths, corridor widths, ramp slopes, stair rise/run. Sells to architects and BIM shops.
Effort: L (per-jurisdiction rule packs; `check_collisions` is a proof the traversal works).
Risk: false confidence — a lint pass is not a stamped permit; liability exposure.

1.6 **Live co-design ("AI architect next to me")**
Value: editor sidebar chat pane; user edits walls, AI proposes adjustments ("you lost the light well — shall I add a skylight?") via MCP on a debounced scene diff. Screen-share-ready demo.
Effort: L (streaming agent, scene-diff prompts, throttling).
Risk: agents nagging mid-edit is the fastest route to churn; needs carefully tuned interventions.

1.7 **Voice-driven redlines on a phone**
Value: open a scene on mobile (preview-button path exists), talk into the mic ("turn the office into a nursery, softer colours"), MCP applies patches, renderer reflows on reload. Wins the "showing mum the renovation" moment.
Effort: M (Whisper → text → `from_brief`/`iterate_on_feedback`, mobile-friendly result).
Risk: WebGPU on low-end Android will fail; need a fallback still renderer.

1.8 **Cost + BOM synthesis**
Value: after scene generation, MCP walks catalog items and zones → exports a parts-list CSV with Spanish supplier SKUs and regional labour rates. Converts the toy into a quoteable artefact.
Effort: M (catalog → pricing mapping, jurisdictional labour constants).
Risk: pricing drifts; must be explicit about "indicative".

1.9 **Time-lapse tours**
Value: MCP emits a keyframed camera flythrough script (camera node already exists in `BaseNode.camera`). One click → shareable MP4. Drives social acquisition.
Effort: M (stitch recorder in the viewer; `apply_patch` can set cameras).
Risk: WebGPU video capture is finicky across Safari.

---

## 2. Novel primitives

2.1 **Scene branches & forks (Pascal-Git)**
Value: "save as branch" on every MCP mutation; user can compare, merge, or revert branches visually. The current temporal middleware gives us a linear undo stack; exposing a DAG unlocks nondestructive exploration and is a natural home for multi-variant results.
Effort: L (schema for branches, UI, storage beyond IndexedDB).
Risk: merge semantics for geometry are unsolved — walls and openings resist 3-way merge.

2.2 **Scene templates catalog**
Value: a resource `pascal://templates/*` — studio apartment, ADU, Japanese machiya, Barcelona eixample flat. `from_brief` prompts seed from the nearest template, drastically improving first-shot quality.
Effort: S–M (author ~20 templates, register as MCP resources).
Risk: templates can anchor the generator; need variety + randomisation.

2.3 **Component library / "sub-scenes"**
Value: save a kitchen layout as a reusable component that carries its own sub-graph. MCP tool `instantiate_component` drops it onto a level with a transform. Mirrors Figma components.
Effort: M (schema addition for component refs or instance-of nodes; invalidation when parent changes).
Risk: local-vs-shared component propagation; ownership of community components.

2.4 **Scene diff view**
Value: built on top of `export_json` + a structured differ — show "AI added 3 walls, removed 2 doors, reshaped zone X". Makes AI suggestions reviewable like a PR.
Effort: M (diff algo, UI, inline accept/reject per patch).
Risk: diff UIs require high polish to feel trustworthy.

2.5 **`explain_scene` tool**
Value: a new MCP tool (or prompt) returning a natural-language summary: "A 92 m² duplex with the kitchen facing west; accessibility score 6/10; conspicuously no closet space." Turns scenes into legible artefacts for non-3D users.
Effort: S (wrapping `scene-summary` resource with an LLM prompt).
Risk: hallucinated detail; must be grounded strictly in `find_nodes` data.

2.6 **Semantic scene search**
Value: "find every wall in the scene longer than 4 m that faces south" → `find_nodes` is spec'd narrowly (type/parent/zone/level); extend with predicates + embedding search over `metadata`.
Effort: M (predicate DSL or JSON-logic filter, optional embeddings).
Risk: query DSLs get complex fast; keep it constrained.

2.7 **Real-world anchor nodes**
Value: a `SiteOrigin` node carrying lat/lon/heading/altitude so MCP can reason about sun path, climate, zoning. Enables solar analysis and jurisdictional rules.
Effort: S schema, L downstream (solar calc, sun path widget).
Risk: accidentally leaking address when scenes are shared.

2.8 **Commentable scene nodes**
Value: add a `comment` or `annotation` edge to any node: "client wants this moved 20 cm". Makes Pascal a review surface for human + AI collaboration. Dovetails with 2.4.
Effort: S (new schema node; UI pin).
Risk: scope creep into full comments system.

---

## 3. Edge cases

3.1 **Concurrent MCP writers**
Two agents holding the same `SceneBridge` both call `apply_patch` on the same node. Zundo coalesces at the store level; there is no lock. Result: lost updates, order-dependent chaos.
Mitigation: per-bridge operation mutex, or optimistic version stamps inside `UpdatePatch`.

3.2 **Invalid scene crashes editor**
MCP writes a `DoorNode` with `parentId` pointing to a slab. `validate_scene` catches it, but a misuse of `apply_patch` with a forged parent slips through. Editor hooks assume doors under walls and blow up.
Mitigation: the editor should hydrate through the same Zod validator, not trust the JSON. Add an "editor-safe boot" path that falls back to a recovery scene.

3.3 **10k-node performance cliff**
The Zustand store keeps a flat `nodes` dict; most tools iterate linearly. `check_collisions` is O(n²) on item bounds. Agents might produce hundreds of chairs in an office.
Mitigation: budget + warn inside `apply_patch`, or cap nodes per type with a clear error.

3.4 **Circular parent-child refs**
`validate_scene` covers Zod shape; a patch chain can still create a cycle (A.parent=B, B.parent=A). Traversal hangs.
Mitigation: cycle detection pass in `apply_patch` dry-run before commit.

3.5 **Camera points at nothing**
AI creates a 5 cm tall decorative bowl on the second floor and the last-placed-camera convention zooms there. First impression: black screen.
Mitigation: always auto-frame to root bounding box on MCP-opened scenes; store a `pascal://scene/current/recommendedCamera` resource.

3.6 **Broken external assets**
`ItemNode` can reference `asset://` URLs; in Node, the core asset loaders are browser-only and return nothing. A scene saved in the browser with asset URIs, then opened headless, displays placeholders; a scene passed back to the browser still references dead IDs.
Mitigation: MCP must round-trip asset URIs opaquely (never create new `asset://` IDs), and the editor should show a "missing asset" fallback.

3.7 **User edits after MCP — merge or clobber?**
The current bridge is stateful with a linear undo stack. If an agent re-runs `from_brief` on a user-modified scene, it rewrites from scratch. Either we implement 3-way merge (2.1) or we lock the scene and make MCP operate on a branch.
Mitigation: default to fork-on-regenerate; never overwrite user edits.

3.8 **PII in shared scenes**
A floor plan with lat/lon (2.7) or matching a real home is a privacy liability. Exporting `export_json` strips nothing. Agents uploading scenes to a shared LLM vendor leaks data.
Mitigation: a `strip_pii` utility that blanks address/gps/photos; explicit consent dialog before MCP sends images to remote hosts.

3.9 **Offline + cloud scenes**
If we add cloud persistence (§5), MCP runs against a server-only scene when user is offline. Writes queue; reconciliation becomes a merge problem (3.7). IndexedDB persistence covers local, not cross-device.
Mitigation: conflict-free writes via CRDT-style patch log keyed by node ID.

3.10 **Sampling unavailable**
`analyze_floorplan_image` gracefully errors when the host lacks sampling. Users who paid for this feature on a non-Claude host get a brick.
Mitigation: publish a supported-host matrix; provide a first-party web host for users without one.

3.11 **GLB export stub**
`export_glb` throws `not_implemented`. An AR-preview (§4.6) or a glTF-requiring downstream (Unity, Blender) falls off a cliff. This is the single largest productisation gap.
Mitigation: stand up a headless renderer worker (puppeteer + WebGPU) or build a geometry exporter independent of three-mesh-bvh.

3.12 **Prompt injection via scene metadata**
`BaseNode.metadata` is arbitrary JSON. A hostile scene file seeds strings into `describe_node` output, which an LLM later reads. Classic indirect prompt injection.
Mitigation: sanitise/escape metadata when emitting into model-visible surfaces; strip control tokens.

3.13 **Temporal stack explosion**
Zundo caps history but MCP could batch thousands of operations per "patch" — one undo reverts huge changes invisibly. Users panic when Cmd-Z throws away the whole room.
Mitigation: each MCP mutation shows a visible "AI step" badge; undo granularity documented.

3.14 **Units mismatch**
MCP tools say meters; catalog items may carry cm internally. Silent drift of 100x.
Mitigation: enforce units at the schema boundary; add a unit-assertion test in CI.

---

## 4. Integrations

4.1 **Figma → Pascal**
Value: a Figma plugin lets designers hand a 2D mood board to an MCP scene. The palette, materials, and key dimensions flow in. Wins the handoff from 2D to 3D.
Effort: M.
Risk: Figma plugin review; limited 3D fidelity.

4.2 **Revit / SketchUp / IFC import**
Value: architects live in these tools; Pascal becomes the "redline + present" layer. IFC in particular is the lingua franca of BIM.
Effort: L (IFC parser; map to Pascal nodes).
Risk: schema mismatch; Pascal is lighter-weight than full BIM.

4.3 **USD / glTF / IFC export**
Value: outward compatibility = easier adoption. USD for Pixar/Nvidia Omniverse pipelines, glTF for web, IFC for construction. Unlocks 4.2 reciprocally.
Effort: M–L per format.
Risk: 3.11 — geometry derivation still lives in the browser renderer; export-by-transpile is needed.

4.4 **MCP tool marketplace**
Value: third parties publish style MCPs ("Japandi kitchen", "Brutalist staircase", "Zaha-Hadid-ish"). They compose as sub-tools callable from `from_brief`. Pascal becomes a platform.
Effort: L (registry, sandboxing, review).
Risk: quality dilution; security (3.12).

4.5 **Planning-permission APIs (UK Planning Portal, Spain Sede Electrónica)**
Value: generated scene → pre-filled planning application PDF. Brutal time-saver. Differentiator vs Canva-for-architecture competitors.
Effort: L.
Risk: compliance; rules differ per council.

4.6 **AR preview — Apple RoomPlan / ARKit / ARCore**
Value: phone scans the room with RoomPlan → MCP ingests the plist → user redesigns in Pascal → AR overlays result onto the real room. Tactile "buy this sofa here" moment.
Effort: L (iOS/Android apps; glTF export 3.11 prerequisite).
Risk: needs native apps Pascal doesn't have.

4.7 **E-commerce catalog bridges (IKEA, Wayfair, Kave Home)**
Value: map `ItemNode.catalogItemId` to retailer SKUs. "Checkout this room" button. Affiliate revenue.
Effort: M (catalog mapping, retailer API quirks).
Risk: SKU churn; regional availability.

4.8 **Google Earth / OSM site context**
Value: lat/lon (2.7) + MapBox → Pascal renders the adjacent buildings, street, sun path. Scene gains real-world context. Critical for facade design.
Effort: L.
Risk: licensing maps data.

---

## 5. Monetization

5.1 **Pay per generation**
Value: $0.50–$2 per `from_brief` call. Low commitment, matches OpenAI/Midjourney consumer norms.
Effort: S (Stripe + credits; MCP host tracks).
Risk: commoditised unless paired with templates (2.2) or regulatory value (1.5).

5.2 **Pro subscription (unlimited AI + cloud saves)**
Value: $15/mo predictable ARR.
Effort: M.
Risk: balance cost; fair-use caps for heavy users.

5.3 **Template / component marketplace**
Value: creators sell templates (2.2) and components (2.3). Pascal takes 20%.
Effort: M (payments, tax, takedowns).
Risk: content moderation; cold-start supply.

5.4 **Enterprise BIM seat**
Value: firms pay per seat; access to IFC import, compliance packs, branded export. $50–200/seat/mo.
Effort: L.
Risk: SOC2, procurement cycles.

5.5 **Lead-gen for contractors**
Value: after a scene is generated, Pascal matches to local contractors with quote requests. Contractors pay per lead.
Effort: M.
Risk: lemons-market; must vet contractors.

5.6 **Branded MCP for retailers**
Value: IKEA white-labels Pascal's MCP under "IKEA Studio". Licensing fee. Pascal stays the engine, retailer owns the UI.
Effort: M (API + licensing).
Risk: channel conflict; retailers might eat Pascal.

---

## 6. Ecosystem beyond current scope

6.1 **Pascal MCP becomes a standard for spatial editors**
Value: the tool verbs (`create_wall`, `place_item`, `cut_opening`) generalise. Onshape, SketchUp, Rhino could adopt a "spatial MCP" profile. Pascal authors the spec.
Effort: L (ecosystem work, not code).
Risk: platforms resist standards that commoditise their moats.

6.2 **Open-source Pascal Scene Format**
Value: USD is overkill for interior/architectural scenes; glTF lacks building semantics. A Pascal-flavoured JSON schema (already Zod-native) becomes the "Markdown of interiors". Could ship as `@pascal-app/scene-format`.
Effort: M to carve out; L to evangelise.
Risk: yet-another-format fatigue; ties ecosystem to Pascal's semantic choices.

6.3 **Educational channel — "Design school in Pascal"**
Value: a publisher (or Pascal) ships a curriculum — "design a studio flat", "analyse daylight". Classrooms teach design thinking with an MCP agent as tutor.
Effort: M (curriculum; content).
Risk: sales-motion mismatch with a B2C/B2B tool.

6.4 **Scene replay / provenance logs**
Value: every MCP patch is signed, stored, and replayable. A regulator or client can audit the design history. Opens procurement doors.
Effort: M (append-only log; signing keys).
Risk: GDPR implications of retention.

6.5 **Physical fabrication downstream**
Value: furniture/cabinet generation → CAM-ready DXF → CNC shop. Unlocks "AI designed and built my kitchen" as a narrative.
Effort: L.
Risk: tolerances; liability.

6.6 **Agent-to-agent Pascal**
Value: a procurement agent talks to a designer agent talks to a contractor agent — Pascal scenes are the shared artefact. Pushes Pascal as infrastructure for the agent web.
Effort: L (policy, auth between agents).
Risk: sounds crazy today; will be obvious by 2027.

---

## 7. Crazy-but-maybe ideas

7.1 **"Sceneprint"** — give Pascal a photo of you standing in your room; it infers which room, auto-positions the camera, and starts redesign from there. Sells to TikTok.

7.2 **"Phantom move-in"** — MCP grafts your furniture (measured from another Pascal scene) into a listing. Realtors hand buyers a pre-staged version of the home they're considering.

7.3 **Insurance-linked scenes** — an insurance app ingests your Pascal scene to price contents cover faster and more accurately. Scene = digital twin = underwriting data.

7.4 **Agent-on-call** — you email pascal@your.domain with a photo; MCP replies with a scene URL. No app, no login, pure asynchronous co-design. Drives discovery far beyond the editor.

7.5 **"Haunted" scenes** — designer publishes a scene; buyers walk through in AR; on replacement of an item, MCP whispers "the designer disagrees — here's why". Opinionated design, monetised.

7.6 **Voice-coded CAD for blind users** — purely spoken design, Pascal describes the scene back via `explain_scene` (2.5). Genuine accessibility win and possibly grant-fundable.

7.7 **Multi-player Pascal** — Yjs/CRDT layer on the scene graph, MCP agents as first-class collaborators alongside humans. Google Docs for interiors.

---

## Top 10 ideas ranked by (value × feasibility)

1. **1.2 Photo → Pascal (floor plan upload)** — MCP already has `analyze_floorplan_image`; only the UI entry point and host plumbing are missing. Highest value-for-effort unlock in the repo right now.
2. **2.2 Scene templates catalog** — S–M effort, dramatically improves `from_brief` output quality, and doubles as marketplace seed inventory (5.3).
3. **3.5 Auto-framing camera on MCP-opened scenes** — a tiny fix for the single most embarrassing failure mode ("black screen"). S effort, huge UX.
4. **1.1 Prompt → Pascal one-shot studio** — the canonical "MCP creates scene" workflow. Build it as the hosted front door, not a side feature.
5. **1.4 Multi-variant generation** — `forkSceneGraph` already exists; a comparison grid lights up exploration and creates upsell moments (pay-per-variant).
6. **2.4 Scene diff view** — makes every AI action reviewable and is a prerequisite for 1.6 and 3.7 merge flows.
7. **1.8 Cost + BOM synthesis** — converts toy scenes into quoteable artefacts; directly monetisable via retailer affiliates (4.7).
8. **2.1 Scene branches & forks** — larger, but it dissolves the "overwrite vs merge" edge (3.7) and is the structural foundation for multi-variant and AI co-design.
9. **3.11 GLB / glTF export via headless renderer** — unlocks AR (4.6), USD/IFC bridges (4.3), and removes the most cited "limitation" in the README.
10. **1.5 Regulatory/accessibility lints (pilot: one jurisdiction)** — pick Spain or the UK, ship one rule pack; opens the B2B architect segment where budgets live.

Honourable mention: **1.6 Live co-design** — the single most defensible long-term product vision, but it depends on 2.1, 2.4, and a streaming agent layer the repo doesn't have yet. Build the pieces, then assemble.
