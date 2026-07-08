import { describe, it, expect } from 'vitest'
import { fmtEth, heldCount } from './portfolioFormat'
import type { PortfolioData } from './usePortfolio'

const addr = (n: number): `0x${string}` => `0x${n.toString(16).padStart(40, '0')}` as `0x${string}`

describe('fmtEth', () => {
  it('formats whole numbers without trailing dot', () => {
    // 2 ETH = 2000000000000000000n
    expect(fmtEth(2000000000000000000n)).toBe('2')
    // 1 ETH
    expect(fmtEth(1000000000000000000n)).toBe('1')
    // 0 ETH
    expect(fmtEth(0n)).toBe('0')
  })

  it('preserves decimal places without trailing zeros', () => {
    // 1.5 ETH = 1500000000000000000n
    expect(fmtEth(1500000000000000000n)).toBe('1.5')
    // 1.25 ETH = 1250000000000000000n
    expect(fmtEth(1250000000000000000n)).toBe('1.25')
  })

  it('trims trailing zeros after decimal', () => {
    // 1.10 ETH (trimmed from formatEther's 18 decimals) = 1100000000000000000n
    expect(fmtEth(1100000000000000000n)).toBe('1.1')
    // 1.01 ETH = 1010000000000000000n
    expect(fmtEth(1010000000000000000n)).toBe('1.01')
  })

  it('handles very small amounts', () => {
    // 0.1 ETH = 100000000000000000n
    expect(fmtEth(100000000000000000n)).toBe('0.1')
    // 0.01 ETH = 10000000000000000n
    expect(fmtEth(10000000000000000n)).toBe('0.01')
    // 0.001 ETH = 1000000000000000n
    expect(fmtEth(1000000000000000n)).toBe('0.001')
  })

  it('handles wei-precision values', () => {
    // 1 wei = 1n (0.000000000000000001 ETH)
    expect(fmtEth(1n)).toBe('0.000000000000000001')
    // 123456789012345678n wei
    expect(fmtEth(123456789012345678n)).toBe('0.123456789012345678')
  })
})

describe('heldCount', () => {
  it('returns 0 for undefined data', () => {
    expect(heldCount(undefined)).toBe(0)
  })

  it('returns 0 when all balances are empty', () => {
    const data: PortfolioData = [[], [], [], 0n]
    expect(heldCount(data)).toBe(0)
  })

  it('counts ERC-404 holdings with non-zero tokenBalance', () => {
    const data: PortfolioData = [
      [
        {
          instance: addr(1),
          name: 'Token1',
          tokenBalance: 100n,
          nftBalance: 0n,
          stakedBalance: 0n,
          pendingRewards: 0n,
        },
      ],
      [],
      [],
      0n,
    ]
    expect(heldCount(data)).toBe(1)
  })

  it('counts ERC-404 holdings with non-zero nftBalance', () => {
    const data: PortfolioData = [
      [
        {
          instance: addr(1),
          name: 'Token1',
          tokenBalance: 0n,
          nftBalance: 5n,
          stakedBalance: 0n,
          pendingRewards: 0n,
        },
      ],
      [],
      [],
      0n,
    ]
    expect(heldCount(data)).toBe(1)
  })

  it('counts ERC-404 holdings with non-zero stakedBalance', () => {
    const data: PortfolioData = [
      [
        {
          instance: addr(1),
          name: 'Token1',
          tokenBalance: 0n,
          nftBalance: 0n,
          stakedBalance: 50n,
          pendingRewards: 0n,
        },
      ],
      [],
      [],
      0n,
    ]
    expect(heldCount(data)).toBe(1)
  })

  it('counts ERC-404 holdings with non-zero pendingRewards', () => {
    const data: PortfolioData = [
      [
        {
          instance: addr(1),
          name: 'Token1',
          tokenBalance: 0n,
          nftBalance: 0n,
          stakedBalance: 0n,
          pendingRewards: 10n,
        },
      ],
      [],
      [],
      0n,
    ]
    expect(heldCount(data)).toBe(1)
  })

  it('counts ERC-1155 holdings with non-zero balances', () => {
    const data: PortfolioData = [
      [],
      [
        {
          instance: addr(2),
          name: 'Edition1',
          editionIds: [1n, 2n],
          balances: [5n, 0n],
        },
      ],
      [],
      0n,
    ]
    expect(heldCount(data)).toBe(1)
  })

  it('counts both ERC-404 and ERC-1155 holdings', () => {
    const data: PortfolioData = [
      [
        {
          instance: addr(1),
          name: 'Token1',
          tokenBalance: 100n,
          nftBalance: 0n,
          stakedBalance: 0n,
          pendingRewards: 0n,
        },
      ],
      [
        {
          instance: addr(2),
          name: 'Edition1',
          editionIds: [1n],
          balances: [5n],
        },
      ],
      [],
      0n,
    ]
    expect(heldCount(data)).toBe(2)
  })

  it('does not count ERC-404 with all zero balances', () => {
    const data: PortfolioData = [
      [
        {
          instance: addr(1),
          name: 'Token1',
          tokenBalance: 0n,
          nftBalance: 0n,
          stakedBalance: 0n,
          pendingRewards: 0n,
        },
      ],
      [],
      [],
      0n,
    ]
    expect(heldCount(data)).toBe(0)
  })

  it('does not count ERC-1155 with all zero balances', () => {
    const data: PortfolioData = [
      [],
      [
        {
          instance: addr(2),
          name: 'Edition1',
          editionIds: [1n, 2n],
          balances: [0n, 0n],
        },
      ],
      [],
      0n,
    ]
    expect(heldCount(data)).toBe(0)
  })

  it('counts multiple ERC-404 holdings', () => {
    const data: PortfolioData = [
      [
        {
          instance: addr(1),
          name: 'Token1',
          tokenBalance: 100n,
          nftBalance: 0n,
          stakedBalance: 0n,
          pendingRewards: 0n,
        },
        {
          instance: addr(2),
          name: 'Token2',
          tokenBalance: 0n,
          nftBalance: 3n,
          stakedBalance: 0n,
          pendingRewards: 0n,
        },
      ],
      [],
      [],
      0n,
    ]
    expect(heldCount(data)).toBe(2)
  })

  it('counts multiple ERC-1155 holdings', () => {
    const data: PortfolioData = [
      [],
      [
        {
          instance: addr(1),
          name: 'Edition1',
          editionIds: [1n],
          balances: [5n],
        },
        {
          instance: addr(2),
          name: 'Edition2',
          editionIds: [1n],
          balances: [10n],
        },
      ],
      [],
      0n,
    ]
    expect(heldCount(data)).toBe(2)
  })
})
