import axios from 'axios'

export const api = axios.create({
  baseURL: '/api',
  timeout: 180000,
})

export interface Article {
  id: number
  title: string
  body: string
  tags: string[]
  cover_image: string
  images: string[]
  status: string
  score: Record<string, any>
  created_at: string
  updated_at: string
}

export interface Template {
  id: number
  name: string
  category: string
  description: string
  body: string
  tags: string[]
}

export interface Conversation {
  id: number
  title: string
  article_id: number | null
  messages: ChatMessage[]
  active_task_id: string | null
  created_at: string
  updated_at: string
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  images?: string[]
  tool_calls?: any[]
  tool_results?: any[]
  name?: string
}

export interface PublicSettings {
  openai_api_key_mask: string
  openai_api_key_set: boolean
  openai_base_url: string
  chat_model: string
  image_model: string
}

export async function listArticles(): Promise<Article[]> {
  const r = await api.get('/articles')
  return r.data.items
}
export async function getArticle(id: number): Promise<Article> {
  const r = await api.get(`/articles/${id}`)
  return r.data
}
export async function createArticle(payload: Partial<Article>): Promise<Article> {
  const r = await api.post('/articles', payload)
  return r.data
}
export async function updateArticle(id: number, payload: Partial<Article>): Promise<Article> {
  const r = await api.patch(`/articles/${id}`, payload)
  return r.data
}
export async function deleteArticle(id: number) {
  await api.delete(`/articles/${id}`)
}
export async function rewriteArticle(id: number, style: string, instruction: string) {
  const r = await api.post('/articles/rewrite', { article_id: id, style, instruction })
  return r.data
}
export async function optimizeArticle(id: number, focus: string) {
  const r = await api.post('/articles/optimize', { article_id: id, focus })
  return r.data
}
export async function scoreArticle(id: number) {
  const r = await api.post('/articles/score', { article_id: id })
  return r.data
}
export async function diagnoseArticle(id: number) {
  const r = await api.post('/articles/diagnose', { article_id: id })
  return r.data
}
export async function outlineArticle(topic: string, audience?: string) {
  const r = await api.post('/articles/outline', { topic, audience })
  return r.data
}
export async function suggestTitles(topic: string, body?: string, n = 6) {
  const r = await api.post('/articles/suggest_titles', { topic, body, n })
  return r.data
}
export async function suggestTags(topic: string, body?: string) {
  const r = await api.post('/articles/suggest_tags', { topic, body })
  return r.data
}
export async function polishParagraph(paragraph: string, style?: string) {
  const r = await api.post('/articles/polish', { paragraph, style })
  return r.data
}
export async function coverPrompt(topic: string, title?: string, style?: string) {
  const r = await api.post('/articles/cover_prompt', { topic, title, style })
  return r.data
}
export async function contentImagePrompt(
  payload: { article_id?: number; topic?: string; title?: string; body?: string; n?: number }
) {
  const r = await api.post('/articles/content_image_prompt', payload)
  return r.data as { ok: boolean; shots: Array<{ scene: string; prompt: string; size?: string }> }
}
export async function removeArticleImage(
  article_id: number,
  role: 'cover' | 'content',
  index?: number
) {
  const r = await api.post('/articles/remove_image', { article_id, role, index })
  return r.data
}

export interface EditBinding {
  article_id?: number
  role?: 'cover' | 'content'
  replace_index?: number
}

export async function cropImage(payload: {
  image_url: string
  x: number
  y: number
  w: number
  h: number
} & EditBinding) {
  const r = await api.post('/images/crop', payload)
  return r.data as { ok: boolean; image: string }
}

export async function inpaintImage(payload: {
  image_url: string
  mask_url: string
  prompt: string
  size?: string
} & EditBinding) {
  const r = await api.post('/images/inpaint', payload)
  return r.data as { ok: boolean; image: string }
}

export async function removeObject(payload: {
  image_url: string
  mask_url: string
  prompt?: string
  size?: string
} & EditBinding) {
  const r = await api.post('/images/remove_object', payload)
  return r.data as { ok: boolean; image: string }
}

export async function editImage(payload: {
  image_url: string
  prompt: string
  size?: string
} & EditBinding) {
  const r = await api.post('/images/edit', payload)
  return r.data as { ok: boolean; image: string }
}

export async function uploadMask(blob: Blob): Promise<string> {
  const fd = new FormData()
  fd.append('file', blob, 'mask.png')
  const r = await api.post('/images/upload_mask', fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return r.data.url
}
export async function generateImageForArticle(payload: {
  prompt: string
  size?: string
  n?: number
  article_id: number
  role: 'cover' | 'content'
  replace_index?: number
}) {
  const r = await api.post('/mcp/call', {
    name: 'generate_image',
    arguments: payload,
  })
  return r.data.result as { ok: boolean; images: string[] }
}
export async function generateImage(prompt: string, size = '1024x1536', n = 1): Promise<string[]> {
  const r = await api.post('/images/generate', { prompt, size, n })
  return r.data.images
}
export async function uploadImage(file: File): Promise<string> {
  const fd = new FormData()
  fd.append('file', file)
  const r = await api.post('/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
  return r.data.url
}
export async function getMeta() {
  const r = await api.get('/meta')
  return r.data
}
export async function listTemplates(): Promise<Template[]> {
  const r = await api.get('/templates')
  return r.data.items
}
export async function applyTemplate(template_id: number, topic: string): Promise<Article> {
  const r = await api.post('/templates/apply', { template_id, topic })
  return r.data.article
}
export async function listConversations(): Promise<Conversation[]> {
  const r = await api.get('/conversations')
  return r.data.items
}
export async function getConversation(id: number): Promise<Conversation> {
  const r = await api.get(`/conversations/${id}`)
  return r.data
}
export async function createConversation(payload: Partial<Conversation>): Promise<Conversation> {
  const r = await api.post('/conversations', payload)
  return r.data
}
export async function updateConversation(id: number, payload: Partial<Conversation>): Promise<Conversation> {
  const r = await api.patch(`/conversations/${id}`, payload)
  return r.data
}
export async function deleteConversation(id: number) {
  await api.delete(`/conversations/${id}`)
}

export async function getSettings(): Promise<PublicSettings> {
  const r = await api.get('/settings')
  return r.data
}
export async function updateSettings(payload: Partial<PublicSettings> & { openai_api_key?: string }) {
  const r = await api.put('/settings', payload)
  return r.data as PublicSettings
}
export async function testSettings() {
  const r = await api.post('/settings/test')
  return r.data as { ok: boolean; reply?: string; error?: string }
}

export async function getMcpTools() {
  const r = await api.get('/mcp/tools')
  return r.data.tools as Array<{ name: string; description: string; inputSchema: any }>
}

export type StreamEvent =
  | { type: 'token'; text: string }
  | { type: 'task_id'; task_id: string }
  | { type: 'tool_call'; name: string; arguments: any; id: string }
  | { type: 'tool_result'; name: string; result: any; id: string }
  | { type: 'done'; text?: string }
  | { type: 'error'; message: string }

export async function chatStream(
  messages: ChatMessage[],
  onEvent: (ev: StreamEvent) => void,
  signal?: AbortSignal,
  conversationId?: number | null
) {
  const res = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, conversation_id: conversationId || undefined }),
    signal,
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
  if (!res.body) throw new Error('no stream body')
  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() || ''
    for (const part of parts) {
      const line = part.trim()
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (payload === '[DONE]') return
      try {
        onEvent(JSON.parse(payload))
      } catch (e) {
        console.warn('bad sse payload', payload)
      }
    }
  }
}

export interface TaskInfo {
  id: string
  conversation_id: number | null
  status: 'running' | 'completed' | 'failed'
  events: StreamEvent[]
  result_text: string
}

export async function getTask(taskId: string): Promise<TaskInfo> {
  const r = await api.get(`/tasks/${taskId}`)
  return r.data
}

export async function streamTask(
  taskId: string,
  onEvent: (ev: StreamEvent) => void,
  signal?: AbortSignal
) {
  const res = await fetch(`/api/tasks/${taskId}/stream`, { signal })
  if (!res.body) throw new Error('no stream body')
  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() || ''
    for (const part of parts) {
      const line = part.trim()
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (payload === '[DONE]') return
      try {
        onEvent(JSON.parse(payload))
      } catch (e) {
        console.warn('bad sse payload', payload)
      }
    }
  }
}
