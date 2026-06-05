import { expect, test } from 'bun:test'
import { VELVET_CORE_VERSION } from '../src/index.ts'

test('core package resolves', () => {
  expect(VELVET_CORE_VERSION).toBe('0.0.0')
})
