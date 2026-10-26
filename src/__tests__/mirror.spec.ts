import { nextTick, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { Doc as YDoc } from 'yjs'
import { useYamlFile } from '../mirror'
import { LOCAL_ORIGIN } from '../origin'

function makeDoc(content?: string, path = 'file'): { doc: YDoc; text: import('yjs').Text } {
  const doc = new YDoc()
  const text = doc.getText(path)
  if (content) {
    text.insert(0, content)
  }
  return { doc, text }
}

describe('useYamlFile mirror', () => {
  it('loads existing content', () => {
    const { doc } = makeDoc('name: Alice\nage: 30\n')
    const m = useYamlFile<{ name: string; age: number }>({ doc: ref(doc), path: 'file' })
    expect(m.data.value).toEqual({ name: 'Alice', age: 30 })
    m.destroy()
  })

  it('seeds blank files with empty', () => {
    const { doc } = makeDoc('')
    const m = useYamlFile<unknown[]>({ doc: ref(doc), path: 'file', empty: [] })
    expect(m.data.value).toEqual([])
    m.destroy()
  })

  it('local edits flush a single documented transact under LOCAL_ORIGIN', async () => {
    const { doc, text } = makeDoc('- a\n- b\n')
    const m = useYamlFile<unknown[]>({ doc: ref(doc), path: 'file' })
    const origins: unknown[] = []
    doc.on('afterTransaction', (txn) => {
      origins.push(txn.origin)
    })
    ;(m.data.value as unknown[]).push('c')
    await m.flush()
    expect(text.toString()).toBe('- a\n- b\n- c\n')
    expect(origins.some((o) => o === LOCAL_ORIGIN)).toBe(true)
    expect(m.dirty.value).toBe(false)
    expect(m.conflict.value).toBe(false)
    m.destroy()
  })

  it('remote changes deep-sync in place, preserving identity', () => {
    const { doc, text } = makeDoc('name: x\nchild:\n  name: inner\n')
    const m = useYamlFile<{ name: string }>({ doc: ref(doc), path: 'file' })
    const before = m.data.value!
    doc.transact(() => {
      text.delete(6, 1)
      text.insert(6, 'y')
    }, 'remote')
    expect(m.data.value!.name).toBe('y')
    expect(m.data.value).toBe(before)
    expect(m.remoteApplied.value).toBe(1)
    m.destroy()
  })

  it('remote edits do not mark the mirror dirty', () => {
    const { doc, text } = makeDoc('a: 1\n')
    const m = useYamlFile<Record<string, unknown>>({ doc: ref(doc), path: 'file' })
    doc.transact(() => {
      text.delete(4, 1)
      text.insert(4, '2')
    }, 'remote')
    expect(m.dirty.value).toBe(false)
    m.destroy()
  })

  it('buffers remote changes while locally dirty; own flush wins and flags conflict', async () => {
    const { doc, text } = makeDoc('a: 1\nb: 2\n')
    const m = useYamlFile<Record<string, unknown>>({ doc: ref(doc), path: 'file' })
    m.data.value!.a = 10
    // local edit pending (dirty)
    doc.transact(() => {
      text.delete(8, 1)
      text.insert(8, '9')
    }, 'remote')
    expect(m.conflict.value).toBe(true)
    expect(m.data.value!.a).toBe(10) // local still wins in the mirror
    await m.flush()
    // conflict stays because a remote edit was buffered during dirty, but the
    // just-flushed local state is authoritative: the stale buffer is dropped
    // instead of being applied over it (that would revert our edit in the
    // view while the backend keeps it).
    expect(m.conflict.value).toBe(true)
    expect(m.data.value!.a).toBe(10)
    expect(m.data.value!.b).toBe(2)
    expect(text.toString()).toBe('a: 10\nb: 2\n')
    m.destroy()
  })

  it('a stale remote buffered while dirty does not revert the just-flushed local edit', async () => {
    const { doc, text } = makeDoc(
      '- id: pub-a\n  report:\n    unreviewed: true\n    groups:\n      - group: g-1\n        percent: 100\n- id: pub-b\n  title: Bbb\n',
    )
    interface Pub {
      id: string
      report: { unreviewed?: boolean; groups: { group: string; percent: number }[] }
    }
    const m = useYamlFile<Pub[]>({ doc: ref(doc), path: 'file', empty: [] })
    const pubA = m.data.value!.find((p) => p.id === 'pub-a')!
    // local edit, like toggleGroup in PublicationsView: add g-2
    pubA.report.groups.push({ group: 'g-2', percent: 100 })
    // stale remote arrives while dirty (missing our edit)
    doc.transact(() => {
      const s = text.toString()
      text.delete(0, s.length)
      text.insert(0, s.replace('title: Bbb', 'title: Bbb remote'))
    }, 'remote')
    expect(m.conflict.value).toBe(true)
    await m.flush()
    // backend has our edit
    expect(text.toString()).toContain('g-2')
    // ...and so does the view (no revert to the stale remote)
    expect(pubA.report.groups.some((c) => c.group === 'g-2')).toBe(true)
    expect(m.data.value!.find((p) => p.id === 'pub-a')!.report.groups).toHaveLength(2)
    expect(m.conflict.value).toBe(true)
    m.destroy()
  })

  it('swapping the doc reloads the mirror and preserves identity when shape matches', async () => {
    const a = makeDoc('k: v1\n')
    const b = makeDoc('k: v2\n')
    const docRef = ref(a.doc)
    const m = useYamlFile<{ k: string }>({ doc: docRef, path: 'file' })
    const first = m.data.value!
    docRef.value = b.doc
    await nextTick()
    expect(m.data.value!.k).toBe('v2')
    expect(m.data.value).toBe(first)
    m.destroy()
  })

  it('undefined doc yields undefined data', () => {
    const m = useYamlFile<unknown>({ doc: ref(undefined), path: 'file' })
    expect(m.data.value).toBeUndefined()
    m.destroy()
  })

  it('undo/redo round-trips local edits via the UndoManager', async () => {
    const { doc, text } = makeDoc('- 1\n- 2\n')
    const m = useYamlFile<unknown[]>({ doc: ref(doc), path: 'file', empty: [] })
    ;(m.data.value as unknown[]).push(3)
    await m.flush()
    expect(text.toString()).toBe('- 1\n- 2\n- 3\n')
    m.undo()
    await nextTick()
    expect(text.toString()).toBe('- 1\n- 2\n')
    expect(m.data.value).toEqual([1, 2])
    m.redo()
    await nextTick()
    expect(text.toString()).toBe('- 1\n- 2\n- 3\n')
    expect(m.data.value).toEqual([1, 2, 3])
    m.destroy()
  })

  it('flush is a no-op when the mirror matches the text', async () => {
    const { doc, text } = makeDoc('a: 1\n')
    const m = useYamlFile<Record<string, unknown>>({ doc: ref(doc), path: 'file' })
    await m.flush()
    expect(text.toString()).toBe('a: 1\n')
    expect(m.dirty.value).toBe(false)
    m.destroy()
  })
})