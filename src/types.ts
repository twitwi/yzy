import type { MaybeRef, Ref, ShallowRef } from 'vue'
import type { Doc as YDoc, Text as YText } from 'yjs'
import type { ResolveText } from './resolve'
import type { YamlDumper, YamlParser } from './yaml-io'
import type { ItemKeyFn } from './deep-sync'

export type YamlStatus = 'idle' | 'parsing' | 'fetching' | 'pending' | 'dirty' | 'parseerror' | 'error'

export interface UseYamlFileOptions<T> {
  doc: MaybeRef<YDoc | undefined>
  path: string
  resolveText?: ResolveText
  parse?: YamlParser
  dump?: YamlDumper
  empty?: T
  readonly itemKey?: ItemKeyFn
  flushDelayMs?: number
  retryMs?: number | false
}

export interface YamlFileRef<T> {
  data: ShallowRef<T | undefined>
  status: ShallowRef<YamlStatus>
  error: ShallowRef<unknown>
  dirty: ShallowRef<boolean>
  conflict: ShallowRef<boolean>
  remoteApplied: ShallowRef<number>
  canUndo: ShallowRef<boolean>
  canRedo: ShallowRef<boolean>
  text: ShallowRef<string | undefined>
  rawText: () => string | undefined
  flush: () => Promise<void>
  undo: () => void
  redo: () => void
  reload: () => void
  destroy: () => void
}

export interface UseYamlSourceOptions {
  doc: MaybeRef<YDoc | undefined>
  path: string
  resolveText?: ResolveText
  parse?: YamlParser
}

export interface YamlSourceRef {
  ytext: ShallowRef<YText | undefined>
  text: ShallowRef<string | undefined>
  error: ShallowRef<unknown>
  applyText: (next: string) => boolean
  sync: () => void
  destroy: () => void
}

export interface UseYamlFileReadonlyOptions<T> {
  source: Ref<string | undefined>
  parse?: YamlParser
  empty?: T
  readonly itemKey?: ItemKeyFn
}

export interface YamlFileReadonlyRef<T> {
  data: ShallowRef<T | undefined>
  status: ShallowRef<YamlStatus>
  error: ShallowRef<unknown>
  remoteApplied: ShallowRef<number>
  destroy: () => void
}