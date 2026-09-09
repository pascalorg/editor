# Publishing evaluation fixtures

`publishing-cases.json` is the minimum cross-skill release suite. It contains five positive cases and three negative or refusal-boundary cases. Each standalone skill also bundles:

- `evals/evals.json` for task behavior;
- `evals/trigger-evals.json` for description routing, with at least five positive and three negative queries.

These are fixtures for model evaluation. Their presence does not mean a native host has passed them; record those results separately when the release candidate is tested.
