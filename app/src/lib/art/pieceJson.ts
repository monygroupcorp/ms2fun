/**
 * A creator's per-piece metadata, kept exactly as they wrote it except for its `image` link.
 *
 * Marketplaces read whatever fields a piece's JSON carries — `name`, `description`, `attributes`,
 * `external_url`, `animation_url`, and anything a generator adds — so an upload that rebuilt the
 * JSON from the fields it understood would quietly drop the rest. This keeps the creator's text
 * instead: it checks it is valid JSON, removes the whitespace between tokens, and swaps the value of
 * the top-level `image` key for the hosted link. Every other byte is the creator's, in their key
 * order, with their number spellings and their string escapes; `JSON.parse` followed by
 * `JSON.stringify` would reorder integer-like keys, collapse duplicates, and round large numbers.
 *
 * DETERMINISTIC ON PURPOSE. Minifying the same text always gives the same text, so the same files
 * always give the same CIDs, in the creator's browser, in the art service, and for anyone who later
 * recomputes the IPFS version of the metadata from the hosted copy (`ipfsMigration.ts`).
 *
 * DEPENDENCY-FREE, like `hostingLimits.ts`: the art service imports this file to check what it
 * hosts and cannot resolve the app's packages.
 */

/** Where in the text a JSON problem is, 1-based, as an editor shows it. */
export interface JsonProblem {
  message: string
  line: number
  column: number
}

export interface MinifiedObject {
  ok: true
  /** The object with no whitespace between tokens. */
  text: string
  /** The top-level keys, decoded, in the order written. */
  keys: string[]
  /** The decoded value of the top-level `image` key: undefined when there is none. */
  image: unknown
  /** Where the `image` value sits in {@link text}, end exclusive; null when there is no `image`. */
  imageSpan: [number, number] | null
}

export type MinifyResult = MinifiedObject | { ok: false; problem: JsonProblem }

/** Deepest nesting accepted. Metadata is a few levels deep; this only stops a runaway input. */
const MAX_DEPTH = 64

class Problem extends Error {
  constructor(
    message: string,
    readonly at: number,
  ) {
    super(message)
  }
}

function position(text: string, at: number): { line: number; column: number } {
  let line = 1
  let column = 1
  for (let i = 0; i < at && i < text.length; i++) {
    if (text[i] === '\n') {
      line++
      column = 1
    } else {
      column++
    }
  }
  return { line, column }
}

/** What a top-level object read so far has: where it starts in the output, its keys, its image. */
interface Record_ {
  start: number
  keys: string[]
  image: unknown
  imageSpan: [number, number] | null
}

type Scan =
  | { ok: true; text: string; records: MinifiedObject[] }
  | { ok: false; problem: JsonProblem }

/**
 * The scanner both entry points share. `shape` is what the top level must be: one object, or a list
 * of objects (an aggregate metadata file), each of which is returned on its own.
 */
function scan(text: string, shape: 'object' | 'list'): Scan {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const out: string[] = []
  let length = 0
  let at = 0
  const records: Array<Record_ & { end: number }> = []
  let current: Record_ | null = null

  const emit = (piece: string) => {
    out.push(piece)
    length += piece.length
  }
  const skipSpace = () => {
    while (at < source.length) {
      const c = source.charCodeAt(at)
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) at++
      else break
    }
  }
  const expect = (ch: string, what: string) => {
    if (source[at] !== ch) {
      throw new Problem(
        at >= source.length ? `the file ends where ${what} was expected` : `expected ${what}`,
        at,
      )
    }
    at++
  }

  const readString = (): string => {
    const start = at
    expect('"', 'a string')
    for (;;) {
      if (at >= source.length) throw new Problem('a string is never closed', start)
      const c = source.charCodeAt(at)
      if (c === 0x22) {
        at++
        break
      }
      if (c < 0x20) throw new Problem('a string holds a raw control character or line break', at)
      if (c === 0x5c) {
        const next = source[at + 1]
        if (next === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(source.slice(at + 2, at + 6))) {
            throw new Problem('a \\u escape needs four hex digits', at)
          }
          at += 6
        } else if (next !== undefined && '"\\/bfnrt'.includes(next)) {
          at += 2
        } else {
          throw new Problem('a string holds an invalid escape', at)
        }
        continue
      }
      at++
    }
    return source.slice(start, at)
  }

  const NUMBER = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y
  const readNumber = (): string => {
    NUMBER.lastIndex = at
    const match = NUMBER.exec(source)
    if (match === null || match[0].length === 0) throw new Problem('expected a value', at)
    at += match[0].length
    return match[0]
  }

  const readList = (depth: number, items: (depth: number) => void): void => {
    expect('[', 'a list')
    emit('[')
    skipSpace()
    if (source[at] === ']') {
      at++
      emit(']')
      return
    }
    for (;;) {
      items(depth)
      skipSpace()
      if (source[at] === ',') {
        at++
        emit(',')
        continue
      }
      expect(']', '"," or "]"')
      emit(']')
      return
    }
  }

  const readValue = (depth: number): void => {
    skipSpace()
    if (depth > MAX_DEPTH) throw new Problem('nested too deeply', at)
    const c = source[at]
    if (c === '{') return readObject(depth + 1, null)
    if (c === '[') return readList(depth + 1, readValue)
    if (c === '"') return emit(readString())
    for (const word of ['true', 'false', 'null']) {
      if (source.startsWith(word, at)) {
        at += word.length
        return emit(word)
      }
    }
    if (c === undefined) throw new Problem('the file ends where a value was expected', at)
    emit(readNumber())
  }

  function readObject(depth: number, record: Record_ | null): void {
    expect('{', 'an object')
    emit('{')
    skipSpace()
    if (source[at] === '}') {
      at++
      emit('}')
      return
    }
    for (;;) {
      skipSpace()
      const keyAt = at
      const raw = readString()
      const key = JSON.parse(raw) as string
      emit(raw)
      skipSpace()
      expect(':', '":" after a key')
      emit(':')
      if (record !== null) {
        if (key === 'image' && record.imageSpan !== null) {
          throw new Problem('"image" appears twice', keyAt)
        }
        record.keys.push(key)
      }
      const valueStart = length
      skipSpace()
      const valueAt = at
      readValue(depth)
      if (record !== null && key === 'image') {
        record.imageSpan = [valueStart - record.start, length - record.start]
        record.image = JSON.parse(source.slice(valueAt, at)) as unknown
      }
      skipSpace()
      if (source[at] === ',') {
        at++
        emit(',')
        continue
      }
      expect('}', '"," or "}"')
      emit('}')
      return
    }
  }

  const readRecord = (depth: number): void => {
    skipSpace()
    if (source[at] !== '{') {
      throw new Problem(
        shape === 'list' ? `item ${records.length + 1} is not an object` : 'expected a JSON object',
        at,
      )
    }
    current = { start: length, keys: [], image: undefined, imageSpan: null }
    readObject(depth, current)
    records.push({ ...current, end: length })
  }

  try {
    skipSpace()
    if (shape === 'object') {
      if (source[at] === '[') throw new Problem('expected one object, found a list', at)
      readRecord(1)
    } else {
      if (source[at] !== '[') throw new Problem('expected a list of objects', at)
      readList(1, readRecord)
    }
    skipSpace()
    if (at !== source.length) {
      throw new Problem(`there is more after the ${shape === 'list' ? 'list' : 'object'}`, at)
    }
  } catch (error) {
    if (!(error instanceof Problem)) throw error
    // Positions are reported in the creator's text, so a dropped byte-order mark is counted back.
    return {
      ok: false,
      problem: { message: error.message, ...position(text, error.at + (source === text ? 0 : 1)) },
    }
  }
  const all = out.join('')
  return {
    ok: true,
    text: all,
    records: records.map((r) => ({
      ok: true as const,
      text: all.slice(r.start, r.end),
      keys: r.keys,
      image: r.image,
      imageSpan: r.imageSpan,
    })),
  }
}

/**
 * Validate `text` as one JSON object (RFC 8259, strictly: no comments, no trailing commas, no
 * single quotes) and return it minified. A leading byte-order mark is dropped.
 */
export function minifyJsonObject(text: string): MinifyResult {
  const result = scan(text, 'object')
  return result.ok ? result.records[0]! : result
}

/**
 * Validate `text` as a list of JSON objects — an aggregate metadata file, `_metadata.json` — and
 * return each object minified, in order, as {@link minifyJsonObject} would.
 */
export function minifyJsonObjectList(
  text: string,
): { ok: true; objects: MinifiedObject[] } | { ok: false; problem: JsonProblem } {
  const result = scan(text, 'list')
  return result.ok ? { ok: true, objects: result.records } : result
}

/**
 * The minified object with its top-level `image` set to `link`, and nothing else changed. A piece
 * that had no `image` gets one, as its last key.
 */
export function withImage(json: MinifiedObject, link: string): string {
  const value = JSON.stringify(link)
  if (json.imageSpan !== null) {
    const [start, end] = json.imageSpan
    return json.text.slice(0, start) + value + json.text.slice(end)
  }
  const inner = json.text.slice(1, -1)
  return `{${inner}${inner.length > 0 ? ',' : ''}"image":${value}}`
}

/** UTF-8 bytes → text, refusing bytes that are not UTF-8 rather than guessing. */
export function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)
  } catch {
    return null
  }
}

/** `problem` as one line a creator can act on: `1.json, line 3, column 7: expected ":"`. */
export function describeProblem(file: string, problem: JsonProblem): string {
  return `${file}, line ${problem.line}, column ${problem.column}: ${problem.message}`
}
