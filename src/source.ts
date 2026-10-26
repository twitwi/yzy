import { isRef, shallowRef, toRaw, watch, type Ref } from 'vue'
import { Text as YText, type Doc as YDoc } from 'yjs'
import { LOCAL_ORIGIN } from './origin'
import { defaultResolveText } from './resolve'
import type { UseYamlSourceOptions, YamlSourceRef } from './types'
import { defaultParse } from './yaml-io'

/**
 * Raw YAML source editing mode: expose the Y.Text directly plus a validated
 * `applyText`. The contents stay a plain Y.Text so external YAML/yjs editors
 * keep working. Local writes are transacted under LOCAL_ORIGIN (single writer).
 */
export function useYamlSource(options: UseYamlSourceOptions): YamlSourceRef {
  const { path, doc: docOption, resolveText = defaultResolveText, parse = defaultParse } = options

  const docRef: Ref<YDoc | undefined> = isRef(docOption) ? (docOption as Ref<YDoc | undefined>) : shallowRef(docOption as YDoc | undefined)

  function ydocNow(): YDoc | undefined {
    const v = docRef.value
    if (v === undefined || v === null) {
      return undefined
    }
    return toRaw(v) as YDoc
  }

  const ytext = shallowRef<YText | undefined>()
  const text = shallowRef<string | undefined>()
  const error = shallowRef<unknown>(undefined)

  let ownWrite = false
  let destroyed = false
  let detachCurrent: (() => void) | undefined
  const stops: Array<() => void> = []

  function sync(): void {
    if (destroyed) {
      return
    }
    const ydoc = ydocNow()
    if (!ydoc) {
      detachCurrent?.()
      detachCurrent = undefined
      ytext.value = undefined
      text.value = undefined
      return
    }
    const t = resolveText(ydoc, path)
    if (!t) {
      return
    }
    if (t !== ytext.value) {
      detachCurrent?.()
      detachCurrent = undefined
      ytext.value = t
      const observer = () => {
        if (ownWrite) {
          return
        }
        text.value = t.toString()
      }
      t.observe(observer as never)
      detachCurrent = () => {
        try {
          t.unobserve(observer as never)
        } catch {
          // ignore
        }
      }
    }
    text.value = t.toString()
  }

  function applyText(next: string): boolean {
    if (destroyed) {
      return false
    }
    const t = ytext.value
    if (!t) {
      return false
    }
    try {
      parse(next)
    } catch (e) {
      error.value = e
      return false
    }
    ownWrite = true
    try {
      t.doc?.transact(() => {
        const s = t.toString()
        t.delete(0, s.length)
        if (next.length !== 0) {
          t.insert(0, next)
        }
      }, LOCAL_ORIGIN)
    } finally {
      ownWrite = false
    }
    text.value = next
    error.value = undefined
    return true
  }

  stops.push(
    watch(docRef, () => {
      sync()
    }),
  )

  sync()

  return {
    ytext,
    text,
    error,
    applyText,
    sync,
    destroy: () => {
      if (destroyed) {
        return
      }
      destroyed = true
      detachCurrent?.()
      detachCurrent = undefined
      for (const stop of stops) {
        try {
          stop()
        } catch {
          // ignore
        }
      }
    },
  }
}