import { describe, expect, it } from 'vitest'
import { cloneJson, deepEqualsJson, deepSync, isPlainObject } from '../deep-sync'

type Rec = Record<string, unknown>

const alices: Rec[] = [
  { id: 'a', name: 'Alice', tags: ['x', 'y'] },
  { id: 'b', name: 'Bob', tags: [] },
]

describe('isPlainObject', () => {
  it('accepts plain objects and arrays, rejects dates/null', () => {
    expect(isPlainObject({})).toBe(true)
    expect(isPlainObject(Object.create(null))).toBe(true)
    expect(isPlainObject([])).toBe(false)
    expect(isPlainObject(null)).toBe(false)
    expect(isPlainObject(new Date())).toBe(false)
  })
})

describe('cloneJson', () => {
  it('deep clones and marks dates raw', () => {
    const src = { a: [1, { d: new Date('2020-01-01T00:00:00Z') }] }
    const out = cloneJson(src)
    expect(out).toEqual(src)
    expect(out.a).not.toBe(src.a)
    expect(out.a[1]).not.toBe(src.a[1])
    const d = (out.a[1] as { d: Date }).d
    expect(d).toBeInstanceOf(Date)
    expect(d.getTime()).toBe(new Date('2020-01-01T00:00:00Z').getTime())
  })
})

describe('deepEqualsJson', () => {
  it('compares deeply including dates', () => {
    expect(deepEqualsJson(alices, alices)).toBe(true)
    expect(deepEqualsJson(alices, cloneJson(alices))).toBe(true)
    expect(deepEqualsJson(alices, [alices[0]])).toBe(false)
    expect(deepEqualsJson({ d: new Date(5) }, { d: new Date(5) })).toBe(true)
    expect(deepEqualsJson({ d: new Date(5) }, { d: new Date(6) })).toBe(false)
    expect(deepEqualsJson(undefined, undefined)).toBe(true)
    expect(deepEqualsJson(null, undefined)).toBe(false)
  })
})

describe('deepSync', () => {
  it('mutates in place and keeps identity of untouched leaves', () => {
    const target = cloneJson(alices)
    const bob = target[1]
    target[0].name = 'Alice2'
    ;(target[0].tags as unknown[]).push('z')
    target.push({ id: 'c', name: 'Carol', tags: [] })
    const changed = deepSync(target, alices)
    expect(changed).toBe(true)
    expect(target).toEqual(alices)
    expect(target[1]).toBe(bob)
  })

  it('syncs reordered arrays via key', () => {
    const target = cloneJson(alices)
    const first = target[0]
    const src = [alices[1], alices[0]]
    deepSync(target, src)
    expect(target.map((x) => x.id)).toEqual(['b', 'a'])
    expect(target[1]).toBe(first)
  })

  it('deletes removed keys', () => {
    const target = cloneJson(alices)
    const withExtra = [{ ...alices[0], removed: 1 }]
    deepSync(target, withExtra)
    expect((target[0] as Rec).removed).toBe(1)
    const withoutExtra = [{ id: 'a', name: 'Alice', tags: ['x', 'y'] }]
    deepSync(target, withoutExtra)
    expect('removed' in (target[0] as Rec)).toBe(false)
  })

  it('returns true when kinds differ (caller replaces root)', () => {
    const target = cloneJson({ a: [1] })
    expect(deepSync(target, [1, 2])).toBe(true)
  })

  it('returns false without changes', () => {
    const target = cloneJson(alices)
    expect(deepSync(target, alices)).toBe(false)
  })
})