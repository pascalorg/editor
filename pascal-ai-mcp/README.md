# Pascal AI LangGraph Service

LangGraph-based requirement intake and floor-plan generation service for the Pascal editor.

```text
Pascal editor AI panel
  -> /api/ai (Next.js same-origin proxy)
  -> pascal-ai-mcp :8788
  -> LangGraph requirement workflow
  -> Azure OpenAI or another OpenAI-compatible model
  -> Pascal MCP over stdio or HTTP
  -> Pascal SceneStore + editor SSE
```

## Workflow

1. Accept text or one JPG/PNG floor-plan image with optional text.
2. Extract existing conditions, design goals, hard constraints, assumptions, uncertainties, and conflicts.
3. Classify the input as usable, partially usable, or unusable.
4. Ask up to three structural clarification questions per round.
5. Present a provenance-aware structured summary.
6. Wait for explicit confirmation before changing a scene.
7. Generate a starter scene, refine it through bounded MCP tool calls, validate it, and run bounded repair rounds.
8. Treat later user messages as incremental MCP edits to the generated scene, then re-run checks.

CAD/DXF/DWG input is intentionally outside this AI workflow. The editor's existing DXF importer remains separate.

## Design docs

Rule source of truth lives in `docs/` (change flow: edit doc → sync code → eval regression):

- [docs/LAYOUT_STRATEGY_DESIGN.md](docs/LAYOUT_STRATEGY_DESIGN.md) — 策略层规则与拓扑细则（areaBand / typology / kitchenMode / 打分参数）
- [docs/NORMS_PROFILE_DESIGN.md](docs/NORMS_PROFILE_DESIGN.md) — default / JP 规范档案与参数来源（NormProfile）
- [docs/MODIFY_REDESIGN.md](docs/MODIFY_REDESIGN.md) — 修改流程重设计（Modify = 编辑 Intent；草案，待拍板）

## Configuration

The service loads environment values in this order without overriding existing process values:

1. repository `.env.local`
2. repository `.env`
3. `pascal-ai-mcp/.env`

For Azure OpenAI, configure:

```env
AI_PROVIDER=azure-openai
AZURE_OPENAI_ENDPOINT=https://your-resource.cognitiveservices.azure.com
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_DEPLOYMENT=your-deployment
AZURE_OPENAI_API_VERSION=2024-10-21
```

OpenRouter-compatible endpoints remain supported when `AI_PROVIDER` is omitted:

```env
OPENROUTER_FALLBACK_API_KEY=...
OPENROUTER_FALLBACK_MODEL=...
```

By default the service starts Pascal MCP as a stdio child process. To connect to an already-running HTTP MCP server instead:

```env
PASCAL_MCP_MODE=http
PASCAL_MCP_URL=http://127.0.0.1:3917/mcp
```

Use the same `PASCAL_DATA_DIR` or `PASCAL_DB_PATH` as the editor so generated scenes and live events share storage.

**Template seeding requires the matching norm profile.** The reference library (`templates/`, all `market: "jp"` today) is matched against the runtime profile — with the default profile no template can ever hit and every request falls back to the from-scratch partitioner. For the template-first experience, start the service with:

```env
PASCAL_NORM_PROFILE=jp
```

## Run

From the repository root, `bun dev` includes this workspace. To run only the AI service:

```bash
cd pascal-ai-mcp
bun run start
```

The service starts even when no model key is configured. `/health` then reports `configured: false`, and chat requests return a recoverable configuration error.

## Endpoints

- `GET /health`
- `GET /tools`
- `POST /chat`
- `GET /sessions/:id`
- `DELETE /sessions/:id`

`POST /chat` accepts:

```json
{
  "sessionId": "demo",
  "sceneId": "optional-active-scene-id",
  "message": "设计一个85平方米的两居室"
}
```

Image input adds `imageDataUrl`. Confirmation and cancellation use:

```json
{ "sessionId": "demo", "action": "confirm" }
```

The service stores workflow sessions in `.data/sessions.json`. LangGraph also checkpoints node execution by `sessionId` for the running process.

## Verify

```bash
bun run check-types
bun test
```
