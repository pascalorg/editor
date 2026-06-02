# CAD Worker

Thin project-owned worker for the **文生 CAD** pipeline.

This first vertical slice is intentionally dependency-free: it writes a fixed engineering-style
bracket GLB, a STEP placeholder, CAD source, thumbnail, log, and `result.json`. The purpose is to
prove the editor/API/asset flow before adding the build123d/CadQuery + DeepSeek execution loop.

## Command

```bash
node tools/cad-worker/worker.mjs generate --input request.json --output output-dir
```

## Next phase

Replace the fixed generator with:

1. DeepSeek generates build123d Python CAD source.
2. Worker executes source in a restricted temp workspace.
3. Worker exports STEP + GLB + thumbnail.
4. Failed runs feed compact logs back into the repair loop.
