import {
  chatStream,
  cancelTask,
  createConversation,
  getConversation,
  getTask,
  streamTask,
  updateConversation,
  type ChatMessage,
  type StreamEvent,
  type Article,
} from './api/client'
import type { ToolEvent } from './components/MessageBubble'

export type UiMessage = ChatMessage & { tool_events?: ToolEvent[] }

export type SessionState = {
  messages: UiMessage[]
  streaming: boolean
  status: string
  pendingImages: string[]
  input: string
  conversationId: number | null
  taskId: string | null
  abort?: AbortController
  version: number
}

type Listener = () => void

function emptyState(): SessionState {
  return {
    messages: [],
    streaming: false,
    status: '',
    pendingImages: [],
    input: '',
    conversationId: null,
    taskId: null,
    version: 0,
  }
}

// --- snapshots: immutable objects returned by getSnapshot ---
const snapshots: Record<string, SessionState> = {}
const sessions: Record<string, SessionState> = {}
const listeners: Record<string, Set<Listener>> = {}

function ensure(key: string): SessionState {
  if (!sessions[key]) sessions[key] = emptyState()
  return sessions[key]
}

function makeSnapshot(key: string): SessionState {
  const s = ensure(key)
  // Create a new object reference so useSyncExternalStore detects the change
  snapshots[key] = { ...s }
  return snapshots[key]
}

function bump(key: string) {
  const s = ensure(key)
  s.version += 1
  makeSnapshot(key)
  listeners[key]?.forEach(l => l())
  // If other keys share the same session object, update their snapshots too
  for (const k of Object.keys(sessions)) {
    if (k !== key && sessions[k] === s) {
      snapshots[k] = { ...s }
      listeners[k]?.forEach(l => l())
    }
  }
}

export function sessionKeyFor(articleId: number | null | undefined): string {
  return articleId ? `article:${articleId}` : 'new'
}

export function getSession(key: string): SessionState {
  if (!snapshots[key]) makeSnapshot(key)
  return snapshots[key]
}

export function subscribe(key: string, fn: Listener): () => void {
  if (!listeners[key]) listeners[key] = new Set()
  listeners[key].add(fn)
  return () => { listeners[key].delete(fn) }
}

export function setInput(key: string, input: string) {
  ensure(key).input = input
  bump(key)
}

export function setPendingImages(key: string, images: string[]) {
  ensure(key).pendingImages = images
  bump(key)
}

export function resetSession(key: string) {
  const s = ensure(key)
  if (s.abort) { try { s.abort.abort() } catch { /* */ } }
  sessions[key] = emptyState()
  bump(key)
}

export function abortSession(key: string) {
  const s = ensure(key)
  if (s.taskId) cancelTask(s.taskId).catch(() => {})
  if (s.abort) { try { s.abort.abort() } catch { /* */ } s.abort = undefined }
  s.streaming = false
  s.status = ''
  bump(key)
}

export function migrateSession(oldKey: string, newKey: string) {
  if (oldKey === newKey) return
  const s = sessions[oldKey]
  if (!s) return
  // Both keys now share the same session object
  sessions[newKey] = s
  // Merge listeners so bump(oldKey) also notifies newKey subscribers
  if (!listeners[newKey]) listeners[newKey] = new Set()
  if (listeners[oldKey]) {
    for (const l of listeners[oldKey]) listeners[newKey].add(l)
  }
  listeners[oldKey] = listeners[newKey]
  makeSnapshot(newKey)
  makeSnapshot(oldKey)
  listeners[newKey].forEach(l => l())
}

export function getConversationId(key: string): number | null {
  return ensure(key).conversationId
}

export async function loadFromConversation(convId: number, key: string): Promise<string | null> {
  const conv = await getConversation(convId)
  const s = ensure(key)
  s.messages = (conv.messages || []) as UiMessage[]
  s.conversationId = convId
  bump(key)
  return conv.active_task_id || null
}

function buildContextPreface(article?: Article | null): UiMessage[] {
  if (!article) return []
  const body = article.body || ''
  const preview = body.length > 1200 ? body.slice(0, 1200) + '…' : body
  return [{
    role: 'user',
    content:
      `【当前笔记上下文 · id=${article.id}】\n` +
      `标题：${article.title}\n` +
      `状态：${article.status}\n` +
      `标签：${(article.tags || []).join(' ')}\n\n` +
      `正文：\n${preview}\n\n` +
      `---\n请把对「笔记 ${article.id}」的任何操作通过工具完成（read/update/rewrite/optimize/score/diagnose/generate_image/remove_image）。` +
      `每次改写/优化前先 read_article 拿最新版。`,
  }]
}

const toolLabel: Record<string, string> = {
  generate_article: '生成笔记',
  create_complete_note_workflow: '一键成稿',
  rewrite_article: '改写',
  optimize_article: '优化',
  polish_paragraph: '润色',
  score_article: '打分',
  diagnose_article: '诊断',
  create_article: '创建',
  update_article: '更新',
  read_article: '读取',
  list_articles: '列出',
  delete_article: '删除',
  generate_image: '配图',
  remove_image: '删图',
  suggest_tags: '标签',
  suggest_titles: '标题',
  outline_article: '大纲',
  cover_prompt: '封面 Prompt',
  content_image_prompt: '配图 Prompt',
  list_templates: '模板',
  apply_template: '应用模板',
  search_articles: '搜索',
  batch_score: '批量打分',
  batch_optimize: '批量优化',
  export_articles: '导出',
  article_stats: '统计',
  schedule_publish: '定时发布',
  crop_image: '裁剪',
  inpaint_image: '局部重绘',
  remove_object: '消除',
  edit_image: '编辑图片',
}

async function persistToBackend(key: string, articleId?: number | null) {
  const s = ensure(key)
  const title = s.messages.find(m => m.role === 'user')?.content?.slice(0, 30) || '新对话'
  try {
    if (s.conversationId) {
      await updateConversation(s.conversationId, {
        messages: s.messages as any,
        title,
      })
    } else {
      const conv = await createConversation({
        title,
        article_id: articleId ?? undefined,
        messages: s.messages as any,
      } as any)
      s.conversationId = conv.id
      bump(key)
    }
  } catch {
    /* network failure — non-critical */
  }
}

export async function sendMessage(
  key: string,
  text: string,
  opts: {
    article?: Article | null
    images?: string[]
    onArticleMayChange?: () => void
    onConversationCreated?: (id: number) => void
    onArticleCreated?: (id: number) => void
  } = {}
) {
  const s = ensure(key)
  if (s.streaming) return
  const content = text.trim()
  const images = opts.images ?? s.pendingImages.slice()
  if (!content && images.length === 0) return

  const userMsg: UiMessage = { role: 'user', content, images }
  const assistant: UiMessage = { role: 'assistant', content: '', tool_events: [] }

  s.messages = [...s.messages, userMsg, assistant]
  s.pendingImages = []
  s.input = ''
  s.streaming = true
  s.status = '连接中…'
  const controller = new AbortController()
  s.abort = controller
  bump(key)

  // Persist immediately so the conversation exists in backend before stream starts.
  // This way a mid-stream refresh won't lose messages.
  await persistToBackend(key, opts.article?.id)
  const newConvId = ensure(key).conversationId
  if (newConvId) {
    const url = new URL(window.location.href)
    if (url.searchParams.get('c') !== String(newConvId)) {
      url.searchParams.set('c', String(newConvId))
      if (opts.article?.id) url.searchParams.set('article', String(opts.article.id))
      window.history.replaceState(null, '', url.toString())
      opts.onConversationCreated?.(newConvId)
    }
  }

  const outgoing: UiMessage[] = [
    ...buildContextPreface(opts.article),
    ...s.messages.slice(0, -1),
  ]

  // Throttled save: persist at most once every 3s during streaming
  let lastPersist = Date.now()
  const maybePersist = () => {
    const now = Date.now()
    if (now - lastPersist > 3000) {
      lastPersist = now
      persistToBackend(key, opts.article?.id)
    }
  }

  let gotFirstToken = false
  try {
    await chatStream(
      outgoing,
      (ev: StreamEvent) => {
        const cur = ensure(key)
        if (ev.type === 'task_id') {
          cur.taskId = ev.task_id
          bump(key)
          return
        } else if (ev.type === 'token') {
          if (!gotFirstToken) { gotFirstToken = true; cur.status = '' }
        } else if (ev.type === 'tool_call') {
          cur.status = `${toolLabel[ev.name] || ev.name}…`
        } else if (ev.type === 'tool_result') {
          cur.status = '整合结果…'
          opts.onArticleMayChange?.()
          if (ev.name === 'generate_article' && ev.result?.ok && ev.result?.article?.id) {
            opts.onArticleCreated?.(ev.result.article.id)
          }
          maybePersist()
        } else if (ev.type === 'done') {
          cur.status = ''
        } else if (ev.type === 'cancelled') {
          cur.status = ''
        }

        const copy = cur.messages.slice()
        const last = { ...copy[copy.length - 1] } as UiMessage
        last.tool_events = last.tool_events ? [...last.tool_events] : []
        if (ev.type === 'token') {
          last.content += ev.text
        } else if (ev.type === 'tool_call') {
          last.tool_events.push({ type: 'tool_call', name: ev.name, arguments: ev.arguments })
        } else if (ev.type === 'tool_result') {
          last.tool_events.push({ type: 'tool_result', name: ev.name, result: ev.result })
        } else if (ev.type === 'error') {
          last.content += `\n\n⚠️ ${ev.message}`
        } else if (ev.type === 'cancelled') {
          if (!last.content.trim()) last.content = '已停止生成。'
        }
        copy[copy.length - 1] = last
        cur.messages = copy
        bump(key)
      },
      controller.signal,
      s.conversationId
    )
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      // User cancelled — no error message needed
    } else {
      const cur = ensure(key)
      const copy = cur.messages.slice()
      if (copy.length > 0 && copy[copy.length - 1].role === 'assistant') {
        const last = { ...copy[copy.length - 1] } as UiMessage
        last.content += `\n\n⚠️ 网络异常，请检查连接后重试`
        copy[copy.length - 1] = last
      }
      cur.messages = copy
      bump(key)
    }
  } finally {
    const cur = ensure(key)
    cur.streaming = false
    cur.status = ''
    cur.abort = undefined
    bump(key)
    opts.onArticleMayChange?.()
  }

  // Final persist with complete messages
  await persistToBackend(key, opts.article?.id)
}

export async function reconnectTask(
  key: string,
  taskId: string,
  opts: { onArticleMayChange?: () => void } = {}
) {
  const s = ensure(key)
  if (s.streaming) return

  s.streaming = true
  s.status = '重新连接…'
  s.taskId = taskId
  const controller = new AbortController()
  s.abort = controller
  bump(key)

  try {
    const task = await getTask(taskId)

    if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
      // Task already finished — apply stored result
      const cur = ensure(key)
      const copy = cur.messages.slice()
      if (copy.length > 0 && copy[copy.length - 1].role === 'assistant') {
        const last = { ...copy[copy.length - 1] } as UiMessage
        const storedText = task.result_text || (task.events || [])
          .filter((ev): ev is Extract<StreamEvent, { type: 'token' }> => ev.type === 'token')
          .map(ev => ev.text)
          .join('')
        if (storedText) last.content = storedText
        const toolEvents: ToolEvent[] = []
        for (const ev of task.events) {
          if (ev.type === 'tool_call') toolEvents.push(ev as ToolEvent)
          else if (ev.type === 'tool_result') toolEvents.push(ev as ToolEvent)
        }
        if (toolEvents.length) last.tool_events = toolEvents
        copy[copy.length - 1] = last
      }
      cur.messages = copy
      cur.streaming = false
      cur.status = ''
      cur.taskId = null
      cur.abort = undefined
      bump(key)
      opts.onArticleMayChange?.()
      return
    }

    // Task still running — connect to live stream
    const cur = ensure(key)
    const replayEvents = task.events || []
    if (replayEvents.length) {
      const copy = cur.messages.slice()
      if (copy.length > 0 && copy[copy.length - 1].role === 'assistant') {
        const last = { ...copy[copy.length - 1] } as UiMessage
        last.content = replayEvents
          .filter((ev): ev is Extract<StreamEvent, { type: 'token' }> => ev.type === 'token')
          .map(ev => ev.text)
          .join('')
        const toolEvents: ToolEvent[] = []
        for (const ev of replayEvents) {
          if (ev.type === 'tool_call') toolEvents.push(ev as ToolEvent)
          else if (ev.type === 'tool_result') toolEvents.push(ev as ToolEvent)
        }
        last.tool_events = toolEvents
        copy[copy.length - 1] = last
      }
      cur.messages = copy
    }
    cur.status = '继续生成中…'
    bump(key)

    await streamTask(
      taskId,
      (ev: StreamEvent) => {
        const cur = ensure(key)
        if (ev.type === 'task_id') return
        if (ev.type === 'token') {
          cur.status = ''
        } else if (ev.type === 'tool_call') {
          cur.status = `${toolLabel[ev.name] || ev.name}…`
        } else if (ev.type === 'tool_result') {
          cur.status = '整合结果…'
          opts.onArticleMayChange?.()
        } else if (ev.type === 'done') {
          cur.status = ''
        } else if (ev.type === 'cancelled') {
          cur.status = ''
        }

        const copy = cur.messages.slice()
        if (copy.length > 0 && copy[copy.length - 1].role === 'assistant') {
          const last = { ...copy[copy.length - 1] } as UiMessage
          last.tool_events = last.tool_events ? [...last.tool_events] : []
          if (ev.type === 'token') {
            last.content += ev.text
          } else if (ev.type === 'tool_call') {
            last.tool_events.push({ type: 'tool_call', name: ev.name, arguments: ev.arguments })
          } else if (ev.type === 'tool_result') {
            last.tool_events.push({ type: 'tool_result', name: ev.name, result: ev.result })
          } else if (ev.type === 'error') {
            last.content += `\n\n⚠️ ${ev.message}`
          } else if (ev.type === 'cancelled') {
            if (!last.content.trim()) last.content = '已停止生成。'
          }
          copy[copy.length - 1] = last
        }
        cur.messages = copy
        bump(key)
      },
      controller.signal,
      replayEvents.length
    )
  } catch {
    // reconnection failed silently
  } finally {
    const cur = ensure(key)
    cur.streaming = false
    cur.status = ''
    cur.taskId = null
    cur.abort = undefined
    bump(key)
    opts.onArticleMayChange?.()
  }
}
