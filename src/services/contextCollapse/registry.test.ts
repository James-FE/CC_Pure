import { beforeEach, describe, expect, test } from 'bun:test'
import {
  clearSummaryRegistry,
  getCollapseIdForSummary,
  getSummaryUuidForCollapse,
  nextCollapseId,
  peekCollapseIdCounter,
  registerSummary,
  reseedCollapseIdCounter,
} from './registry.js'

describe('context collapse summary registry', () => {
  beforeEach(() => {
    clearSummaryRegistry()
  })

  test('nextCollapseId is monotonic and 16-digit zero-padded', () => {
    expect(nextCollapseId()).toBe('0000000000000001')
    expect(nextCollapseId()).toBe('0000000000000002')
    expect(nextCollapseId()).toBe('0000000000000003')
  })

  test('registerSummary round-trips from summary uuid to collapse id', () => {
    registerSummary('summary-uuid', '0000000000000042')

    expect(getCollapseIdForSummary('summary-uuid')).toBe('0000000000000042')
  })

  test('registerSummary round-trips from collapse id to summary uuid', () => {
    registerSummary('summary-uuid', '0000000000000042')

    expect(getSummaryUuidForCollapse('0000000000000042')).toBe('summary-uuid')
  })

  test('getCollapseIdForSummary returns undefined for an unregistered uuid', () => {
    expect(getCollapseIdForSummary('missing-summary-uuid')).toBeUndefined()
  })

  test('getSummaryUuidForCollapse returns undefined for an unregistered id', () => {
    expect(getSummaryUuidForCollapse('0000000000009999')).toBeUndefined()
  })

  test('reseedCollapseIdCounter advances the counter and next id resumes from the next value', () => {
    reseedCollapseIdCounter(42)

    expect(peekCollapseIdCounter()).toBe(42)
    expect(nextCollapseId()).toBe('0000000000000043')
  })

  test('reseedCollapseIdCounter ignores smaller values', () => {
    reseedCollapseIdCounter(42)
    reseedCollapseIdCounter(7)

    expect(peekCollapseIdCounter()).toBe(42)
    expect(nextCollapseId()).toBe('0000000000000043')
  })

  test('reseedCollapseIdCounter ignores NaN and non-finite values', () => {
    reseedCollapseIdCounter(42)
    reseedCollapseIdCounter(Number.NaN)
    reseedCollapseIdCounter(Number.POSITIVE_INFINITY)
    reseedCollapseIdCounter(Number.NEGATIVE_INFINITY)

    expect(peekCollapseIdCounter()).toBe(42)
    expect(nextCollapseId()).toBe('0000000000000043')
  })

  test('clearSummaryRegistry wipes both maps and zeros the counter', () => {
    registerSummary('summary-uuid', '0000000000000042')
    reseedCollapseIdCounter(42)

    clearSummaryRegistry()

    expect(getCollapseIdForSummary('summary-uuid')).toBeUndefined()
    expect(getSummaryUuidForCollapse('0000000000000042')).toBeUndefined()
    expect(peekCollapseIdCounter()).toBe(0)
    expect(nextCollapseId()).toBe('0000000000000001')
  })

  test('registerSummary is idempotent for the same summary uuid and collapse id pair', () => {
    registerSummary('summary-uuid', '0000000000000042')
    registerSummary('summary-uuid', '0000000000000042')

    expect(getCollapseIdForSummary('summary-uuid')).toBe('0000000000000042')
    expect(getSummaryUuidForCollapse('0000000000000042')).toBe('summary-uuid')
  })
})
