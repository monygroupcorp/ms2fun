// @vitest-environment node
import { describe, expect, it } from 'vitest'

import {
  describeProblem,
  minifyJsonObject,
  minifyJsonObjectList,
  withImage,
  type MinifiedObject,
} from './pieceJson'

function ok(text: string): MinifiedObject {
  const result = minifyJsonObject(text)
  if (!result.ok) throw new Error(result.problem.message)
  return result
}

describe('minifyJsonObject', () => {
  it('keeps every field as written, in the creator order, without the whitespace', () => {
    const text = `{
      "name": "Sprite #1",
      "2": "an integer-like key stays where it was",
      "big": 12345678901234567890123,
      "float": 1.50,
      "escaped": "caf\\u00e9 \\"quoted\\"",
      "attributes": [ { "trait_type": "Eyes", "value": "Laser" } ],
      "image": "ipfs://NewUriToReplace/1.png",
      "animation_url": "https://example.org/1.mp4"
    }`
    const json = ok(text)
    expect(json.text).toBe(
      '{"name":"Sprite #1","2":"an integer-like key stays where it was",' +
        '"big":12345678901234567890123,"float":1.50,"escaped":"caf\\u00e9 \\"quoted\\"",' +
        '"attributes":[{"trait_type":"Eyes","value":"Laser"}],' +
        '"image":"ipfs://NewUriToReplace/1.png","animation_url":"https://example.org/1.mp4"}',
    )
    expect(json.keys).toEqual([
      'name',
      '2',
      'big',
      'float',
      'escaped',
      'attributes',
      'image',
      'animation_url',
    ])
    expect(json.image).toBe('ipfs://NewUriToReplace/1.png')
  })

  it('is idempotent, so the same text always gives the same bytes', () => {
    const once = ok('{ "a" : [1, 2 ,{"b":null}], "image":"x" }').text
    expect(ok(once).text).toBe(once)
  })

  it('drops a byte-order mark', () => {
    expect(ok('﻿{"name":"x"}').text).toBe('{"name":"x"}')
  })

  it.each([
    ['{"name": "x",}', 1, 14, 'expected a string'],
    ['{"name": \'x\'}', 1, 10, 'expected a value'],
    ['{"name": "x"\n"image": "y"}', 2, 1, 'expected "," or "}"'],
    ['{"name": "x"', 1, 13, 'the file ends where "," or "}" was expected'],
    ['[{"name":"x"}]', 1, 1, 'expected one object, found a list'],
    ['{"image":"a","image":"b"}', 1, 14, '"image" appears twice'],
    ['{"a":"line\nbreak"}', 1, 11, 'a string holds a raw control character or line break'],
    ['{"a":1} {}', 1, 9, 'there is more after the object'],
    ['// comment\n{}', 1, 1, 'expected a JSON object'],
  ])('names the line and column of what is wrong: %s', (text, line, column, message) => {
    const result = minifyJsonObject(text)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.problem).toEqual({ line, column, message })
  })

  it('describes a problem the way an editor would locate it', () => {
    expect(describeProblem('json/3.json', { line: 4, column: 2, message: 'expected ":"' })).toBe(
      'json/3.json, line 4, column 2: expected ":"',
    )
  })
})

describe('withImage', () => {
  it('rewrites only the top-level image value', () => {
    const json = ok('{"name":"x","image":"ipfs://NewUriToReplace/1.png","extra":{"image":"keep"}}')
    expect(withImage(json, 'https://art.example/ipfs/bafy/1.png')).toBe(
      '{"name":"x","image":"https://art.example/ipfs/bafy/1.png","extra":{"image":"keep"}}',
    )
  })

  it('adds an image as the last key when the piece has none', () => {
    expect(withImage(ok('{"name":"x"}'), 'L')).toBe('{"name":"x","image":"L"}')
    expect(withImage(ok('{}'), 'L')).toBe('{"image":"L"}')
  })

  it('replaces any kind of image value, not just a string', () => {
    expect(withImage(ok('{"image":null,"n":1}'), 'L')).toBe('{"image":"L","n":1}')
  })
})

describe('minifyJsonObjectList', () => {
  it('returns each object of an aggregate file on its own', () => {
    const result = minifyJsonObjectList('[\n {"edition": 1, "image": "a.png"},\n {"edition": 2}\n]')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.objects.map((o) => o.text)).toEqual([
      '{"edition":1,"image":"a.png"}',
      '{"edition":2}',
    ])
    expect(withImage(result.objects[0]!, 'L')).toBe('{"edition":1,"image":"L"}')
    expect(result.objects[1]!.image).toBeUndefined()
  })

  it('refuses an item that is not an object, naming which', () => {
    const result = minifyJsonObjectList('[{}, 3]')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.problem).toEqual({ line: 1, column: 6, message: 'item 2 is not an object' })
  })
})
