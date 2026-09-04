export const formUxExampleRows = [
  {
    topic: 'Finance',
    without:
      'Budget value plus currency picker, rate value plus %/bps mode, settlement value plus duration unit.',
    lingoInputs: ['1250 usd', '25 bps', '2 days'],
    canonical: 'The app stores USD, percent, and days. Currency is built in; no live FX implied.',
  },
  {
    topic: 'Recipes',
    without:
      'Ingredient amount plus cup/mL/L picker, oil amount plus tsp/tbsp/mL picker, cook-time picker.',
    lingoInputs: ['1.5 cups', '2 tbsp', '45 min'],
    canonical: 'The app stores mL and minutes while accepting prep-sheet wording.',
  },
  {
    topic: 'Engineering',
    without: 'Clearance, pressure, axial load, and torque each require their own unit selector.',
    lingoInputs: ['3/4 in', '32 psi', '120 lbf', '35 Nm'],
    canonical: 'The app stores mm, kPa, N, and N⋅m. Force and torque are built in.',
  },
  {
    topic: 'Fitness',
    without: 'Body weight, distance, duration, and energy each carry a separate mode choice.',
    lingoInputs: ['165 lb', '5 km', '42 min', '450 Calories'],
    canonical: 'The app stores kg, meters, minutes, and kcal for analytics.',
  },
  {
    topic: 'Medical',
    without:
      'Dose volume, interval, height, and cuff pressure selectors create a noisy intake layout.',
    lingoInputs: ['1.5 tsp', '6 hr', '5\'11"', '120 mmHg'],
    canonical: 'The app stores field-local canonical values; medication units remain domain-owned.',
  },
] as const
