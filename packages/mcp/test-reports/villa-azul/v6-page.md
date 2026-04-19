# V6 — Next.js Page Render Verification

- Scene ID: `a6e7919eacbe`
- Base URL: `http://localhost:3002`
- Generated: 2026-04-19T18:34:29.221Z
- Overall: PASS (14/14)

## Request summary

| Path | Status | Bytes | Time (ms) |
|---|---|---|---|
| `/scene/a6e7919eacbe` | 200 | 81737 | 58.3 |
| `/scene/nope` | 200 | 31713 | 23.8 |
| `/scenes` | 200 | 20022 | 20.9 |

## Checks

| Result | Check | Detail |
|---|---|---|
| PASS | scene: 200 status | got 200 |
| PASS | scene: HTML >= 10 KB | 81737 bytes |
| PASS | scene: contains 'SceneLoader' |  |
| PASS | scene: contains sceneId 'a6e7919eacbe' |  |
| PASS | scene: contains 'Villa Azul' |  |
| PASS | scene: references editor or viewer chunks | editor=true viewer=true |
| PASS | scene: no obvious error strings | clean |
| PASS | nope: 404 or Scene-not-found page | status=200 hasFallback=true |
| PASS | nope: does NOT initialize SceneLoader | not found |
| PASS | nope: does NOT contain Villa Azul |  |
| PASS | scenes: 200 status | got 200 |
| PASS | scenes: contains link /scene/a6e7919eacbe |  |
| PASS | scenes: contains 'Villa Azul' |  |
| PASS | scenes: >=1 <a href="/scene/..."> link | count=1 |

## Strings-found snapshot

### `/scene/a6e7919eacbe`

- SceneLoader present: true
- sceneId 'a6e7919eacbe' present: true
- 'Villa Azul' present: true
- editor chunk reference: true
- viewer chunk reference: true
- error strings found: none

### `/scene/nope`

- status: 200
- 'Scene not found' fallback: true
- SceneLoader NOT present: true
- 'Villa Azul' NOT present: true

### `/scenes`

- '/scene/a6e7919eacbe' link present: true
- 'Villa Azul' present: true
- <a href="/scene/..."> link count: 1

## Response times

- /scene/a6e7919eacbe: 58.3 ms
- /scene/nope: 23.8 ms
- /scenes: 20.9 ms
