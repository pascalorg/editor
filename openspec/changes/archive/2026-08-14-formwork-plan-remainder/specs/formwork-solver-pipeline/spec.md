## Purpose

Makes the whole-project formwork answer one thing rather than a dozen: a single pure derivation from scene, project settings and catalog to one solution value that every panel, report, drawing and AI tool reads.

## ADDED Requirements

### Requirement: One pure derivation produces the whole solution

The system SHALL expose a single derivation from `(scene, project settings, catalog)` to one formwork solution value covering geometry, pressure, panel layout, sheet cutting, accessories, sequence, striking, quantities, cost and validation.

The derivation SHALL be pure: identical inputs produce an identical solution, with no dependence on wall-clock time, ambient locale, filesystem, network, or any editor or renderer state. Every date-dependent result SHALL be derived from dates carried in the inputs.

#### Scenario: The same inputs always produce the same solution

- **WHEN** the derivation runs twice over identical inputs
- **THEN** the two solutions are equal in every reported field, including every quantity, cost, date and finding

#### Scenario: Every surface reads the same solution

- **WHEN** a project's takeoff, design report, cut sheet, elevation, buildability findings and AI reads are produced
- **THEN** each is derived from this one solution rather than from an independent traversal, so no two surfaces can disagree about a quantity for the same inputs

#### Scenario: A phase that cannot run leaves a stated gap, not a guess

- **WHEN** an input a phase needs is absent (no cast order, no rate, no catalog entry)
- **THEN** the solution reports that phase's output as unavailable with the missing input named, and downstream phases that depend on it do the same
- **AND** no default is silently substituted for a project-specific input

### Requirement: Degenerate geometry is rejected before it is designed

The derivation SHALL reject geometry it cannot form, before any pressure or layout result is produced for it, and SHALL report each rejection against the element with the reason. It SHALL NOT emit a quantity, cost or drawing for a rejected element.

#### Scenario: Elements below formable dimensions are rejected

- **WHEN** an element has a zero or negative dimension, a thickness or a height below the minimum the configured system can form, or a self-intersecting footprint
- **THEN** it appears in the solution as rejected with the reason, and contributes nothing to any quantity or total
- **AND** the project total states how many elements were rejected, so a short total is not read as a cheap one

#### Scenario: A rejected element does not stop the project

- **WHEN** one element is rejected and the rest are formable
- **THEN** the rest are solved and reported normally

### Requirement: Topology is carried on the solution, not only re-derived by checks

The solution SHALL carry each element's formwork topology — which faces are formed, which are cast against existing work or earth, where it meets another element, and which meetings are shared or double-formed — so that every consumer reads the same topology.

#### Scenario: A shared face is formed once

- **WHEN** two elements meet at a face that one form serves
- **THEN** the solution records the meeting and the face is counted once in the area, the panels and the cost

#### Scenario: A face cast against earth or existing concrete is not formed

- **WHEN** an element face is against earth, rock, an existing structure or blinding
- **THEN** the solution records the face as unformed with that reason, and it appears in no panel layout and no area total

### Requirement: Permitted construction joints are project data, not a solver preference

Where a construction or pour joint may be placed SHALL be expressible as project data: a set of permitted elevations or positions, per element or per storey, that the pour-splitting phase respects.

#### Scenario: A pour split respects the stated joints

- **WHEN** permitted joint elevations are stated and an element must be cast in more than one lift
- **THEN** every lift boundary is at a permitted elevation, and each lift's height is reported against the joint it used

#### Scenario: An element whose limits cannot be met at a permitted joint says so

- **WHEN** no permitted joint satisfies the element's pour limits
- **THEN** the solution reports the conflict, names both the limit and the permitted joints, and does not silently place a joint where none is permitted

#### Scenario: No stated joints means the solver's own split, labelled as such

- **WHEN** no permitted joints are stated
- **THEN** the split is derived from the pour limits and each boundary is labelled as solver-chosen rather than as a project decision

### Requirement: Placing rate is checked against what the site can actually pour

The pressure phase SHALL check the rise rate it designs against the project's stated concrete supply — batch plant output, pump rate, or both — and SHALL report the governing constraint. Where the supply cannot sustain the designed rise rate, the design SHALL be reported as unachievable rather than merely conservative.

#### Scenario: Supply cannot sustain the designed rise rate

- **WHEN** the stated pump rate or plant output cannot deliver the volume the designed rise rate requires for an element's plan area
- **THEN** the solution reports the rise rate the supply can actually sustain, names supply as the governing constraint, and marks the designed rate as unachievable

#### Scenario: Alternate-bay construction is respected in the sequence

- **WHEN** a project or element states alternate-bay construction
- **THEN** the sequence phase produces a bay order in which no two adjacent bays are cast in the same interval, and reports the parity it used

#### Scenario: No stated supply is an absence, not an assumption

- **WHEN** neither a plant output nor a pump rate is stated
- **THEN** the supply check is reported as not performed with the missing input named, and no rate is assumed on the project's behalf

### Requirement: Striking may be governed by strength as well as by elapsed time

The striking phase SHALL support a strength-based criterion — a required concrete strength or maturity at strike — alongside the elapsed-time criterion, and SHALL report which criterion governs each strike.

#### Scenario: Strength governs the strike

- **WHEN** a strength or maturity criterion is stated and the accumulated maturity reaches it later than the elapsed-time table would allow the strike
- **THEN** the strike date is the strength-governed date, and the solution names strength as governing and states the accumulated maturity at that date

#### Scenario: Time governs the strike

- **WHEN** the elapsed-time criterion is the later of the two
- **THEN** the strike date is the time-governed date and time is named as governing

#### Scenario: A strength criterion without the inputs to evaluate it is not silently dropped

- **WHEN** a strength criterion is stated but the cement class, curing temperature history or strength class needed to evaluate it is missing
- **THEN** the strike falls back to the elapsed-time criterion, and the solution states that the strength criterion could not be evaluated and names the missing input
