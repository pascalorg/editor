export const meta = {
  name: 'bones-verify-loop',
  description: 'Parameterized adversarial verify loop: skeptic + optional visual QA + optional blueprint examiner',
  whenToUse: 'After any Bones change lands green: pass {sha, skeptic, visual?, examiner?} briefs via args',
  phases: [{ title: 'Verify', detail: 'parallel adversarial lenses' }],
}

// args: { sha: string, skeptic: string, visual?: string, examiner?: string }
// Each brief is JUST the change-specific part; boilerplate lives here.
const VERDICT = {
  type: 'object',
  required: ['verdict', 'notes'],
  properties: {
    verdict: { type: 'string', enum: ['PASS', 'FAIL', 'APPROVE', 'REVISE'] },
    notes: { type: 'array', items: { type: 'string' } },
    evidence: { type: 'array', items: { type: 'string' } },
  },
}

const REPO = '/Users/julien/Documents/GitHub/plugin-bones'
const COMMON = `Repo: ${REPO} at commit ${args.sha}. Read docs/plans/NIGHT-BOARD.md (loop rules) + review/CHECKLIST.md (invariants — cite rows). Never modify tracked files; scratch bun tests from the repo root are fine, delete after. Run the FULL suite at the end and report its exact counts. Return raw JSON only per your schema. FAIL/REVISE requires a concrete failing scenario or on-paper exhibit.`

const SKEPTIC_BOILER = `You are an adversarial code reviewer. ${COMMON}
Try to REFUTE the change with scratch tests; attack edge cases, cross-system interactions, and every invariant in CHECKLIST.md that the change touches. Change under review: `

const VISUAL_BOILER = `You are the Bones visual QA agent on http://localhost:3002 (dev server runs the sha under review). ${COMMON}
Scene building: POST /api/scenes cloning fc866f2f271b's graph (see /tmp/qa-plumbing/build_scene.py pattern); the host has a scene-wipe bug — GET after POST and re-PUT if empty. ONE Playwright session per scene (executablePath '/Users/julien/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell', run from /Users/julien/Documents/GitHub/private-editor), domcontentloaded + ~16s, Escape to clear tools, camera via window.__pascalCameraControls().setLookAt. Screenshots under /tmp/qa-loop/. LOOK yourself; adversarial: broken until a screenshot proves otherwise. Checks: `

const EXAMINER_BOILER = `You are the Bones BLUEPRINT examiner (protocol review/BLUEPRINTS.md; scorecards in review/scorecards/). ${COMMON}
Generate via pure buildPlanSet (bun harness on the fc866f2f271b graph + injected bones:framing with relevant systems; rasterize sheets with Playwright page.setContent — never open the editor) and LOOK at every affected sheet. Update/write the scorecard (commit NOTHING). Focus: `

phase('Verify')
const jobs = []
jobs.push(() => agent(SKEPTIC_BOILER + args.skeptic, { label: 'skeptic', schema: VERDICT }))
if (args.visual) jobs.push(() => agent(VISUAL_BOILER + args.visual, { label: 'visual', schema: VERDICT }))
if (args.examiner) jobs.push(() => agent(EXAMINER_BOILER + args.examiner, { label: 'examiner', schema: VERDICT }))
const results = await parallel(jobs)
return {
  skeptic: results[0] ?? { verdict: 'FAIL', notes: ['agent died'] },
  visual: args.visual ? (results[1] ?? { verdict: 'FAIL', notes: ['agent died'] }) : null,
  examiner: args.examiner ? (results[args.visual ? 2 : 1] ?? { verdict: 'REVISE', notes: ['agent died'] }) : null,
}
