/**
 * Collection metadata as a spreadsheet: one row per piece, a column for the image file, the name and
 * the description, and one column per trait.
 *
 * Read as RFC 4180 CSV — quoted fields may hold the delimiter, a doubled quote, or a line break —
 * with the delimiter taken from the header row, so a sheet exported with semicolons (as spreadsheet
 * apps do in many locales) or tabs reads the same as one with commas. Every error names the line and
 * the column, because a creator fixing a 10,000-row sheet needs to know which cell.
 */

export interface CsvRow {
  /** The line the row starts on, 1-based, counting the header. */
  line: number
  cells: string[]
}

export interface CsvProblem {
  line: number
  column: number
  message: string
}

export type CsvResult =
  | { ok: true; header: string[]; rows: CsvRow[] }
  | { ok: false; problem: CsvProblem }

function delimiterOf(firstLine: string): string {
  let best = ','
  let bestCount = 0
  for (const candidate of [',', ';', '\t']) {
    let count = 0
    let quoted = false
    for (const ch of firstLine) {
      if (ch === '"') quoted = !quoted
      else if (ch === candidate && !quoted) count++
    }
    if (count > bestCount) {
      best = candidate
      bestCount = count
    }
  }
  return best
}

export function parseCsv(text: string): CsvResult {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const firstBreak = source.search(/\r?\n/)
  const delimiter = delimiterOf(firstBreak < 0 ? source : source.slice(0, firstBreak))
  const records: CsvRow[] = []
  let cells: string[] = []
  let cell = ''
  let line = 1
  let rowLine = 1
  let column = 1
  let at = 0
  let quotedAt: { line: number; column: number } | null = null
  let wasQuoted = false

  const endCell = () => {
    cells.push(wasQuoted ? cell : cell.trim())
    cell = ''
    wasQuoted = false
  }
  const endRow = () => {
    endCell()
    // A row with nothing in it — a blank line, or the end of the file — is not a piece.
    if (!(cells.length === 1 && cells[0] === '')) records.push({ line: rowLine, cells })
    cells = []
  }

  while (at < source.length) {
    const ch = source[at]!
    if (quotedAt !== null) {
      if (ch === '"') {
        if (source[at + 1] === '"') {
          cell += '"'
          at += 2
          column += 2
          continue
        }
        quotedAt = null
        at++
        column++
        // After a closing quote only the delimiter or the end of the row may follow.
        const next = source[at]
        if (next !== undefined && next !== delimiter && next !== '\n' && next !== '\r') {
          return {
            ok: false,
            problem: { line, column, message: 'text follows a closing quote in the same cell' },
          }
        }
        continue
      }
      if (ch === '\n') {
        line++
        column = 1
      } else {
        column++
      }
      cell += ch
      at++
      continue
    }
    if (ch === '"') {
      if (cell.trim() !== '') {
        return {
          ok: false,
          problem: {
            line,
            column,
            message: 'a quote in the middle of a cell; wrap the whole cell in quotes',
          },
        }
      }
      cell = ''
      quotedAt = { line, column }
      wasQuoted = true
      at++
      column++
      continue
    }
    if (ch === delimiter) {
      endCell()
      at++
      column++
      continue
    }
    if (ch === '\r' || ch === '\n') {
      endRow()
      at += ch === '\r' && source[at + 1] === '\n' ? 2 : 1
      line++
      column = 1
      rowLine = line
      continue
    }
    cell += ch
    at++
    column++
  }
  if (quotedAt !== null) {
    return {
      ok: false,
      problem: { ...quotedAt, message: 'a quoted cell is never closed' },
    }
  }
  endRow()

  const [header, ...rows] = records
  if (header === undefined)
    return { ok: false, problem: { line: 1, column: 1, message: 'it is empty' } }
  const seen = new Map<string, number>()
  for (const [i, name] of header.cells.entries()) {
    if (name === '') {
      return {
        ok: false,
        problem: { line: 1, column: i + 1, message: `column ${i + 1} has no heading` },
      }
    }
    const key = name.toLowerCase()
    if (seen.has(key)) {
      return {
        ok: false,
        problem: { line: 1, column: i + 1, message: `the heading "${name}" appears twice` },
      }
    }
    seen.set(key, i)
  }
  for (const row of rows) {
    if (row.cells.length > header.cells.length) {
      return {
        ok: false,
        problem: {
          line: row.line,
          column: header.cells.length + 1,
          message: `this row has ${row.cells.length} cells but there are only ${header.cells.length} headings`,
        },
      }
    }
    // Spreadsheet exports often stop a row at its last filled cell.
    while (row.cells.length < header.cells.length) row.cells.push('')
  }
  return { ok: true, header: header.cells, rows }
}

/** What a heading means, by its name: one of the known metadata fields, or a trait. */
export type CsvColumn =
  | 'file'
  | 'number'
  | 'name'
  | 'description'
  | 'external_url'
  | 'animation_url'
  | 'background_color'
  | 'youtube_url'
  | 'trait'

const KNOWN: Record<string, CsvColumn> = {
  file: 'file',
  filename: 'file',
  image: 'file',
  imagefile: 'file',
  imagefilename: 'file',
  id: 'number',
  tokenid: 'number',
  token: 'number',
  edition: 'number',
  number: 'number',
  piece: 'number',
  '#': 'number',
  name: 'name',
  title: 'name',
  description: 'description',
  externalurl: 'external_url',
  externallink: 'external_url',
  animationurl: 'animation_url',
  backgroundcolor: 'background_color',
  youtubeurl: 'youtube_url',
}

export function columnOf(heading: string): CsvColumn {
  return KNOWN[heading.toLowerCase().replace(/[\s_-]+/g, '')] ?? 'trait'
}

/** The header row of the template the instructions page offers. */
export const CSV_TEMPLATE_HEADER = ['file', 'name', 'description', 'Background', 'Eyes', 'Hat']
