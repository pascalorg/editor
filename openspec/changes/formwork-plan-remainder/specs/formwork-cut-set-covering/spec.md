## Purpose

Chooses the boards to buy rather than accepting the first list that fits: a search across the sheet sizes a project can actually source, with the saw's own waste counted, so the cut sheet is the cheapest one available and not merely a feasible one.

## ADDED Requirements

### Requirement: The cut solution is searched across the available sheet sizes

Where a project states more than one purchasable sheet size, the system SHALL search combinations of those sizes for the cut solution and SHALL select on a stated objective, rather than trying the sizes in a fixed preference order and accepting the first that fits.

The result SHALL state the objective used, the sizes chosen with their counts, and the offcut area, so a reader can see what the choice bought them.

#### Scenario: A mix beats any single size and is chosen

- **WHEN** a project's pieces are covered with less waste by combining two stated sheet sizes than by any one size alone
- **THEN** the solution uses the mix, and reports the counts per size and the offcut area

#### Scenario: The objective is stated and honoured

- **WHEN** the objective is least cost and the least-waste solution is more expensive because the smaller sheet costs disproportionately more per area
- **THEN** the least-cost solution is chosen, and the result states the objective and reports the waste it accepted

#### Scenario: A single stated size behaves as it does today

- **WHEN** only one sheet size is stated
- **THEN** the solution is the single-size solution, unchanged from today's result

#### Scenario: A piece no stated sheet can contain is reported, not silently dropped

- **WHEN** a required piece exceeds every stated sheet size in some dimension
- **THEN** the piece is reported as uncuttable with its dimensions and the largest stated sheet named, and it is excluded from the counts rather than being absent without explanation

### Requirement: Repeated floors are covered once and re-used, not re-solved per floor

Where the same cut piece set recurs across floors, the system SHALL cover the repetition as one problem and report the sheets required per cycle and the reuse assumed, rather than solving each floor independently and multiplying.

#### Scenario: A repeated floor buys one set of boards

- **WHEN** several floors need identical cut pieces and the sheeting is reused between them
- **THEN** the purchase quantity reflects one set plus the replacements the stated sheet life implies, not one set per floor

#### Scenario: The reuse assumed is stated

- **WHEN** a repeated-floor solution is reported
- **THEN** it states how many cycles the sheets are assumed to serve and what that assumption came from, so a reader can challenge it

### Requirement: Trim allowance is counted per cut edge

The system SHALL apply a stated trim or saw allowance per cut edge when placing pieces on a sheet, so that the number of sheets reflects the material the saw removes.

#### Scenario: Trim allowance changes the sheet count where it must

- **WHEN** pieces fit a sheet exactly at zero allowance and a non-zero per-edge allowance is stated
- **THEN** the placement respects the allowance and the sheet count rises accordingly

#### Scenario: The allowance is reported with the waste

- **WHEN** a cut solution with a trim allowance is reported
- **THEN** the offcut area distinguishes the material lost to trim from the material lost to unused sheet area

#### Scenario: No stated allowance means none applied

- **WHEN** no trim allowance is stated
- **THEN** none is applied and the result says so, rather than assuming a saw kerf on the project's behalf
