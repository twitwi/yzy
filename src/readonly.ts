import { reactive, shallowRef, watch } from 'vue'
import { cloneJson, deepSync, isPlainObject, markRawDates } from './deep-sync'
import type { UseYamlFileReadonlyOptions, YamlFileReadonlyRef, YamlStatus } from './types'
import { defaultParse } from './yaml-io'

function toReactiveTree<T>(json: unknown): T {
  if (isPlainObject(json) || Array.isArray(json)) {
    return reactive(markRawDates(cloneJson(json))) as T
  }
  return markRawDates(cloneJson(json)) as T
}

function sameRootKind(a: unknown, b: unknown): boolean {
  return (
    (Array.isArray(a) && Array.isArray(b)) ||
    (isPlainObject(a) && isPlainObject(b))
  )
}

/**
 * Read-only mirror over a plain string ref (e.g. a fetched `rawText()` from a
 * source not owned by a Y.Text here, like ::LAYERS::). Updates keep identity via
 * deepSync. Never writes and has no undo.
 */
export function useYamlFileReadonly<T>(options: UseYamlFileReadonlyOptions<T>): YamlFileReadonlyRef<T> {
  const { source, parse = defaultParse, empty, itemKey } = options

  const data = shallowRef<T | undefined>()
  const status = shallowRef<YamlStatus>('idle')
  const error = shallowRef<unknown>(undefined)
  const remoteApplied = shallowRef(0)

  const parsed = shallowRef<T | undefined>(empty !== undefined ? toReactiveTree<T>(empty) : undefined)

  function apply(raw: string | undefined): void {
    if (raw === undefined) {
      parsed.value = undefined
      data.value = undefined
      status.value = 'idle'
      error.value = undefined
      return
    }
    let json: unknown
    try {
      json = parse(raw)
    } catch (e) {
      status.value = 'parseerror'
      error.value = e
      return
    }
    if (json === undefined && empty !== undefined) {
      json = empty
    }
    const cur = parsed.value
    if (cur === undefined || !sameRootKind(cur, json) || json === undefined) {
      parsed.value = toReactiveTree<T>(json)
    } else {
      deepSync(cur, json, { itemKey })
    }
    data.value = parsed.value
    remoteApplied.value++
    status.value = 'idle'
    error.value = undefined
  }

  const stop = watch(source, (raw) => {
    apply(raw)
  }, { immediate: true })

  return {
    data,
    status,
    error,
    remoteApplied,
    destroy: () => {
      stop()
    },
  }
}