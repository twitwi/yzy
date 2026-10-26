import { isRef, reactive, shallowRef, toRaw, watch, type Ref } from 'vue'
import { UndoManager as YUndoManager, Text as YText, type Doc as YDoc } from 'yjs'
import { cloneJson, deepEqualsJson, deepSync, isPlainObject, markRawDates } from './deep-sync'
import { LOCAL_ORIGIN } from './origin'
import { defaultResolveText } from './resolve'
import type { UseYamlFileOptions, YamlFileRef, YamlStatus } from './types'
import { defaultDump, defaultParse } from './yaml-io'

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
 * Single-writer text-backed mirror. The YAML document stays in a Y.Text; we keep a
 * Vue-reactive deep object as mirror. All *local* mutations go through this one
 * instance (debounced flush under LOCAL_ORIGIN); remote changes are deep-synced in
 * place so object identity of untouched subtrees is preserved (no stale refs).
 */
export function useYamlFile<T>(options: UseYamlFileOptions<T>): YamlFileRef<T> {
  const {
    path,
    doc: docOption,
    resolveText = defaultResolveText,
    parse = defaultParse,
    dump = defaultDump,
    empty,
    itemKey,
    flushDelayMs = 300,
    retryMs = 300,
  } = options

  const docRef: Ref<YDoc | undefined> = isRef(docOption) ? (docOption as Ref<YDoc | undefined>) : shallowRef(docOption as YDoc | undefined)

  function ydocNow(): YDoc | undefined {
    const v = docRef.value
    if (v === undefined || v === null) {
      return undefined
    }
    return toRaw(v) as YDoc
  }

  const data = shallowRef<T | undefined>()
  const text = shallowRef<string | undefined>()
  const status = shallowRef<YamlStatus>('idle')
  const error = shallowRef<unknown>(undefined)
  const dirty = shallowRef(false)
  const conflict = shallowRef(false)
  const remoteApplied = shallowRef(0)
  const canUndo = shallowRef(false)
  const canRedo = shallowRef(false)

  const parsed = shallowRef<T | undefined>(empty !== undefined ? toReactiveTree<T>(empty) : undefined)

  let currentYText: YText | undefined
  let detachCurrent: (() => void) | undefined
  let undoManager: YUndoManager | undefined
  let reloadTimer: ReturnType<typeof setTimeout> | undefined
  let flushTimer: ReturnType<typeof setTimeout> | undefined
  let isOwnFlush = false
  let suppressed = false
  let pendingRemote: string | undefined
  let destroyed = false
  const stops: Array<() => void> = []

  function reset(): void {
    if (reloadTimer !== undefined) {
      clearTimeout(reloadTimer)
      reloadTimer = undefined
    }
    suppressed = true
    try {
      parsed.value = empty !== undefined ? toReactiveTree<T>(empty) : undefined
      data.value = parsed.value
      text.value = undefined
    } finally {
      suppressed = false
    }
    pendingRemote = undefined
    error.value = undefined
    conflict.value = false
    dirty.value = false
    status.value = 'idle'
  }

  function teardownCurrent(): void {
    detachCurrent?.()
    detachCurrent = undefined
    undoManager?.destroy()
    undoManager = undefined
    currentYText = undefined
  }

  function adoptJson(json: unknown): void {
    const cur = parsed.value
    if (cur === undefined || !sameRootKind(cur, json) || json === undefined) {
      parsed.value = toReactiveTree<T>(json)
    } else {
      deepSync(cur, json, { itemKey })
    }
    data.value = parsed.value
  }

  function applyJsonFromText(raw: string): void {
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
    adoptJson(json)
    status.value = 'idle'
    error.value = undefined
  }

  function textsEqual(a: string, b: string): boolean {
    if (a === b) {
      return true
    }
    if (!a.trim() && !b.trim()) {
      return true
    }
    try {
      return deepEqualsJson(parse(a), parse(b))
    } catch {
      return false
    }
  }

  function refreshFromCurrent(): void {
    const ytext = currentYText
    if (!ytext) {
      return
    }
    suppressed = true
    try {
      const raw = ytext.toString()
      text.value = raw
      if (raw.trim()) {
        applyJsonFromText(raw)
      } else if (empty !== undefined) {
        adoptJson(empty)
      }
      status.value = 'idle'
      error.value = undefined
    } finally {
      suppressed = false
    }
  }

  function onRemoteChange(): void {
    if (isOwnFlush || destroyed) {
      return
    }
    const ytext = currentYText
    if (!ytext) {
      return
    }
    const raw = ytext.toString()
    text.value = raw
    if (dirty.value) {
      pendingRemote = raw
      conflict.value = true
      return
    }
    suppressed = true
    try {
      applyJsonFromText(raw)
      remoteApplied.value++
    } finally {
      suppressed = false
    }
  }

  function scheduleFlush(): void {
    if (destroyed) {
      return
    }
    dirty.value = true
    status.value = 'dirty'
    if (flushTimer !== undefined) {
      clearTimeout(flushTimer)
    }
    flushTimer = setTimeout(() => {
      void flush()
    }, flushDelayMs)
  }

  function flush(): void {
    if (destroyed) {
      return
    }
    if (flushTimer !== undefined) {
      clearTimeout(flushTimer)
      flushTimer = undefined
    }
    const ytext = currentYText
    if (!ytext) {
      dirty.value = false
      status.value = 'idle'
      return
    }
    const current = parsed.value
    if (current === undefined) {
      dirty.value = false
      status.value = 'idle'
      conflict.value = pendingRemote !== undefined
      return
    }
    let dumped: string
    try {
      dumped = dump(current)
    } catch (e) {
      error.value = e
      status.value = 'parseerror'
      return
    }
    try {
      parse(dumped)
    } catch (e) {
      error.value = e
      status.value = 'parseerror'
      return
    }
    if (textsEqual(dumped, ytext.toString())) {
      dirty.value = false
      status.value = 'idle'
      conflict.value = pendingRemote !== undefined
      return
    }
    isOwnFlush = true
    try {
      ytext.doc?.transact(() => {
        const s = ytext.toString()
        let p = 0
        while (p < s.length && p < dumped.length && s[p] === dumped[p]) {
          p++
        }
        let q = 0
        while (
          q < s.length - p &&
          q < dumped.length - p &&
          s[s.length - 1 - q] === dumped[dumped.length - 1 - q]
        ) {
          q++
        }
        const keepLen = s.length - p - q
        if (keepLen !== 0) {
          ytext.delete(p, keepLen)
        }
        const middle = dumped.slice(p, dumped.length - q)
        if (middle.length !== 0) {
          ytext.insert(p, middle)
        }
      }, LOCAL_ORIGIN)
    } finally {
      isOwnFlush = false
    }
    text.value = dumped
    dirty.value = false
    status.value = 'idle'
    if (pendingRemote !== undefined) {
      // Our just-flushed state is authoritative: it is what is now in the
      // backend. The buffered remote predates our write; applying it here
      // would revert our change in the view while the backend keeps it
      // (view/backend divergence, only "fixed" by a refresh). Drop it and
      // keep the conflict flag so the concurrency stays visible.
      pendingRemote = undefined
      conflict.value = true
    } else {
      conflict.value = false
    }
  }

  function load(): void {
    if (destroyed) {
      return
    }
    const ydoc = ydocNow()
    if (!ydoc) {
      reset()
      teardownCurrent()
      return
    }
    const ytext = resolveText(ydoc, path)
    if (!ytext) {
      reset()
      teardownCurrent()
      if (retryMs !== false) {
        reloadTimer = setTimeout(() => {
          reloadTimer = undefined
          load()
        }, retryMs)
      }
      return
    }
    if (currentYText !== ytext) {
      teardownCurrent()
      currentYText = ytext
      const observer = onRemoteChange
      ytext.observe(observer as never)
      detachCurrent = () => {
        try {
          ytext.unobserve(observer as never)
        } catch {
          // ignore
        }
      }
      undoManager = new YUndoManager(ytext, {
        trackedOrigins: new Set([LOCAL_ORIGIN]),
        captureTimeout: 500,
      })
      const refreshUndo = () => {
        const um = undoManager
        if (!um) {
          return
        }
        canUndo.value = um.undoStack.length > 0
        canRedo.value = um.redoStack.length > 0
      }
      undoManager.on('stack-item-added', refreshUndo)
      undoManager.on('stack-item-popped', refreshUndo)
      undoManager.on('stack-cleared', refreshUndo)
    }
    if (reloadTimer !== undefined) {
      clearTimeout(reloadTimer)
      reloadTimer = undefined
    }
    refreshFromCurrent()
  }

  stops.push(
    watch(docRef, () => {
      load()
    }),
  )

  stops.push(
    watch(parsed, () => {
      if (suppressed || destroyed) {
        return
      }
      scheduleFlush()
    }, { deep: true, flush: 'sync' }),
  )

  load()

  return {
    data,
    status,
    error,
    dirty,
    conflict,
    remoteApplied,
    canUndo,
    canRedo,
    text,
    rawText: () => currentYText?.toString(),
    flush: () => {
      flush()
      return Promise.resolve()
    },
    undo: () => {
      if (destroyed || !undoManager) {
        return
      }
      if (undoManager.canUndo()) {
        if (dirty.value) {
          flush()
        }
        undoManager.undo()
      }
    },
    redo: () => {
      if (destroyed || !undoManager) {
        return
      }
      if (undoManager.canRedo()) {
        if (dirty.value) {
          flush()
        }
        undoManager.redo()
      }
    },
    reload: () => {
      load()
    },
    destroy: () => {
      if (destroyed) {
        return
      }
      destroyed = true
      teardownCurrent()
      for (const stop of stops) {
        try {
          stop()
        } catch {
          // ignore
        }
      }
      if (flushTimer !== undefined) {
        clearTimeout(flushTimer)
      }
      if (reloadTimer !== undefined) {
        clearTimeout(reloadTimer)
      }
    },
  }
}