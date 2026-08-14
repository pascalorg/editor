# Formwork Asset Amortisation Specification

## Purpose

Charges owned formwork the way an owner actually loses money on it — a share of its purchase price per use, against a life and a residual value — and reports the cost of the money tied up in the job, both without disturbing the cash total.

## Requirements

### Requirement: Owned formwork is charged per use against a stated life

An owned formwork asset SHALL be able to carry a purchase price, an expected number of uses over its life, and a residual value. Where it does, the system SHALL charge each use a cost derived from those, and SHALL report the derivation.

An asset that does not carry a life SHALL continue to be charged as it is today, and the result SHALL name the charge basis so the reader can tell an amortised charge from an internal recharge.

#### Scenario: An asset with a life is amortised per use

- **WHEN** an owned asset carries a purchase price, an expected life in uses and a residual value, and is used a stated number of times on the project
- **THEN** the reported cost is the per-use charge multiplied by the uses, and the result states the price, the life, the residual value and the per-use figure

#### Scenario: An asset with no life keeps today's charge, labelled

- **WHEN** an owned asset carries no expected life
- **THEN** it is charged at the existing internal-recharge rate, and the result names that basis rather than presenting it as amortisation

#### Scenario: Owning is never free

- **WHEN** any owned asset is used on the project
- **THEN** a non-zero cost is attributed to it under one of the two bases, and no owned item appears in a total at zero

### Requirement: Life is expressible on every kind of asset, not only on sheets

Expected life, purchase price and residual value SHALL be expressible on every formwork asset class the takeoff prices — panels, sheeting, beams, props, ties and accessories — not only on sheet stock.

#### Scenario: A panel type carries a life

- **WHEN** a panel type states a purchase price and an expected number of uses
- **THEN** its per-use charge appears in the bill on the same basis as a sheet's

#### Scenario: A mixed project reports both bases without mixing them into one figure

- **WHEN** a project uses some assets with a stated life and some without
- **THEN** the bill reports the amortised charges and the recharge charges as distinguishable lines, and the total states that it combines both bases

### Requirement: An asset used beyond its stated life is reported, not silently re-charged

Where the project's use of an asset exceeds its stated expected life, the system SHALL report the overrun rather than continuing to charge per use as though the life were unbounded.

#### Scenario: Uses exceed the stated life

- **WHEN** the project's uses of an asset exceed its expected life
- **THEN** the result reports the overrun, states the uses and the life, and names the replacement the overrun implies

### Requirement: Finance cost is reported outside the cash total

The system SHALL be able to report the cost of capital on the money the formwork ties up — a finance rate applied over the period between spend and recovery — and SHALL report it outside and beside the cash total, never folded into it.

#### Scenario: Finance is reported alongside, never inside

- **WHEN** a finance rate is stated and the project's formwork spend is spread over a programme
- **THEN** the finance cost is reported as a separate figure beside the cash total, and the cash total is unchanged by its presence

#### Scenario: No finance rate means no finance figure

- **WHEN** no finance rate is stated
- **THEN** no finance cost is reported and no rate is assumed

#### Scenario: A finance figure states the period it was computed over

- **WHEN** a finance cost is reported
- **THEN** it states the rate and the period, and where the period derives from undated pours it says which pours were undated and were therefore excluded
