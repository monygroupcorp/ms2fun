import { QueryClient } from '@tanstack/react-query'

/** Single TanStack Query client — the only read-cache layer (wagmi reads flow through it). */
export const queryClient = new QueryClient()
