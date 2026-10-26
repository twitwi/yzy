import * as JsYaml_ from 'js-yaml'

export const JsYaml = JsYaml_

export type YamlParser = (s: string) => unknown
export type YamlDumper = (o: unknown) => string

export const defaultParse: YamlParser = (s: string): unknown => {
  if (!s.trim()) {
    return undefined
  }
  return JsYaml.load(s)
}

export const defaultDump: YamlDumper = (o: unknown): string =>
  JsYaml.dump(o, { noCompatMode: true })