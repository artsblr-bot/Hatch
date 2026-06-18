/**
 * Archival memory node search and CRUD.
 *
 * Uses the same BM25 ranking and tokenisation stack as artifactSearch.ts,
 * but operates on the free-form `memoryNodes` table instead of saved
 * Library artifacts. Results are importance-boosted so higher-importance
 * nodes float to the top when BM25 scores tie.
 */

import { nanoid } from 'nanoid'
import { db, type MemoryNode, type MemoryNodeType } from './db'
import { tokenize, stem } from './searchUtils'

// BM25 hyper-parameters (same as artifactSearch for consistency)
const K1 = 1.5
const B = 0.75

export interface MemorySearchHit {
  node: MemoryNode
  score: number
  snippet: string
}

export async function searchMemoryNodes(query: string, maxResults = 6): Promise<MemorySearchHit[]> {
  const nodes = await db.memoryNodes.toArray()
  if (nodes.length === 0) return []

  const queryTokens = tokenize(query).map(stem)
  if (queryTokens.length === 0) {
    return nodes
      .sort((a, b) => b.importance - a.importance || b.createdAt - a.createdAt)
      .slice(0, maxResults)
      .map((n) => ({ node: n, score: 1, snippet: n.content.slice(0, 140) }))
  }

  // Build per-document term frequencies and document lengths
  const tf = new Map<string, Map<string, number>>()
  const dl = new Map<string, number>()
  let totalLength = 0

  for (const node of nodes) {
    const text = [node.content, ...node.tags].join(' ')
    const tokens = tokenize(text).map(stem)
    dl.set(node.id, tokens.length)
    totalLength += tokens.length
    for (const t of tokens) {
      if (!tf.has(t)) tf.set(t, new Map())
      const m = tf.get(t)!
      m.set(node.id, (m.get(node.id) || 0) + 1)
    }
  }

  const avgdl = totalLength / nodes.length
  const N = nodes.length
  const scores = new Map<string, number>()

  for (const qt of queryTokens) {
    const postings = tf.get(qt) || new Map()
    const df = postings.size
    if (df === 0) continue
    const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1)
    for (const node of nodes) {
      const freq = postings.get(node.id) || 0
      if (freq === 0) continue
      const docLen = dl.get(node.id) || 1
      const tfNorm = (freq * (K1 + 1)) / (freq + K1 * (1 - B + B * (docLen / avgdl)))
      scores.set(node.id, (scores.get(node.id) || 0) + idf * tfNorm)
    }
  }

  // Boost score by node importance so high-value nodes rise when BM25 ties
  for (const [id, score] of scores) {
    const node = nodes.find((n) => n.id === id)
    if (node) scores.set(id, score * (1 + node.importance * 0.4))
  }

  const ranked = nodes
    .filter((n) => (scores.get(n.id) || 0) > 0)
    .sort((a, b) => (scores.get(b.id) || 0) - (scores.get(a.id) || 0))
    .slice(0, maxResults)

  return ranked.map((n) => ({
    node: n,
    score: scores.get(n.id) || 0,
    snippet: n.content.length > 140 ? n.content.slice(0, 140) + '…' : n.content,
  }))
}

/** Search and increment recallCount on returned nodes. */
export async function recallMemory(query: string, maxResults = 6): Promise<MemorySearchHit[]> {
  const hits = await searchMemoryNodes(query, maxResults)
  if (hits.length > 0) {
    await Promise.all(
      hits.map((h) => db.memoryNodes.update(h.node.id, { recallCount: h.node.recallCount + 1 }))
    )
  }
  return hits
}

export async function addMemoryNode(
  content: string,
  type: MemoryNodeType,
  tags: string[],
  sourceConversationId?: string,
  importance = 0.5
): Promise<MemoryNode> {
  const node: MemoryNode = {
    id: nanoid(12),
    content,
    type,
    tags,
    sourceConversationId,
    importance,
    recallCount: 0,
    compacted: false,
    createdAt: Date.now(),
  }
  await db.memoryNodes.add(node)
  return node
}

export async function deleteMemoryNode(id: string): Promise<void> {
  await db.memoryNodes.delete(id)
}

/** Format search hits into a concise block the model can reason over. */
export function formatMemoryHitsForModel(hits: MemorySearchHit[]): string {
  if (hits.length === 0) return 'No matching memories found.'
  return hits
    .map((h, i) => {
      const tags = h.node.tags.length > 0 ? ` [${h.node.tags.join(', ')}]` : ''
      const date = new Date(h.node.createdAt).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
      return `[${i + 1}] ${h.node.type}${tags} · ${date}\n${h.node.content}`
    })
    .join('\n\n')
}
