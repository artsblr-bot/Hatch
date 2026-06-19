import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-4 w-4 animate-spin text-fg-subtle', className)} aria-hidden="true" />
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('shimmer rounded-md', className)} aria-hidden="true" />
}
