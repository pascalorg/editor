## Purpose

Turns the registered-but-empty formwork catalog into one a project can actually be designed against: real panel systems, sheet grades and beam sections, each carrying the citation and the verification level that says how much its numbers can be trusted.

## ADDED Requirements

### Requirement: A registered system with no data is reported as unavailable, never designed against

Where a formwork system, sheet grade or beam section is registered by identifier but carries no design data, the system SHALL refuse to design against it and SHALL name it as unseeded. It SHALL NOT substitute another entry's data, and SHALL NOT fall back to a generic value.

#### Scenario: Selecting an unseeded system refuses rather than approximates

- **WHEN** an element is configured to use a registered but unseeded panel system
- **THEN** the solution reports the element as undesignable with the unseeded identifier named
- **AND** no panel layout, quantity or cost is produced for it

#### Scenario: The available systems can be listed with their state

- **WHEN** the selectable systems are read on any surface
- **THEN** each is reported with whether it is seeded, and an unseeded one is presented as unavailable rather than offered as a choice

### Requirement: A seeded entry carries its numbers, its source and its verification level

Every seeded catalog entry SHALL carry, for each design value it publishes: the value with its unit, the source it came from (a named standard clause, a named vendor document, or a stated derivation), and a verification level of `certified`, `derived` or `unverified`.

`certified` SHALL mean the value is transcribed from the cited published document. `derived` SHALL mean it is computed from cited values by a stated method. `unverified` SHALL mean neither, and the value is provisional.

#### Scenario: Every published design value is attributable

- **WHEN** a catalog entry is read
- **THEN** each design value carries a source and a verification level, and no value is published without both

#### Scenario: An unverified value is reported wherever it reaches a result

- **WHEN** a design, quantity, cost or drawing depends on an `unverified` value
- **THEN** the result names the value and its verification level, so no figure resting on a provisional number is presented as certified

### Requirement: Panel systems carry a rated pressure and a panel range

A seeded panel system SHALL carry its rated fresh-concrete pressure, its panel sizes with weights, its tie arrangement, and the accessories a layout of it requires. A system missing its rated pressure SHALL be treated as unseeded rather than as a system with no pressure limit.

#### Scenario: A panel system with no rated pressure is unseeded

- **WHEN** a panel system carries sizes and weights but no rated pressure
- **THEN** it is reported as unseeded, because a system with no stated limit would pass every pressure check

#### Scenario: Panel sizes drive the layout and the weight

- **WHEN** a seeded panel system is used
- **THEN** the layout uses only its stated panel sizes, and the reported weight per lift is the sum of the stated panel and accessory weights

### Requirement: Sheet grades carry design values in the project's unit system

A seeded sheeting grade SHALL carry the bending strength, shear strength, stiffness and thickness needed by the deflection and bending checks, in the unit system the check is performed in. Where a grade's published values exist only in another unit system, the converted values SHALL be recorded as `derived` with the conversion stated.

#### Scenario: A grade lacking a value needed by a check is unseeded for that check

- **WHEN** a sheeting grade is missing a value a design check requires
- **THEN** the check reports itself as not performed with the missing value named, rather than assuming a value

#### Scenario: Converted values are marked derived

- **WHEN** a grade's design values were converted from another unit system or another standard's basis
- **THEN** each converted value is marked `derived` and states the source values and the conversion

### Requirement: Conflicting published capacities are reported, not resolved silently

Where two cited sources give conflicting capacities for the same catalog entry — for instance a permissible-stress value and a limit-state design value for the same beam — the entry SHALL record both with their sources, SHALL state which basis the design uses, and SHALL report the conflict wherever the value governs a result.

#### Scenario: A beam with two published capacities states which it used

- **WHEN** a beam section carries both a permissible and a design capacity from different sources, and a check is governed by it
- **THEN** the result names the basis used, reports the other value with its source, and states that the two sources disagree

#### Scenario: An unresolved conflict does not silently pick the higher value

- **WHEN** such a conflict is unresolved
- **THEN** the design uses the more conservative of the two and says so
