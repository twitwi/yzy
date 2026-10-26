import type { Doc as YDoc } from 'yjs'
import { Map as YMap, Text as YText } from 'yjs'

export type ResolveText = (doc: YDoc, path: string) => YText | undefined

function isYMap(v: unknown): v is YMap<unknown> {
  return v instanceof YMap
}

function isYText(v: unknown): v is YText {
  return v instanceof YText
}

/**
 * Minimal root-map path walker. Handles paths like `top/leaf` or `top/deep/leaf`.
 * Not box-aware by design (core stays dependency-free); apps may inject their own
 * resolver (see src/stores/connection-next.ts).
 */
export const defaultResolveText: ResolveText = (doc, path): YText | undefined => {
  const steps = path.split('/').filter(Boolean)
  if (steps.length === 0) {
    return undefined
  }
  if (steps.length === 1) {
    const k = steps[0]
    if (doc.share.has(k)) {
      const t = doc.getText(k)
      return isYText(t) ? t : undefined
    }
    return undefined
  }
  let p: YMap<unknown> | undefined = doc.getMap()
  for (let i = 0; i < steps.length - 1; i++) {
    const k = steps[i]
    if (p === undefined || !p.has(k)) {
      return undefined
    }
    const next = p.get(k)
    if (!isYMap(next)) {
      return undefined
    }
    p = next
  }
  const v = p?.get(steps[steps.length - 1])
  return isYText(v) ? v : undefined
}