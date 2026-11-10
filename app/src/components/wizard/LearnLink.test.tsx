/**
 * LearnLink opens in a NEW TAB via a raw `<a>` (see LearnLink.tsx), which bypasses wouter's own
 * hash-rewriting for `Link`. On the IPFS target a root-anchored href here walks a click straight
 * out of the pinned document to the gateway's own 404 (reproduced live at
 * noesis.gwei.domains/learn/erc404 — "this page doesn't exist on noesis.gwei").
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { LearnLink } from './LearnLink'

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

test('web target: href is a plain root-relative path', () => {
  render(<LearnLink slug="erc404" />)
  expect(screen.getByRole('link').getAttribute('href')).toBe('/learn/erc404')
})

test('ipfs target: href is a hash fragment, not a root-relative path', () => {
  vi.stubEnv('VITE_DIST_TARGET', 'ipfs')
  render(<LearnLink slug="erc404" />)
  expect(screen.getByRole('link').getAttribute('href')).toBe('#/learn/erc404')
})
