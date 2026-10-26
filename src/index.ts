export { LOCAL_ORIGIN } from './origin'
export { cloneJson, deepEqualsJson, deepSync, inferItemKey, isPlainObject, markRawDates } from './deep-sync'
export type { ItemKeyFn } from './deep-sync'
export { useYamlFile } from './mirror'
export { useYamlFileReadonly } from './readonly'
export { defaultResolveText } from './resolve'
export type { ResolveText } from './resolve'
export { useYamlSource } from './source'
export { defaultDump, defaultParse } from './yaml-io'
export type { YamlDumper, YamlParser } from './yaml-io'
export type {
  UseYamlFileOptions,
  UseYamlFileReadonlyOptions,
  UseYamlSourceOptions,
  YamlFileReadonlyRef,
  YamlFileRef,
  YamlSourceRef,
  YamlStatus,
} from './types'