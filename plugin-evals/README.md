# Publishing evaluation fixtures

`publishing-cases.json` is the draft cross-skill review suite for a future OpenAI **With MCP** submission. It contains at least five positive cases with expected result shapes, plus three negative or refusal-boundary cases with explicit reasons the plugin must not complete the requested action. `tool-annotation-justifications.json` records the exact three required hint values and a non-empty justification for every hint on all 46 expected MCP tools. Repository policy tests check its exact inventory and shape, and the live MCP regression test checks its values against `tools/list`.

The suite remains blocked until Pascal confirms an authorized verified OpenAI publisher identity, completes portal-token domain verification, passes Scan Tools against the production hosted endpoint, provisions OAuth-compatible reviewer access, and names disposable fixtures that reviewers can use without internal context. Each standalone skill also bundles:

- `evals/evals.json` for task behavior;
- `evals/trigger-evals.json` for description routing, with at least five positive and three negative queries.

The shared suite and annotation packet live outside `skills/` because they are submission evidence rather than skill runtime content. This repository state is preparation only: the draft cases are not reproducible reviewer materials yet, and no portal scan, domain verification, publisher verification, submission, approval, or publication is represented. Record those results separately after the blocked hosted-MCP prerequisites exist.
