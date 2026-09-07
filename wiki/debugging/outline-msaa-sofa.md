# Selected sofa outline: MSAA and a pipeline-cache collision

Investigated on `perf/hover-outline`, based on `48e8677e`, using Three 0.185.1,
headed Chromium/WebGPU, and Maxi House `project_Ypetx4DMm0bH9XIR` at :3006.
Selected sofa: `item_qy4ulzbvqo3qeo31`, page point `(495, 724)`.

## Outline defect and correction

The scene pass inherits the renderer's four samples, while the outline mask
uses a single sample. Before this fix, the mask compared pixel-centre fragment
depth against scene sample zero with a one-ULP allowance.

The generated WGSL really used `textureLoad(depth, pixel, 0)`. At canvas pixel
`(151, 676)`, one yellow load had scene depths:

```text
sample 0  0.9926069378852844
sample 1  0.9926084280014038
sample 2  0.9926099181175232
sample 3  0.9926114082336426
mask      0.9926092028617859
```

Sample zero is 38 ULPs in front of the mask. This is the same sofa surface at
different sample positions, not an occluder. Averaging the symmetric sample
positions reconstructs pixel-centre depth on the planar surface.

`packages/viewer/src/lib/merged-outline-node.ts:581` reads the producer's explicit
sample option, falling back to renderer samples just as PassNode does. Its mask
shader resolves depth at the pixel centre by averaging sample differences
relative to sample zero. This avoids rounding a sum of nearly-one depths. The
one-ULP comparison, single-sample mask coverage, proxy rendering, and pass count
remain unchanged. There is no new depth pass or depth-copy target.

Relevant code:

- `packages/viewer/src/lib/merged-outline-node.ts:73`: single-sample mask target.
- `packages/viewer/src/lib/merged-outline-node.ts:589`: sample-centre reconstruction.
- Three `src/nodes/display/PassNode.js:764`: producer sample-count setup.
- Three `src/renderers/webgpu/nodes/WGSLNodeBuilder.js:725`: texture load generation.

## External backlog row: polygon-offset state omitted from WebGPU pipeline cache

**Problem:** Three 0.185.1 can give an ordinary material another material's
polygon-offset pipeline. The sofa's `Mesh154_2` material consistently reported
`polygonOffset=false`, factor zero, units zero. Its actual GPU pipeline varied:

| Capture | Sofa yellow pixels | GPU depth bias | GPU slope scale |
| --- | ---: | ---: | ---: |
| `sofa-all-pipelines2/load0.json` | 354 | absent (zero) | absent (zero) |
| `sofa-all-pipelines2/load1.json` | 0 | 1 | 1 |

The clean load's pipeline was labelled
`renderPipeline_MeshLambertNodeMaterial_537`, despite the sofa material not
requesting any bias. In that load, sample zero was `0.9926130175590515` while
mask depth remained `0.9926092028617859`: inherited positive bias moved scene
depth behind the mask and concealed the outline's MSAA defect.

Both captures used the same 1256x952 targets, DPR 1, four-sample `depth24plus`,
solid shading, output+normal MRT, and sofa geometry/world transforms. A main
submission census normalized by mesh name, transform, and material flags matched
between clean and yellow loads. Proxy matrices matched their source matrices.
The mask shader and its bound scene-depth texture were also verified.

**Mechanism, in the installed Three source:**

- `src/renderers/webgpu/utils/WebGPUPipelineUtils.js:239` puts polygon-offset
  units and factor into the GPU pipeline descriptor.
- `src/renderers/webgpu/WebGPUBackend.js:2114` (`getRenderCacheKey`) omits all
  three polygon-offset fields.
- `src/renderers/common/Pipelines.js:431` keys shared pipelines by shader stage
  IDs plus that backend key. Identical shaders can therefore reuse whichever
  biased/unbiased pipeline was created first.
- `src/renderers/webgpu/WebGPUBackend.js:2048` (`needsRenderUpdate`) also omits
  these fields from change detection.

**Backlog action:** correct both cache identity and update detection in the
dependency, and test both material creation orders plus live offset changes.
Do not compensate for an inherited pipeline bias in the outline shader.
The site ground requests `(factor=1, units=1)` at
`packages/nodes/src/site/renderer.tsx:188`; the exact originating object of the
captured cached pipeline was not identified.

This dependency defect is documented, not patched by the outline change.

## The requested wall-count gate contains self-occlusion

The Maxi S target is `wall_7g69puvhnhfuikdu` at `(495, 324)`. Both a farthest-sample
comparison and pixel-centre reconstruction remove its stored 231-yellow band.
An independent removal control used the **original sample-zero comparison**,
kept the mask, and omitted only the selected wall's source meshes from main-pass
depth. Yellow went from `226, 226, 226` to **0**. Remaining geometry did not
occlude that band. The small difference from 231 accompanies slight camera
settling variation between captures.

At canvas `(130, 350)`, scene samples relative to mask depth were
`[-21, +62, -62, +21]` ULPs. Removing the wall changed them to
`[+2743, +2710, +2676, +2643]` ULPs, all behind the mask. Near the edge at
`(137, 354)`, the corresponding values were `[-21, +62, -62, +12]` and
`[+113, +79, +45, +12]`. Thus the sampled band is self-occlusion, not a valid
real-hidden-edge reference.

The requested approximately-231-yellow gate is **not met** by this correction;
it would preserve the defect. Real occlusion is checked separately by the GPU
fixture, including the existing flat 1 cm occlusion cases.

## Final validation

- `flicker2.ts`: four loads, each `yellow = 0, 0, 0`; draw count 1058 and batch
  census 46 items / 619 instances / 9 meshes on every load.
- GPU fixture: **216/216**, versus **198/216** with `48e8677e`. All 18 failures
  on the previous implementation were visible sloped surfaces under MSAA.
- `bun test packages/viewer/src`: **193 passed**, 16,823 assertions.
- `bunx tsc --build packages/viewer`: passed.
- Root `bunx biome check`: passed with one existing informational hook-dependency
  diagnostic in `packages/editor/src/components/editor/index.tsx:1299`.
- Rich-4x pass attribution, 300/301 frames per pose: hover mask **0.06 ms**,
  selected-wall mask **0.07 ms**, selected-item mask **0.07 ms**, CPU self time
  per frame. Each mask rendered once per frame; no outline depth pass.

Requested `outline-parity.ts --tag sofafix` compared with `final`:

| Project | Pose | Different pixels | Yellow, final to sofafix |
| --- | --- | ---: | ---: |
| Maxi | S | 0.143% | 231 to 0 |
| Maxi | SI | 0.007% | 0 to 0 |
| rich-4x | S | 0.212% | 6 to 4 |
| rich-4x | SI | 0.188% | 0 to 0 |

White and blue censuses match exactly for these S/SI poses. The stored-reference
pixel gate is not fully green. The wall removal control above explains the Maxi
yellow change. Earlier base-control captures also showed a rich-4x reference
discrepancy; this investigation did not rerun that base control or attribute every
remaining rich-4x pixel difference. Validation here used Chromium's WebGPU
backend, not WebGL2 or other GPU implementations.

## Evidence location

Probe scripts, JSON readbacks, WGSL, screenshots, and logs are in the session
scratchpad supplied in the task:

```text
/private/tmp/claude-501/-Users-wawa-Documents-Projects-pascal-private-editor/c3689a5f-d0b7-44a9-8c8a-8df089d76b1e/scratchpad
```

- `sofa-all-pipelines2.ts`, `sofa-all-pipelines2/`: GPU pipeline descriptors,
  depth samples, original colour census, source/proxy matrices and render lists.
- `wall-depth.ts`, `wall-depth/`: wall depth and removal-control readbacks.
- `wall-self-control.ts`, `wall-self-control.log`: original sample-zero shader
  comparison, followed by removal of only the selected wall from scene depth.
- `sofa-flicker-gate.log`, `sofa-parity-compare.log`: final application gates.
- `sofa-attribution-gate.log`, `sofa-mask-attribution-gate.log`: rich-4x cost.
- `packages/viewer/tests/outline-depth.browser.ts`: portable GPU regression
  fixture; instructions in the adjacent README.
