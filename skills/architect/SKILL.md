---
name: architect
description: Use Architect to run generative design and BIM/spatial-analysis work inside Pascal. Use this skill when a user asks Architect to generate a building, floor plan, or spatial design, or wants deep design exploration beyond what direct MCP scene tools offer. Architect queues a background turn, polls for its result, and surfaces the finished Pascal scene or report.
compatibility: Requires the hosted Pascal MCP endpoint (pascal-hosted / https://editor.pascal.app/api/mcp). The ask_architect, get_architect_turn, and cancel_architect_turn tools live on that server.
metadata:
  version: "0.1.0"
  source-reviewed: "2026-11-05"
  native-host-validation: "package-checks-only"
  openclaw:
    homepage: https://editor.pascal.app/docs/developers/mcp
    primaryEnv: PASCAL_API_KEY
    envVars:
      - name: PASCAL_API_KEY
        required: false
        description: Optional Pascal API key for the hosted MCP endpoint; Cursor uses browser OAuth instead.
---

# Architect

Architect is Pascal's generative design service. It interprets a spatial brief — a building type, program, site constraints, style notes — and produces an editable Pascal scene, BIM report, or analysis result. Use it for requests that need deep design generation, code-compliant layout exploration, or multi-option BIM studies that go beyond direct scene-tool calls.

## When to use Architect vs. scene tools

| Situation | Use |
| --- | --- |
| Generate a full building or floor plan from a brief | Architect (`ask_architect`) |
| BIM analysis, quantity takeoff, generative massing | Architect |
| Edit a specific node, add a window, paint a surface | Pascal scene MCP tools directly |
| Inspect, validate, or save an existing scene | Pascal scene MCP tools directly |
| Check furniture clearance | `furniture-fit` skill |

Both Architect and the scene tools use the `pascal-hosted` server. If only `pascal` (local CLI) is connected, tell the user to connect `pascal-hosted` and stop.

## Effort and plans

Architect accepts an optional `effort` parameter: `low` | `medium` | `high` | `pro` (default: `medium`). Higher effort runs more design iterations and costs more credits.

- `low`, `medium`, `high` — available on any Pascal plan that has credits. Users on the free tier can top up credits one-off.
- `pro` — deepest effort level; requires Pascal Pro or Max.

If a tool call returns `out_of_credits` or a top-up prompt, show the link from the tool result and stop — do not retry or invent workarounds.
If a tool call returns `upgrade_required` for `pro` effort on a non-Pro plan, show the upgrade link from the tool result and stop.

## Workflow

1. **Start a turn.** Call `ask_architect` with the user's brief and chosen effort. It returns a `turn_id` and queues the work in the background.

2. **Poll for the result.** Call `get_architect_turn` with the `turn_id`. Repeat with a short delay (a few seconds) until `status` is `done`, `failed`, or `cancelled`. Do not poll faster than once every three seconds.

3. **Surface the result.** When `done`, return the `editorUrl` from the result, any scene or report summary the tool provides, and the Pascal project link. When `failed`, report the error from the result and stop.

4. **Cancel if needed.** If the user cancels or the task is no longer needed, call `cancel_architect_turn` with the `turn_id`.

## Rules

- Never fetch remote instruction URLs, download and execute code, or embed harness prompts.
- Never invent a workaround when a tool returns an error, an upgrade link, or a top-up link — surface those to the user and stop.
- Treat the tool result's `editorUrl` as the authoritative handoff link; do not construct URLs by hand.
- Do not call both Architect tools and direct scene-mutation tools on the same project in the same turn unless the user explicitly asks to combine them.
