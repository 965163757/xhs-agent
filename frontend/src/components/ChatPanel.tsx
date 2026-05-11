import { useEffect, useRef, useState } from 'react'
import {
  Box,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
  CircularProgress,
  Chip,
} from '@mui/material'
import SendRoundedIcon from '@mui/icons-material/SendRounded'
import StopCircleIcon from '@mui/icons-material/StopCircle'
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined'
import {
  chatStream,
  uploadImage,
  type ChatMessage,
  type StreamEvent,
  type Article,
} from '../api/client'
import MessageBubble, { type ToolEvent } from './MessageBubble'

export type UiMessage = ChatMessage & { tool_events?: ToolEvent[] }

const toolLabel: Record<string, string> = {
  generate_article: '生成笔记',
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
}

export default function ChatPanel({
  article,
  onArticleMayChange,
  quickActions,
  placeholder,
  height,
  showHeader = true,
}: {
  article?: Article | null
  onArticleMayChange?: () => void
  quickActions?: Array<{ label: string; prompt: string }>
  placeholder?: string
  height?: string | number
  showHeader?: boolean
}) {
  const [messages, setMessages] = useState<UiMessage[]>([])
  const [input, setInput] = useState('')
  const [pendingImages, setPendingImages] = useState<string[]>([])
  const [streaming, setStreaming] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<string>('')

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 1e9, behavior: 'smooth' })
  }, [messages, streaming, status])

  const buildContextPreface = (): UiMessage[] => {
    if (!article) return []
    const body = article.body || ''
    const preview = body.length > 1200 ? body.slice(0, 1200) + '…' : body
    return [
      {
        role: 'user',
        content:
          `【当前笔记上下文 · id=${article.id}】\n` +
          `标题：${article.title}\n` +
          `状态：${article.status}\n` +
          `标签：${(article.tags || []).join(' ')}\n\n` +
          `正文：\n${preview}\n\n` +
          `---\n请把对「笔记 ${article.id}」的任何操作通过工具完成（read/update/rewrite/optimize/score/diagnose/generate_image/remove_image）。` +
          `每次改写/优化前先 read_article 拿最新版。`,
      },
    ]
  }

  async function handleSend(text?: string) {
    const content = (text ?? input).trim()
    if (!content && pendingImages.length === 0) return
    const userMsg: UiMessage = { role: 'user', content, images: pendingImages.slice() }
    const historyForUi = [...messages, userMsg]
    setMessages(historyForUi)
    setInput('')
    setPendingImages([])
    setStreaming(true)
    setStatus('连接中…')

    // messages sent to backend include an optional article-context preface
    const outgoing: UiMessage[] = [...buildContextPreface(), ...historyForUi]

    const assistant: UiMessage = { role: 'assistant', content: '', tool_events: [] }
    setMessages(m => [...m, assistant])

    const controller = new AbortController()
    abortRef.current = controller
    let gotFirstToken = false

    try {
      await chatStream(
        outgoing,
        (ev: StreamEvent) => {
          if (ev.type === 'token') {
            if (!gotFirstToken) {
              gotFirstToken = true
              setStatus('')
            }
          } else if (ev.type === 'tool_call') {
            setStatus(`${toolLabel[ev.name] || ev.name}…`)
          } else if (ev.type === 'tool_result') {
            setStatus('整合结果…')
            onArticleMayChange?.()
          } else if (ev.type === 'done') {
            setStatus('')
          }
          setMessages(m => {
            const copy = m.slice()
            const last = { ...copy[copy.length - 1] } as UiMessage
            last.tool_events = last.tool_events ? [...last.tool_events] : []
            if (ev.type === 'token') {
              last.content += ev.text
            } else if (ev.type === 'tool_call') {
              last.tool_events.push({
                type: 'tool_call',
                name: ev.name,
                arguments: ev.arguments,
              })
            } else if (ev.type === 'tool_result') {
              last.tool_events.push({
                type: 'tool_result',
                name: ev.name,
                result: ev.result,
              })
            } else if (ev.type === 'error') {
              last.content += `\n\n⚠️ ${ev.message}`
            }
            copy[copy.length - 1] = last
            return copy
          })
        },
        controller.signal
      )
    } catch (e: any) {
      setMessages(m => {
        const copy = m.slice()
        const last = { ...copy[copy.length - 1] }
        last.content = (last.content || '') + `\n\n连接中断: ${e?.message || e}`
        copy[copy.length - 1] = last
        return copy
      })
    } finally {
      setStreaming(false)
      setStatus('')
      abortRef.current = null
      onArticleMayChange?.()
    }
  }

  async function handleUpload(file: File) {
    const url = await uploadImage(file)
    setPendingImages(p => [...p, url])
  }

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: height || '100%',
        bgcolor: '#fff',
      }}
    >
      {showHeader && (
        <Stack
          direction="row"
          alignItems="center"
          spacing={1}
          sx={{ px: 2, py: 1.2, borderBottom: '1px solid #EEE9E1' }}
        >
          <Box
            sx={{
              width: 22,
              height: 22,
              borderRadius: '50%',
              background: 'linear-gradient(135deg,#ef4444,#f97316)',
              color: '#fff',
              display: 'grid',
              placeItems: 'center',
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            红
          </Box>
          <Typography sx={{ fontSize: 14, fontWeight: 600 }}>
            {article ? `为笔记 #${article.id} 继续打磨` : 'AI 创作助手'}
          </Typography>
          <Box sx={{ flex: 1 }} />
          {article && (
            <Chip
              size="small"
              label={article.title?.slice(0, 14) || '（无标题）'}
              sx={{ bgcolor: '#F4EFE5', fontSize: 11, height: 20, maxWidth: 160 }}
            />
          )}
        </Stack>
      )}

      <Box
        ref={scrollRef}
        sx={{
          flex: 1,
          overflow: 'auto',
          px: 2,
          py: 1.5,
        }}
      >
        {messages.length === 0 && (
          <Box sx={{ color: '#B8B4AB', fontSize: 13, mt: 1 }}>
            {article ? (
              <Typography sx={{ fontSize: 13, color: '#8A8A8F', mb: 1.5 }}>
                这里的对话会锁定「笔记 #{article.id}」上下文。你可以说：
                <br />
                · 把开头的钩子换得更戳痛点一些
                <br />
                · 加一段产品对比
                <br />
                · 把第 3 段润色一下
                <br />
                · 重新生成封面，要更干净
              </Typography>
            ) : (
              <Typography sx={{ fontSize: 13, color: '#8A8A8F' }}>
                说出你的灵感，我会帮你创作、改写、打分、诊断和配图。
              </Typography>
            )}
            {quickActions && quickActions.length > 0 && (
              <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.6, mt: 1 }}>
                {quickActions.map(q => (
                  <Chip
                    key={q.label}
                    label={q.label}
                    size="small"
                    clickable
                    onClick={() => handleSend(q.prompt)}
                    sx={{
                      bgcolor: '#fff',
                      border: '1px solid #EEE9E1',
                      fontSize: 12,
                      height: 26,
                      '&:hover': { bgcolor: '#FAF7F2', borderColor: '#B8B4AB' },
                    }}
                  />
                ))}
              </Stack>
            )}
          </Box>
        )}

        {messages.map((m, i) => (
          <MessageBubble key={i} msg={m} />
        ))}

        {streaming && status && (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ color: '#8A8A8F', mt: 0.5 }}>
            <CircularProgress size={12} sx={{ color: '#1F1F1F' }} />
            <Typography sx={{ fontSize: 12 }}>{status}</Typography>
          </Stack>
        )}
      </Box>

      <Box sx={{ px: 2, pb: 1.8, pt: 1, borderTop: '1px solid #f1f3f5' }}>
        {pendingImages.length > 0 && (
          <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: 'wrap', gap: 1 }}>
            {pendingImages.map((u, i) => (
              <Box
                key={i}
                component="img"
                src={u}
                sx={{
                  width: 48,
                  height: 48,
                  borderRadius: 1,
                  objectFit: 'cover',
                  border: '1px solid #EEE9E1',
                }}
              />
            ))}
          </Stack>
        )}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: 0.6,
            border: '1px solid #d1d5db',
            borderRadius: 2.5,
            px: 1,
            py: 0.5,
            bgcolor: '#fff',
            '&:focus-within': { borderColor: '#8A8A8F' },
          }}
        >
          <Tooltip title="上传参考图">
            <IconButton component="label" size="small" sx={{ color: '#8A8A8F' }}>
              <ImageOutlinedIcon sx={{ fontSize: 18 }} />
              <input
                type="file"
                hidden
                accept="image/*"
                onChange={e => {
                  const f = e.target.files?.[0]
                  if (f) handleUpload(f)
                  e.target.value = ''
                }}
              />
            </IconButton>
          </Tooltip>
          <TextField
            multiline
            minRows={1}
            maxRows={6}
            fullWidth
            placeholder={placeholder || (article ? '继续对这篇笔记说…' : '说说你的想法')}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                handleSend()
              }
            }}
            variant="standard"
            InputProps={{
              disableUnderline: true,
              sx: { fontSize: 14, py: 0.3 },
            }}
          />
          {streaming ? (
            <IconButton size="small" onClick={() => abortRef.current?.abort()}>
              <StopCircleIcon sx={{ fontSize: 22, color: '#1F1F1F' }} />
            </IconButton>
          ) : (
            <IconButton
              size="small"
              onClick={() => handleSend()}
              disabled={!input.trim() && pendingImages.length === 0}
              sx={{
                bgcolor: '#FF2741',
                color: '#fff',
                '&:hover': { bgcolor: '#D61030' },
                '&.Mui-disabled': { bgcolor: '#EEE9E1', color: '#B8B4AB' },
                width: 30,
                height: 30,
              }}
            >
              <SendRoundedIcon sx={{ fontSize: 16 }} />
            </IconButton>
          )}
        </Box>
      </Box>
    </Box>
  )
}
