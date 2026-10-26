# yzy

Vue-reactive mirror of a Y.Text-backed document. Keep a YAML (or any serialized
value) living in a `Y.Text` in sync with a Vue-reactive deep object, with a
single-writer debounced flush, undo/redo, and conflict surfacing.

## Features

- **`useYamlFile`** — single-writer mirror: local edits are flushed to the
  `Y.Text` (debounced, minimal prefix/suffix diff) under a stable local origin;
  remote edits are deep-synced in place so untouched subtrees keep JS identity.
  Exposes `data`, `status`, `dirty`, `conflict`, `remoteApplied`, `canUndo`,
  `canRedo`, `undo()`, `redo()`, `flush()`, `reload()`, `destroy()`.
- **`useYamlFileReadonly`** — same mirror over a plain string ref (no writes).
- **`useYamlSource`** — raw `Y.Text` editing mode with validated `applyText`.
- **`deepSync`** — identity-preserving in-place tree sync (keyed or positional
  arrays, `Date`-aware equality, `markRawDates`).
- **`LOCAL_ORIGIN`** — well-known `Symbol.for('yzy:local')` origin for local
  writes, so undo/remote observers can filter own flushes.

## Design

The core is box-agnostic. Resolving the `Y.Text` from a `Y.Doc` is injected via
`resolveText` (default: a plain root-map path walker). Apps that store files in
a box (e.g. `yjs-boxtools`) inject their own resolver.

## Example

```ts
import { useYamlFile } from 'yzy'
import { getFileText, inBoxPath } from 'yjs-boxtools'

const data = useYamlFile<MyDoc>({
  doc: docRef,
  path: 'mydoc.yaml',
  resolveText: (doc, path) => getFileText(doc, inBoxPath('BOX', path), false),
}).data
```

## Development

- `npm test` — vitest
- `npm run typecheck` — tsc --noEmit
