## Purpose

Keeps every number in a formwork answer honest about where it came from: which published clause, or which reverse-engineered guess, so that a figure taken to an engineer or a client is never presented as certified when nobody has read the standard behind it.

## ADDED Requirements

### Requirement: Every design constant declares its provenance and verification level

Every constant, coefficient and tabulated value used in a formwork design SHALL declare its source and a verification level of `certified`, `derived` or `unverified`.

`certified` SHALL require a citation identifying the document, its edition or year, and the clause, table or figure the value was transcribed from. `derived` SHALL require the cited inputs and the method. `unverified` SHALL require a statement of how the value was arrived at and what would be needed to certify it.

#### Scenario: A constant without a source cannot be used

- **WHEN** a design constant carries no declared source
- **THEN** it is not usable in a design, and the check depending on it reports itself as not performed

#### Scenario: A certified constant names document, edition and clause

- **WHEN** a constant is declared `certified`
- **THEN** its citation names the document, the edition or year, and the clause, table or figure

#### Scenario: An unverified constant names what would certify it

- **WHEN** a constant is declared `unverified`
- **THEN** it states how it was arrived at and the document that would certify it, so the gap is actionable rather than merely disclosed

### Requirement: A result inherits the weakest verification level it depends on

Any design value, quantity, cost, finding, drawing or AI reply SHALL report the weakest verification level among the constants it depends on, and SHALL name the constants at that level.

#### Scenario: One unverified input makes the result unverified

- **WHEN** a design check depends on five certified constants and one unverified one
- **THEN** the check's result is reported as `unverified` and names the unverified constant

#### Scenario: A total inherits from its lines

- **WHEN** a project total is composed of lines of differing verification levels
- **THEN** the total reports the weakest level present and names the elements or constants responsible

#### Scenario: The AI surfaces carry the level, not only the number

- **WHEN** a design figure is returned through the editor's chat or the MCP tools
- **THEN** the reply carries the verification level and the constants at it, in the same terms the panel uses

### Requirement: A printed or exported document states its verification level

Every design report, cut sheet, elevation, bill and export SHALL state the verification level of the figures it contains, and SHALL NOT present an `unverified` figure without that statement on the same document.

#### Scenario: A design report carrying unverified figures says so on its face

- **WHEN** a design report is produced from a design depending on unverified constants
- **THEN** the report states that it contains unverified figures and lists them, on the document rather than only in the application

#### Scenario: A fully certified document says that too

- **WHEN** every constant a document depends on is `certified`
- **THEN** the document states that its figures are certified and lists the documents cited

### Requirement: Certifying a constant changes its level and is visible, and may change the number

Replacing an `unverified` constant with a transcribed published value SHALL update its level and citation, and where the published value differs from the provisional one the change in every affected result SHALL be visible rather than silent.

#### Scenario: A newly certified value that differs is surfaced

- **WHEN** an unverified constant is replaced by a certified value that differs from it
- **THEN** the results that depended on it change accordingly, and the change is attributable to the certification rather than appearing as an unexplained shift

#### Scenario: Certification never loosens a limit without saying so

- **WHEN** certification replaces a conservative provisional value with a less conservative published one
- **THEN** the affected checks report that a previously failing or marginal condition now passes because of the certification, naming the constant
