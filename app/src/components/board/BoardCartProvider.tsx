/**
 * BoardCartProvider — holds the queued board actions and warns before unload if any are still
 * un-finalized (not yet on-chain). See boardCart.ts for the context/hook and BoardCartBar for the
 * finalize UI.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { BoardCartContext, type BoardCartValue, type CartAction } from './boardCart'

export function BoardCartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartAction[]>([])
  const seq = useRef(0)

  const add = useCallback((action: Omit<CartAction, 'id'>) => {
    setItems((prev) => [...prev, { ...action, id: `cart-${seq.current++}` }])
  }, [])
  const remove = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id))
  }, [])
  const clear = useCallback(() => setItems([]), [])

  // Un-finalized actions are NOT on-chain yet — warn before the page unloads and loses them.
  useEffect(() => {
    if (items.length === 0) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [items.length])

  const value = useMemo<BoardCartValue>(
    () => ({ items, add, remove, clear, count: items.length }),
    [items, add, remove, clear],
  )

  return <BoardCartContext.Provider value={value}>{children}</BoardCartContext.Provider>
}
