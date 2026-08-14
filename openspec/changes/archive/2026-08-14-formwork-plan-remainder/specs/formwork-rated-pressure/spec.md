## Purpose

Designs proprietary panel systems the way their vendors publish them — against one rated pressure — and answers the question the site actually asks, which is not "does this pass" but "how fast may I pour".

## ADDED Requirements

### Requirement: A panel system is checked against its rated pressure

Where an element is formed with a panel system, the design SHALL compare the fresh-concrete pressure derived for that element's pour against the system's rated pressure, and SHALL report the comparison with both figures and the utilisation between them.

The system SHALL NOT apply the conventional-formwork component checks (sheeting, joist, waler, tie) to a panel system as though its parts were separately designable, because a rated panel's capacity is published for the assembly.

#### Scenario: A pour within the rated pressure passes with its utilisation stated

- **WHEN** the derived pressure for an element's pour is at or below the system's rated pressure
- **THEN** the check passes and reports the derived pressure, the rated pressure and the utilisation

#### Scenario: A pour above the rated pressure fails against the system, not against a component

- **WHEN** the derived pressure exceeds the rated pressure
- **THEN** the check fails, names the panel system and its rated pressure as the governing limit, and does not attribute the failure to a sheeting or tie component

#### Scenario: A panel system with no rated pressure is not designed

- **WHEN** the configured panel system carries no rated pressure
- **THEN** the check reports itself as not performed with the missing value named, and no pass is reported

### Requirement: The maximum permissible rise rate is solved for, not searched by the reader

For each pour formed with a panel system, the system SHALL derive the maximum rise rate at which the pour stays within the rated pressure, holding the pour's other conditions constant, and SHALL report it in the project's rate unit.

#### Scenario: A permissible rise rate is reported for every panel-formed pour

- **WHEN** a pour formed with a rated panel system is designed
- **THEN** the result states the maximum rise rate that keeps the derived pressure at or below the rated pressure, at the pour's stated temperature, consistency, cement type and admixture condition

#### Scenario: The reported rate is consistent with the pressure check

- **WHEN** a pour is designed at exactly the reported maximum rise rate
- **THEN** the pressure check passes at full utilisation, so the two results cannot contradict each other

#### Scenario: A pour that cannot satisfy the rating at any rate says so

- **WHEN** even the slowest meaningful rise rate leaves the derived pressure above the rated pressure — because the pour's full hydrostatic head alone exceeds it
- **THEN** the result states that no rise rate satisfies the rating, and names the lift height or the head as the reason rather than reporting a rate of zero without explanation

### Requirement: The permissible rate is reconciled with the project's stated rate and supply

Where the project states a rise rate, the result SHALL compare it with the permissible rate and name which governs. Where the project also states a concrete supply, the achievable rate SHALL be the lesser of the permissible rate and the supply-sustainable rate, and the governing constraint SHALL be named.

#### Scenario: The project pours slower than the panel permits

- **WHEN** the project's stated rise rate is below the permissible rate
- **THEN** the design uses the stated rate, reports the headroom, and names the project's rate as governing

#### Scenario: The project pours faster than the panel permits

- **WHEN** the project's stated rise rate exceeds the permissible rate
- **THEN** the check fails, and the result states the rate the pour must be slowed to

#### Scenario: Supply is the binding constraint

- **WHEN** the panel permits a faster rise than the stated pump or plant output can deliver
- **THEN** the achievable rate is the supply rate and supply is named as governing
