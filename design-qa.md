**Comparison Target**

- Source visual truth: `/var/folders/sn/2jgcj5r95qq3t4l_7tzjh2gh0000gn/T/codex-clipboard-18484c1f-bc43-43a1-a329-791cb5605ff4.png` and `/var/folders/sn/2jgcj5r95qq3t4l_7tzjh2gh0000gn/T/codex-clipboard-1ff72f24-c84b-4b6a-94eb-4ced9a04bd4d.png`.
- Implementation screenshot: `/private/tmp/internal-dimension-lines-preview.png`.
- Viewport: 1280 × 720.
- State: local scene route after clicking 2D and waiting 2.5 seconds; 3D remained selected and the scene remained on its loading indicator.
- Intended state: internal dimension baselines, witness lines, ticks, and values render clear of the wall, and enclosed perimeter doors receive room-side width dimensions.

**Full-view Comparison Evidence**

- The source screenshots show internal values while their linework is collapsed onto the host walls, making the strings read as detached text.
- The larger left perimeter door has no room-side width dimension in the source state.
- The implementation screenshot could not be compared at the same scene state because the local scene did not finish loading.

**Focused-region Comparison Evidence**

- Source: the horizontal internal strings contain values such as `0.5m`, `0.9m`, `4.9m`, and `3.5m`, but the intended parallel baseline and extension linework is not visibly separated from the wall.
- Generated implementation geometry now places automatic internal baselines at `0.55 m` from their witness origins rather than explicitly pinning them at `0 m`.
- Generated plans now include room-side opening chains for enclosed perimeter walls in all four orientations, including a left-side door.
- A same-state rendered focused comparison is blocked by the local loading state.

**Findings**

- [P0] Browser-rendered implementation evidence unavailable.
  Location: local editor preview.
  Evidence: the captured implementation contains only the loading indicator; clicking 2D leaves 3D selected.
  Impact: final screen-space line visibility, collisions, and door-width placement cannot be visually accepted.
  Fix: restore a working local scene preview and recapture the reported room in 2D.

**Required Fidelity Surfaces**

- Fonts and typography: source labels remain unchanged by this fix; post-fix rendered typography is blocked from inspection.
- Spacing and layout rhythm: geometry tests verify the internal baseline clearance is restored to `0.55 m`; pixel-level rhythm is blocked from inspection.
- Colors and visual tokens: no color or token changes were made; rendered contrast is blocked from inspection.
- Image quality and asset fidelity: no image assets are involved.
- Copy and content: dimension values remain generated from the same measurements; the missing perimeter-door width is now included.

**Comparison History**

- Earlier P0: internal baseline coordinates were explicitly equal to witness coordinates, overriding `offsetDistance` and collapsing lines onto walls.
- Fix: preserve omitted automatic baselines so the renderer applies the configured offset; add enclosed room-side opening chains for perimeter walls.
- Post-fix evidence: SVG renderer regression asserts a `0.55 m` automatic baseline, and planner regressions cover top, right, bottom, and left perimeter doors. Browser-rendered evidence remains blocked.

**Implementation Evidence**

- Focused dimension, wall, floor-plan, and registry tests: 61 passed, 0 failed.
- Nodes package build: passed.
- Editor package type-check: blocked by the unrelated missing `resolveFloorplanExportViewport` export referenced by `floorplan-export.test.ts`.
- Biome check: passed.
- Git diff whitespace check: passed.
- Browser console warnings/errors: none reported.

**Implementation Checklist**

- Restore the local editor preview.
- Reopen the reported room in 2D.
- Confirm each internal string has a visible parallel baseline, witness lines, and ticks.
- Confirm the large left-side door displays its room-side width dimension.

**Follow-up Polish**

- Reassess internal line contrast only after the corrected geometry can be seen in the target scene.

final result: blocked
