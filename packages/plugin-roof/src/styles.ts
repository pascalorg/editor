/**
 * The roof form each PlanCrafters style asks for (gen.js `STYLES`). The
 * gable / hip vocabulary per mass lives in derive.ts; this is only the
 * form the style starts from when the panel says "by style".
 */
import type { RoofForm } from './derive'

export const STYLE_ROOF_FORMS: readonly { key: string; label: string; form: RoofForm }[] = [
  { key: 'farmhouse', label: 'Farmhouse', form: 'gable' },
  { key: 'craftsman', label: 'Craftsman', form: 'gable' },
  { key: 'ranch', label: 'Ranch', form: 'hip' },
  { key: 'modern', label: 'Modern', form: 'hip' },
  { key: 'modern-mono', label: 'Modern (mono roof)', form: 'shed' },
  { key: 'cottage', label: 'Cottage', form: 'gable' },
]

export function styleRoofForm(style: string): RoofForm | null {
  return STYLE_ROOF_FORMS.find((s) => s.key === style.toLowerCase())?.form ?? null
}
