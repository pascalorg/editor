export function parseMeasurement(input: string, unit: 'metric' | 'imperial'): number | null {
  if (unit === 'metric') {
    const val = Number.parseFloat(input)
    return Number.isNaN(val) ? null : val
  }

  // Handle imperial format: e.g., 10, 10', 10' 6", 6"
  const feetInchesRegex = /^\s*(?:(\d+(?:\.\d+)?)\s*')?\s*(?:(\d+(?:\.\d+)?)\s*")?\s*$/
  const match = input.match(feetInchesRegex)

  if (match) {
    if (!match[1] && !match[2]) {
      // It's just a raw number like "10" or "5.5"
      const val = Number.parseFloat(input)
      if (Number.isNaN(val)) return null
      return val / 3.28084
    }

    const feet = match[1] ? Number.parseFloat(match[1]) : 0
    const inches = match[2] ? Number.parseFloat(match[2]) : 0

    const totalFeet = feet + inches / 12
    return totalFeet / 3.28084
  }

  return null
}

export function formatMeasurement(valueInMeters: number, unit: 'metric' | 'imperial', precision = 2): string {
  if (unit === 'metric') {
    return Number.parseFloat(valueInMeters.toFixed(precision)).toFixed(precision)
  }

  const feet = valueInMeters * 3.28084
  const wholeFeet = Math.floor(feet)
  const inches = Math.round((feet - wholeFeet) * 12)

  if (inches === 12) return `${wholeFeet + 1}'0"`
  if (wholeFeet === 0) return `${inches}"`
  if (inches === 0) return `${wholeFeet}'`
  return `${wholeFeet}'${inches}"`
}
