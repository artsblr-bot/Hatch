import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Save, Sparkles } from 'lucide-react'
import { db, type Artifact, type ArtifactType } from '@/lib/db'
import { ARTIFACT_TEMPLATES, ARTIFACT_LIST, parseArtifacts, stripArtifacts } from '@/lib/artifacts'
import { useToast } from './Toast'
import { nanoid } from 'nanoid'

interface Props {
  open: boolean
  onClose: () => void
  /** Pre-filled content (the message text). */
  content: string
  sourceMessageId: string
  conversationId: string
  /** Auto-detect an artifact block already present in the content. */
  prefillFromContent?: boolean
}

/**
 * "Save this message" → artifact modal. Lets the user pick an artifact
 * type, edit the title, tweak the body, and tag the result. If the
 * message already contains an `<artifact>` block, we prefill from it
 * so the user doesn't have to re-key anything.
 */
export function SaveArtifactModal({ open, onClose, content, sourceMessageId, conversationId, prefillFromContent = true }: Props) {
  const [type, setType] = useState<ArtifactType>('custom')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [tags, setTags] = useState('')
  const [saving, setSaving] = useState(false)
  const [autoDetect, setAutoDetect] = useState(prefillFromContent)
  const toast = useToast()

  const existingArtifact = useMemo(() => {
    if (!prefillFromContent) return null
    const found = parseArtifacts(content)
    return found[0] || null
  }, [content, prefillFromContent])

  useEffect(() => {
    if (!open) return
    if (existingArtifact) {
      setAutoDetect(true)
      setType(existingArtifact.type)
      setTitle(existingArtifact.title || ARTIFACT_TEMPLATES[existingArtifact.type].defaultTitle)
      setBody(existingArtifact.content)
    } else {
      setAutoDetect(false)
      setType('custom')
      setTitle(content.trim().slice(0, 60).replace(/\n/g, ' ').trim() + (content.length > 60 ? '…' : ''))
      setBody(stripArtifacts(content))
    }
    setTags('')
  }, [open, existingArtifact, content])

  const save = async () => {
    if (!title.trim() || !body.trim()) {
      toast.error('Title and body required')
      return
    }
    setSaving(true)
    try {
      const id = nanoid(12)
      const now = Date.now()
      const artifact: Artifact = {
        id,
        type,
        title: title.trim(),
        content: body.trim(),
        sourceMessageId,
        conversationId,
        tags: tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        createdAt: now,
        updatedAt: now,
      }
      await db.artifacts.put(artifact)
      // Invalidate summary cache so the next summarizer run re-summarises
      await db.artifacts.update(id, { summaryUpdatedAt: 0 })
      toast.success('Saved to library', title.trim())
      onClose()
    } catch (e: any) {
      toast.error('Save failed', e?.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.18 }}
            className="relative flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-bg shadow-soft"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-border-subtle bg-bg-subtle/40 px-4 py-3">
              <Save className="h-4 w-4 text-accent" />
              <div className="flex-1">
                <div className="text-sm font-semibold">Save to library</div>
                <div className="text-[11px] text-fg-muted">
                  {existingArtifact ? 'Detected an artifact in this message — confirm the type.' : 'Pick a type, edit the title, and save.'}
                </div>
              </div>
              <button
                onClick={onClose}
                className="rounded-lg p-1.5 text-fg-subtle transition hover:bg-bg-muted hover:text-fg"
                title="Close"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {/* Type picker */}
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Type</label>
                <div className="mt-2 grid grid-cols-3 gap-1.5 sm:grid-cols-5">
                  {ARTIFACT_LIST.map((t) => (
                    <button
                      key={t.type}
                      onClick={() => {
                        setType(t.type)
                        if (!title.trim() || title === ARTIFACT_TEMPLATES[type].defaultTitle) {
                          setTitle(t.defaultTitle)
                        }
                      }}
                      className={`flex flex-col items-center gap-0.5 rounded-lg border p-2 text-[11px] transition ${
                        type === t.type
                          ? 'border-accent/40 bg-accent/10 text-fg'
                          : 'border-border bg-bg-subtle/30 text-fg-muted hover:border-border hover:bg-bg-muted'
                      }`}
                    >
                      <span className="text-base leading-none">{t.emoji}</span>
                      <span className="truncate">{t.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Title */}
              <div className="mt-4">
                <label className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Title</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={ARTIFACT_TEMPLATES[type].defaultTitle}
                  className="mt-1.5 w-full rounded-lg border border-border bg-bg-subtle/40 px-3 py-1.5 text-sm text-fg placeholder:text-fg-subtle focus:border-fg/20 focus:outline-none focus:ring-2 focus:ring-accent/20"
                />
              </div>

              {/* Body */}
              <div className="mt-4">
                <label className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Body</label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={10}
                  className="mt-1.5 w-full resize-none rounded-lg border border-border bg-bg-subtle/40 px-3 py-2 font-mono text-[12.5px] leading-relaxed text-fg placeholder:text-fg-subtle focus:border-fg/20 focus:outline-none focus:ring-2 focus:ring-accent/20"
                />
                <div className="mt-1 text-[10px] text-fg-subtle">Markdown supported.</div>
              </div>

              {/* Tags */}
              <div className="mt-4">
                <label className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Tags (comma-separated)</label>
                <input
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="e.g. strategy, q1, growth"
                  className="mt-1.5 w-full rounded-lg border border-border bg-bg-subtle/40 px-3 py-1.5 text-sm text-fg placeholder:text-fg-subtle focus:border-fg/20 focus:outline-none focus:ring-2 focus:ring-accent/20"
                />
              </div>

              {autoDetect && existingArtifact && (
                <div className="mt-4 flex items-center gap-1.5 rounded-lg border border-accent/30 bg-accent/5 px-2.5 py-1.5 text-[11px] text-fg-muted">
                  <Sparkles className="h-3 w-3 text-accent" />
                  Pre-filled from an <code className="font-mono text-[10px] text-fg">&lt;artifact&gt;</code> block in the message.
                </div>
              )}
            </div>

            <div className="flex flex-shrink-0 items-center justify-between gap-2 border-t border-border-subtle bg-bg-subtle/40 px-4 py-3">
              <div className="text-[11px] text-fg-subtle">
                Linked to this conversation
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={onClose}
                  className="rounded-lg border border-border bg-bg px-3 py-1.5 text-xs font-medium transition hover:bg-bg-muted focus-ring"
                >
                  Cancel
                </button>
                <button
                  onClick={save}
                  disabled={saving || !title.trim() || !body.trim()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg transition hover:shadow-glow focus-ring disabled:opacity-50"
                >
                  <Save className="h-3 w-3" />
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
