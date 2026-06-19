/**
 * Live HTML preview: takes a raw HTML string and renders it inside a sandboxed
 * iframe via `srcdoc`. Streams the latest content as the model types, with a
 * small debounce so the iframe doesn't thrash on every token.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Code, ExternalLink, Eye, RefreshCw, Copy, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  html: string
  /** If true, the block is still being written (closing ``` not yet seen) */
  live?: boolean
  /** Optional one-line context the model wrote just before the fence */
  context?: string
}

export function HtmlPreviewCard({ html, live, context }: Props) {
  const [view, setView] = useState<'preview' | 'code'>('preview')
  const [debouncedHtml, setDebouncedHtml] = useState(html)
  const [copied, setCopied] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)

  // Debounce iframe updates during streaming so we don't re-render on every
  // token. The user still sees fresh code in the "code" tab every keystroke.
  useEffect(() => {
    if (!live) {
      setDebouncedHtml(html)
      return
    }
    const t = setTimeout(() => setDebouncedHtml(html), 180)
    return () => clearTimeout(t)
  }, [html, live])

  const openInNewTab = () => {
    const blob = new Blob([debouncedHtml], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const w = window.open(url, '_blank', 'noopener,noreferrer')
    // Revoke the URL after a generous window so the new tab can still load
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
    if (!w) {
      // popup blocked — silent fallback (the blob URL will be GC'd anyway)
    }
  }

  const reloadIframe = () => {
    if (iframeRef.current) {
      // Re-set src to force a reload (srcdoc changes don't always rerun scripts)
      const cur = iframeRef.current
      cur.srcdoc = debouncedHtml
    }
  }

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(debouncedHtml)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable */
    }
  }

  const hasContent = debouncedHtml && debouncedHtml.trim().length > 0
  // Counts
  const lineCount = useMemo(() => debouncedHtml.split('\n').length, [debouncedHtml])

  return (
    <div className="overflow-hidden rounded-2xl border border-accent/30 bg-gradient-to-br from-accent/5 via-bg-subtle to-bg-subtle">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border-subtle bg-bg-subtle/50 px-3 py-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-fg">
          <Eye className="h-3.5 w-3.5 text-accent" />
          HTML preview
          {live && (
            <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-accent">
              <span className="relative inline-block h-1.5 w-1.5">
                <span className="absolute inset-0 animate-think-pulse rounded-full bg-accent" />
              </span>
              live
            </span>
          )}
        </div>
        {context && (
          <div className="flex-1 min-w-0 truncate text-[11px] text-fg-muted">
            {context}
          </div>
        )}
        {!context && <div className="flex-1" />}

        {/* View toggle */}
        <div className="flex items-center gap-0.5 rounded-lg border border-border-subtle bg-bg-subtle/60 p-0.5">
          <button
            type="button"
            onClick={() => setView('preview')}
            className={cn(
              'flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition',
              view === 'preview'
                ? 'bg-fg text-bg'
                : 'text-fg-muted hover:text-fg'
            )}
          >
            <Eye className="h-3 w-3" />
            Preview
          </button>
          <button
            type="button"
            onClick={() => setView('code')}
            className={cn(
              'flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition',
              view === 'code'
                ? 'bg-fg text-bg'
                : 'text-fg-muted hover:text-fg'
            )}
          >
            <Code className="h-3 w-3" />
            Code
          </button>
        </div>

        {view === 'preview' && (
          <button
            type="button"
            onClick={reloadIframe}
            className="rounded-md p-1.5 text-fg-muted transition hover:bg-bg-muted hover:text-fg"
            title="Re-run preview"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
        )}
        <button
          type="button"
          onClick={openInNewTab}
          className="rounded-md p-1.5 text-fg-muted transition hover:bg-bg-muted hover:text-fg"
          title="Open in new tab"
        >
          <ExternalLink className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={copyCode}
          className="rounded-md p-1.5 text-fg-muted transition hover:bg-bg-muted hover:text-fg"
          title="Copy HTML"
        >
          {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
        </button>
      </div>

      {/* Body */}
      <div className="relative">
        {view === 'preview' ? (
          hasContent ? (
            <iframe
              ref={iframeRef}
              title="HTML preview"
              sandbox="allow-scripts allow-forms allow-popups"
              srcDoc={debouncedHtml}
              className="block h-[480px] w-full bg-white"
            />
          ) : (
            <div className="grid h-[480px] place-items-center bg-bg-subtle/40 text-xs text-fg-subtle">
              Waiting for HTML…
            </div>
          )
        ) : (
          <pre className="max-h-[480px] overflow-auto bg-bg-muted p-4 text-[12px] leading-relaxed text-fg-muted">
            <code className="font-mono whitespace-pre">{debouncedHtml}</code>
            {live && (
              <span className="ml-0.5 inline-block h-3 w-1.5 -translate-y-px animate-pulse rounded-sm bg-fg-muted align-middle" />
            )}
          </pre>
        )}
        {view === 'code' && (
          <div className="border-t border-border-subtle bg-bg-subtle/40 px-3 py-1.5 text-[10px] uppercase tracking-wider text-fg-subtle">
            {lineCount} {lineCount === 1 ? 'line' : 'lines'}
          </div>
        )}
      </div>
    </div>
  )
}
