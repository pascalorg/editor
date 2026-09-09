# Publishing evaluation fixtures

`publishing-cases.json` is the draft cross-skill review suite for a future OpenAI **With MCP** submission. It contains at least five positive cases with expected result shapes, plus three negative or refusal-boundary cases with explicit reasons the plugin must not complete the requested action. The suite is blocked until Pascal provisions a stable hosted MCP review environment, OAuth-compatible reviewer access, and named disposable fixtures that reviewers can use without internal context. Each standalone skill also bundles:

- `evals/evals.json` for task behavior;
- `evals/trigger-evals.json` for description routing, with at least five positive and three negative queries.

The shared suite lives outside `skills/` because it is release evidence rather than skill runtime content. These draft cases are not reproducible reviewer materials yet, and their presence does not mean a native host or OpenAI portal scan has passed them. Record those results separately after the blocked hosted-MCP prerequisites exist.
