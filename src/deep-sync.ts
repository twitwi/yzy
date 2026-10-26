import { markRaw } from 'vue'

export type ItemKeyFn = (item: unknown, index: number) => string | undefined

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    return false
  }
  if (v instanceof Date) {
    return false
  }
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

function isDate(v: unknown): v is Date {
  return v instanceof Date
}

export function deepEqualsJson(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true
  }
  if (typeof a !== typeof b) {
    return false
  }
  if (a === null || b === null) {
    return a === b
  }
  if (isDate(a) || isDate(b)) {
    return isDate(a) && isDate(b) && a.getTime() === b.getTime()
  }
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) {
      return false
    }
    for (let i = 0; i < a.length; i++) {
      if (!deepEqualsJson(a[i], b[i])) {
        return false
      }
    }
    return true
  }
  if (isPlainObject(a)) {
    if (!isPlainObject(b)) {
      return false
    }
    const ka = Object.keys(a)
    const kb = Object.keys(b)
    if (ka.length !== kb.length) {
      return false
    }
    for (const k of ka) {
      if (!Object.prototype.hasOwnProperty.call(b, k)) {
        return false
      }
      if (!deepEqualsJson(a[k], b[k])) {
        return false
      }
    }
    return true
  }
  return false
}

/** Mark Date leaves so Vue never wraps them in reactive proxies (Date methods break otherwise). */
export function markRawDates<T>(v: T): T {
  if (isDate(v)) {
    return markRaw(v) as unknown as T
  }
  if (Array.isArray(v)) {
    for (const x of v) {
      markRawDates(x)
    }
    return v
  }
  if (isPlainObject(v)) {
    for (const k of Object.keys(v)) {
      markRawDates(v[k])
    }
    return v
  }
  return v
}

export function cloneJson<T>(v: T): T {
  if (v === undefined) {
    return v
  }
  let out: T
  if (typeof structuredClone === 'function') {
    try {
      out = structuredClone(v) as T
    } catch {
      out = JSON.parse(JSON.stringify(v)) as T
    }
  } else {
    out = JSON.parse(JSON.stringify(v)) as T
  }
  return markRawDates(out)
}

export function inferItemKey(source: unknown): ItemKeyFn | undefined {
  const arr = Array.isArray(source) ? source : undefined
  const item = arr && arr.length > 0 ? arr[0] : undefined
  if (isPlainObject(item)) {
    if ('id' in item) {
      return (v) => (isPlainObject(v) && 'id' in v ? String(v.id) : undefined)
    }
    if ('key' in item) {
      return (v) => (isPlainObject(v) && 'key' in v ? String(v.key) : undefined)
    }
  }
  return undefined
}

export interface DeepSyncHooks {
  itemKey?: ItemKeyFn
}

function canSyncInPlace(target: unknown, source: unknown): boolean {
  if (Array.isArray(target) && Array.isArray(source)) {
    return true
  }
  if (isPlainObject(target) && isPlainObject(source)) {
    return true
  }
  return false
}

function syncValue(target: unknown, source: unknown, hooks: DeepSyncHooks): boolean {
  if (Array.isArray(target) && Array.isArray(source)) {
    return syncArray(target, source, hooks)
  }
  if (isPlainObject(target) && isPlainObject(source)) {
    return syncObject(target, source, hooks)
  }
  if (deepEqualsJson(target, source)) {
    return false
  }
  return true
}

function syncObject(target: Record<string, unknown>, source: Record<string, unknown>, hooks: DeepSyncHooks): boolean {
  let changed = false
  for (const k of Object.keys(target)) {
    if (!(k in source)) {
      delete target[k]
      changed = true
    }
  }
  for (const k of Object.keys(source)) {
    const s = source[k]
    const t = target[k]
    if (!(k in target)) {
      target[k] = cloneJson(s)
      changed = true
      continue
    }
    if (canSyncInPlace(t, s)) {
      if (syncValue(t, s, hooks)) {
        changed = true
      }
      continue
    }
    if (!deepEqualsJson(t, s)) {
      target[k] = cloneJson(s)
      changed = true
    }
  }
  return changed
}

function applySplice(t: unknown[], result: unknown[]): boolean {
  let prefix = 0
  while (prefix < t.length && prefix < result.length && t[prefix] === result[prefix]) {
    prefix++
  }
  let suffix = 0
  while (
    suffix < t.length - prefix &&
    suffix < result.length - prefix &&
    t[t.length - 1 - suffix] === result[result.length - 1 - suffix]
  ) {
    suffix++
  }
  const midStart = prefix
  const tMidEnd = t.length - suffix
  const rMidEnd = result.length - suffix
  if (midStart === tMidEnd && midStart === rMidEnd) {
    return false
  }
  const middle = result.slice(midStart, rMidEnd)
  t.splice(midStart, tMidEnd - midStart, ...middle)
  return true
}

function syncArray(target: unknown[], source: unknown[], hooks: DeepSyncHooks): boolean {
  const keyFn = hooks.itemKey ?? inferItemKey(source)
  if (keyFn) {
    const sByKey = new Map<string, unknown>()
    const tByKey = new Map<string, unknown>()
    for (let i = 0; i < source.length; i++) {
      const k = keyFn(source[i], i)
      if (k !== undefined && !sByKey.has(k)) {
        sByKey.set(k, source[i])
      }
    }
    for (let i = 0; i < target.length; i++) {
      const k = keyFn(target[i], i)
      if (k !== undefined && !tByKey.has(k)) {
        tByKey.set(k, target[i])
      }
    }
    let changed = false
    for (const [k, tEl] of tByKey) {
      const sEl = sByKey.get(k)
      if (sEl !== undefined && canSyncInPlace(tEl, sEl)) {
        if (syncValue(tEl, sEl, hooks)) {
          changed = true
        }
      }
    }
    const result: unknown[] = []
    for (let i = 0; i < source.length; i++) {
      const sEl = source[i]
      const k = keyFn(sEl, i)
      const tEl = k !== undefined ? tByKey.get(k) : undefined
      if (tEl !== undefined && sEl !== undefined && canSyncInPlace(tEl, sEl)) {
        result.push(tEl)
      } else {
        result.push(cloneJson(sEl))
      }
    }
    return applySplice(target, result) || changed
  }
  const min = Math.min(target.length, source.length)
  let changed = false
  for (let i = 0; i < min; i++) {
    if (syncValue(target[i], source[i], hooks)) {
      changed = true
    }
  }
  if (target.length > min) {
    target.splice(min, target.length - min)
    changed = true
  }
  if (target.length < source.length) {
    for (let i = min; i < source.length; i++) {
      target.push(cloneJson(source[i]))
    }
    changed = true
  }
  return changed
}

/**
 * Mutate `target` (a Vue-reactive tree) in place so it matches `source`
 * (a freshly parsed YAML object) while preserving JS identity of unchanged subtrees.
 * Returns true if anything changed.
 */
export function deepSync(target: unknown, source: unknown, hooks: DeepSyncHooks = {}): boolean {
  if (Array.isArray(target) && Array.isArray(source)) {
    return syncArray(target, source, hooks)
  }
  if (isPlainObject(target) && isPlainObject(source)) {
    return syncObject(target, source, hooks)
  }
  return !deepEqualsJson(target, source)
}