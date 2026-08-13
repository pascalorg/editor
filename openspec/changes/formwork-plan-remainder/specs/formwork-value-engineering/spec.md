## Purpose

Names the cheaper way to form the same building: a saving is a substitution the takeoff can price against the design it already solved, offered as a proposal the reader can take whole and then have measured.

## ADDED Requirements

### Requirement: A saving is a priced, keyed, self-describing proposal

A saving proposal SHALL state the change it proposes, the money it claims, and what the reader gives up to get it. It SHALL carry a stable key formed only from the decision — never from the figures — so that a proposal restated after the scene changed is recognisable as the same proposal, and a proposal whose figures moved is still the same offer.

The system SHALL NOT present a saving whose claimed money it cannot derive from the same cost model that produces the printed total. A figure the totals cannot reproduce is a figure that will be quoted at a client and then not appear on the invoice.

#### Scenario: Every proposal prices the trade-off it asks for

- **WHEN** the takeoff is read for a project whose design admits a cheaper alternative
- **THEN** each saving proposal states the target it changes, the alternative it proposes, the saving in the project's currency, and the consequence of accepting it in the reader's own units (added cycle days, added labour hours, a reduced finish class, or a wider tie grid)
- **AND** the sum of the claimed savings is not presented as an achievable total, because proposals may be mutually exclusive

#### Scenario: A proposal whose figures changed keeps its key

- **WHEN** a saving is proposed, the project's rates are then edited, and the takeoff is read again
- **THEN** the same proposal is offered under the same key with the new money
- **AND** taking it by that key is accepted

#### Scenario: A proposal whose decision no longer applies is gone rather than restated

- **WHEN** the change a saving proposed has already been made by other means
- **THEN** that proposal is absent from the next read, and its key is refused with a reason naming it as superseded rather than as invalid input

### Requirement: The saving classes the system offers

The system SHALL derive saving proposals from at least these classes, and SHALL identify the class on each proposal so a reader can filter by what they are willing to trade:

- **Reuse** — a longer hire or a later strike that lets one set of formwork serve more pours, priced against the peak it lowers.
- **Substitution** — a cheaper panel system, sheet grade, or beam section that still satisfies every design check.
- **Grid relaxation** — a wider tie or prop spacing that remains within permissible limits, priced as the ties, props and labour it removes.
- **Cycle** — a resequencing that lowers a peak, which is the already-shipped resequencing proposal reported in money rather than only in pieces.
- **Standardisation** — collapsing near-identical panel or cut marks onto one mark, priced as the offcut and the setting-out time it removes.

#### Scenario: A saving that would break a design check is not offered

- **WHEN** a substitution or a grid relaxation would fail any pressure, deflection, bending, shear or bearing check the design already applies
- **THEN** that proposal is not offered at all, at any price
- **AND** it is not offered as a proposal with a warning attached, because a priced offer the reader can accept is not the place to disclose non-compliance

#### Scenario: The reader can see why a class produced nothing

- **WHEN** a project admits no saving in a class
- **THEN** the read says so for that class, distinguishing "nothing cheaper exists here" from "this class could not be evaluated because an input is missing", and names the missing input in the second case

### Requirement: Taking a saving is one operation, and it is not a purchase

Accepting a saving SHALL apply the whole change or none of it. Where a proposal spans several elements, marks or pours, a partial application SHALL be refused rather than performed, because a half-applied substitution prices as neither the old design nor the new one.

Accepting a saving SHALL NOT commit, order, or book anything. It records a design decision; the commitment to a supplier remains a separate act.

#### Scenario: A saving is taken by key and applies whole

- **WHEN** the reader accepts a saving by its key
- **THEN** every element the proposal named is changed, in one undoable step on the editor surface
- **AND** nothing is marked as committed, hired or ordered as a result

#### Scenario: A stale key is refused rather than applied

- **WHEN** a key from an earlier read is submitted after the design changed such that the proposal no longer exists
- **THEN** the operation is refused with a reason naming the key as superseded
- **AND** nothing in the scene is modified

#### Scenario: A saving spanning several members cannot be half-applied

- **WHEN** a proposal names several elements and one of them can no longer take the change
- **THEN** the whole operation is refused and named as such, and no element is changed

### Requirement: A taken saving is judged by a second measurement, not by its own claim

After a saving is applied, the system SHALL re-derive the cost from the changed scene and report the measured saving beside the saving that was predicted. Where the two disagree, the measurement SHALL be presented as the answer, in either direction.

#### Scenario: A measured saving smaller than predicted is reported as such

- **WHEN** an applied saving turns out to be worth less than its proposal claimed
- **THEN** both figures are reported, the measured one is identified as the answer, and the disagreement is stated

#### Scenario: A measured saving larger than predicted is reported the same way

- **WHEN** an applied saving turns out to be worth more than its proposal claimed
- **THEN** the disagreement is reported with the same prominence as an under-delivery, because a sweep that was wrong in the reader's favour is the same fault

#### Scenario: A saving that could not be re-measured is unmeasured, not confirmed

- **WHEN** the second derivation cannot be completed (an input became invalid, or the scene no longer solves)
- **THEN** the result states that the saving is unmeasured, and does not report the predicted figure as though it were confirmed

### Requirement: Savings are available on every surface, at parity

The saving read and the operation that takes it SHALL be available on the editor's takeoff panel, the editor's AI chat, and the MCP tool surface, with the same keys, the same wording for refusals, and the same measured-versus-predicted report.

#### Scenario: The same project yields the same savings on all three surfaces

- **WHEN** the same project is read for savings through the panel, the chat and MCP
- **THEN** the proposals, their keys, their claimed money and their stated trade-offs are identical
- **AND** a key produced by one surface is accepted by the other two
