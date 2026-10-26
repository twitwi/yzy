import { effectScope, type EffectScope } from 'vue'

export function runInEffectScope<T>(fn: () => T): { scope: EffectScope; value: T | undefined } {
  const scope = effectScope()
  const value = scope.run(fn)
  return { scope, value }
}