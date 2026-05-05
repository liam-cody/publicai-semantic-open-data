import { describe, it, expect } from 'vitest'
import { fieldAsPlainText, datasetToIndexText } from './datasetText'
import type { CKANDataset } from '../types'

describe('fieldAsPlainText', () => {
  it('passes through strings', () => {
    expect(fieldAsPlainText('hello')).toBe('hello')
  })

  it('picks de then en from language map', () => {
    expect(fieldAsPlainText({ en: 'Hi', de: 'Hallo' })).toBe('Hallo')
    expect(fieldAsPlainText({ en: 'Only' })).toBe('Only')
  })

  it('returns empty when no string fields', () => {
    expect(fieldAsPlainText({ foo: 1 })).toBe('')
    expect(fieldAsPlainText({})).toBe('')
  })
})

describe('datasetToIndexText', () => {
  it('handles title stored as multilingual object', () => {
    const d = {
      id: 'x',
      name: 'x',
      title: { de: 'Titel' },
      notes: '',
      author: '',
      tags: [],
    } as unknown as CKANDataset
    expect(datasetToIndexText(d)).toContain('Titel')
  })
})
