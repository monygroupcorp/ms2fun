/**
 * Board transaction cart — context, hook, and shared shape. The `<BoardCartProvider>` component lives
 * in its own file (BoardCartProvider.tsx) so this module only exports non-components (keeps
 * react-refresh happy).
 *
 * Opt-in model: board writes (post/reply/react) are all `GlobalMessageRegistry` posts, and the
 * registry's native `postBatch(tuple[])` preserves `msg.sender` — so a session of queued board
 * actions folds into ONE transaction (finalized by `<BoardCartBar>`).
 */
import { createContext, useContext } from 'react'

export const ZERO_BYTES32 =
  '0x0000000000000000000000000000000000000000000000000000000000000000' as const

/** One queued board action, shaped as a `postBatch` tuple plus a human label for the cart list. */
export interface CartAction {
  id: string
  instance: `0x${string}`
  /** 0 = post · 1 = reply · 3 = react (endorse). */
  messageType: number
  refId: bigint
  actionRef: `0x${string}`
  metadata: `0x${string}`
  content: string
  label: string
}

export interface BoardCartValue {
  items: CartAction[]
  add: (action: Omit<CartAction, 'id'>) => void
  remove: (id: string) => void
  clear: () => void
  count: number
}

export const BoardCartContext = createContext<BoardCartValue | null>(null)

export function useBoardCart(): BoardCartValue {
  const value = useContext(BoardCartContext)
  if (value === null) throw new Error('useBoardCart must be used within a BoardCartProvider')
  return value
}
