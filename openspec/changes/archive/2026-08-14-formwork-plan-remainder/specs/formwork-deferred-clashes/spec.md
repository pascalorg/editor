## Purpose

Closes the three buildability checks the model cannot currently answer — ties against reinforcement, props against the slab they stand on, and scaffold against the site boundary — each of which needs geometry the scene does not yet carry.

## ADDED Requirements

### Requirement: A check blocked on missing geometry is reported as not performed

Where a clash check requires geometry or capacity the scene does not carry, the validation result SHALL report that check as not performed, name the missing input, and name the elements it would have covered. It SHALL NOT report a clean result for a check it could not run.

#### Scenario: A project with no reinforcement gets no tie-clash verdict

- **WHEN** buildability is validated on a project carrying no reinforcement data
- **THEN** the tie-versus-reinforcement check is reported as not performed with reinforcement named as the missing input
- **AND** the overall verdict does not present the project as free of tie clashes

#### Scenario: A partially populated project runs the check where it can

- **WHEN** some elements carry the required data and others do not
- **THEN** the check runs on the elements that carry it, and reports the remainder as not covered with the element identifiers listed

### Requirement: Ties are checked against reinforcement

Given reinforcement geometry for an element — bar positions or a bar arrangement from which positions derive, with diameters and cover — the system SHALL check each tie position against it and report every tie that cannot pass through the cage.

A tie SHALL be reported as clashing when its hole, at its stated diameter plus the required clearance, intersects a bar. Where a clashing tie can be relocated within the permissible tie grid, the finding SHALL state a permissible alternative position; where it cannot, the finding SHALL say so.

#### Scenario: A tie fouling a bar is reported with an alternative

- **WHEN** a tie position intersects a reinforcing bar and the permissible grid admits a clear position nearby
- **THEN** the finding names the tie, the bar it fouls, and the clear position it may move to

#### Scenario: A tie fouling a bar with nowhere to go is reported as unresolvable

- **WHEN** no permissible position clears the cage
- **THEN** the finding says the tie cannot be relocated within the permissible grid, and names what would have to change (the grid, the bar arrangement, or the formwork system)

#### Scenario: Congestion is reported as a count, not only as individual findings

- **WHEN** more than one tie on an element clashes
- **THEN** the result states how many of the element's ties clash, so an element whose cage is broadly incompatible reads differently from one with a single awkward tie

### Requirement: Props are checked against the capacity of what they stand on

Given a load capacity for the slab, deck or ground a prop bears on, the system SHALL check the prop reaction against it and report every location where the reaction exceeds the capacity.

The check SHALL report the prop reaction, the available capacity and the utilisation, and SHALL account for a prop that lands on a slab that is itself still supported (backpropping) by reporting the storeys the load passes through.

#### Scenario: A prop overloading the slab below is reported

- **WHEN** a prop's reaction exceeds the stated capacity of the slab it bears on
- **THEN** the finding names the prop location, the reaction, the capacity, the utilisation and the slab

#### Scenario: Backpropping is reported through the storeys it loads

- **WHEN** a prop bears on a slab whose own formwork is still in place
- **THEN** the result names each storey the load is carried through and the utilisation at each

#### Scenario: A slab with no stated capacity blocks the check for it

- **WHEN** the supporting slab carries no load capacity
- **THEN** the check is reported as not performed for props bearing on it, with capacity named as the missing input

### Requirement: Formwork and scaffold are checked against the site boundary

Given a site boundary, the system SHALL report every part of the formwork, its access scaffold, and its working and striking clearances that falls outside the boundary, or within a stated setback of it.

#### Scenario: Access scaffold crossing the boundary is reported

- **WHEN** the scaffold or working clearance needed to erect or strike an element extends beyond the site boundary
- **THEN** the finding names the element, what extends past the boundary, and by how much

#### Scenario: A setback is honoured as a limit in its own right

- **WHEN** a setback is stated inside the boundary and formwork or scaffold encroaches on it without crossing the boundary itself
- **THEN** the encroachment is reported as a distinct finding from a boundary crossing

#### Scenario: A project with no boundary blocks the check

- **WHEN** the project carries no site boundary
- **THEN** the check is reported as not performed with the boundary named as the missing input, and the project is not reported as clear of boundary conflicts

### Requirement: The inputs these checks need are project data, and adding them changes nothing else

The reinforcement geometry, supporting-element capacity and site boundary these checks require SHALL be expressible as project data. A project that does not state them SHALL behave exactly as it does today in every other respect: the same quantities, costs, dates and findings.

#### Scenario: Existing projects are unaffected

- **WHEN** a project saved before these inputs existed is opened and solved
- **THEN** every quantity, cost, date and existing finding is unchanged, and only the three new checks report themselves as not performed
