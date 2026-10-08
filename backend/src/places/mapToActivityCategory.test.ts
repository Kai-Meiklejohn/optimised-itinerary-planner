import { describe, expect, it } from 'vitest'
import { mapToActivityCategory } from './mapToActivityCategory.js'

describe('mapToActivityCategory', () => {
  it('maps food-related categories to Food', () => {
    expect(mapToActivityCategory(['Restaurant'])).toBe('Food')
  })

  it('maps lodging categories to Stay', () => {
    expect(mapToActivityCategory(['Hotel'])).toBe('Stay')
  })

  it('maps transit categories to Transport', () => {
    expect(mapToActivityCategory(['Train Station'])).toBe('Transport')
  })

  it('falls back to Attraction for unrecognised but present categories', () => {
    expect(mapToActivityCategory(['Shrine'])).toBe('Attraction')
  })

  it('falls back to Other when there are no categories at all', () => {
    expect(mapToActivityCategory([])).toBe('Other')
  })
})
