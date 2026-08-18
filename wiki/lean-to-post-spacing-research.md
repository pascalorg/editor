# Lean-to post spacing research

This note records the basis for Pascal's automatic lean-to post layout default.

## Findings

- Municipal patio-cover guides treat post spacing as a beam/span design input, not a single universal code value.
- City of La Habra's standard open patio-cover guide includes header tables across post spacings from 6 ft to 20 ft.
- The same La Habra guide warns that rafters spanning more than 8 ft may permanently deflect unless larger lumber is used.
- City of San Diego's patio-cover bulletin defines patio covers as open, one-story accessory structures and ties post sizing to height, while directing custom designs to show framing/foundation details and structural calculations.

## Product default

Use 3.0 m, approximately 10 ft, as the automatic target post spacing for generated lean-to extensions.

This is a visual/planning default, not a structural-code guarantee. It keeps generated spans in the common municipal table range, avoids the clutter of very close spacing, and avoids the heavier-beam implication of wider spacing above roughly 12 ft.

Automatic generation should always include end posts. Intermediate posts are inserted so no bay is larger than the target spacing.

## Sources

- City of La Habra, `Standard Open Patio Cover Requirements`: post-spacing tables include 6 ft, 8 ft, 10 ft, and larger spacings; the guide also warns about objectionable deflection beyond 8 ft rafter spans. https://www.lahabraca.gov/DocumentCenter/View/91/Standard-Open-Patio-Cover-PDF
- City of San Diego, Information Bulletin 206 `Patio Covers`, March 2026: patio covers are open accessory structures, and plans must show framing/foundation details when using custom designs. https://www.sandiego.gov/development-services/forms-publications/information-bulletins/206
- City of Escondido, `Solid Roof Patio Cover`: beam and post spacing are design-table variables dependent on roof span, roof load, lumber, and footing assumptions. https://www.escondido.gov/DocumentCenter/View/457/8B---Solid-Roof-Patio-Cover-PDF
