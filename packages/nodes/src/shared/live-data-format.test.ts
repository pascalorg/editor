import { expect, test } from 'bun:test'
import {
  formatLiveDataPathOption,
  formatLiveDataPathValue,
  numericLiveDataPathValue,
  renderLiveDataPathTemplate,
} from './live-data-format'

const paths = [
  { path: 'factory.pipe.flow', label: 'Pipe flow', valueType: 'number' as const, unit: 'm³/h' },
  { path: 'factory.status', label: 'Status', valueType: 'string' as const },
]

const values = {
  'factory.pipe.flow': 42,
  'factory.status': 'running',
}

test('formats live data path options with current values', () => {
  expect(formatLiveDataPathOption(paths, values, 'factory.pipe.flow')).toBe('Pipe flow (42 m³/h)')
})

test('renders live data templates from paths and values', () => {
  expect(
    renderLiveDataPathTemplate({
      path: 'factory.pipe.flow',
      paths,
      template: '{label}: {value}{unit}',
      values,
    }),
  ).toBe('Pipe flow: 42 m³/h')
})

test('handles missing live values as unknown', () => {
  expect(formatLiveDataPathValue(paths, values, 'factory.missing')).toBe('?')
  expect(numericLiveDataPathValue(values, 'factory.missing')).toBe(0)
})
