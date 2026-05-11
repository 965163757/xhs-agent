import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Box,
  Button,
  IconButton,
  Stack,
  Tooltip,
  Typography,
  Drawer,
  List,
  ListItemButton,
  ListItemText,
  Divider,
} from '@mui/material'
import MenuIcon from '@mui/icons-material/Menu'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import {
  listConversations,
  deleteConversation,
  getArticle,
  type Conversation,
  type Article,
} from '../api/client'
import ChatPanel from '../components/ChatPanel'
import { loadFromConversation, migrateSession, reconnectTask, resetSession, sessionKeyFor, getSession } from '../chatStore'

const suggestions = [
  { icon: '✍️', title: '从零写一篇', prompt: '帮我写一篇「早C晚A护肤」的小红书笔记' },
  { icon: '🔄', title: '改写现有稿', prompt: '帮我把笔记 #1 改写得更有网感、加强钩子' },
  { icon: '🎨', title: '生成封面', prompt: '为笔记 #1 生成一张干净、高级感的竖版封面' },
  { icon: '🧪', title: '发布前诊断', prompt: '帮我诊断笔记 #1 能不能发，有没有违禁词' },
]

export default function ChatPage() {
  const [params, setParams] = useSearchParams()
  const articleId = params.get('article')
  const convId = params.get('c')
  const [article, setArticle] = useState<Article | null>(null)
  const [sidebar, setSidebar] = useState(false)
  const [convos, setConvos] = useState<Conversation[]>([])

  // The session key used by chatStore
  const currentSessionKey = convId ? `conv:${convId}` : sessionKeyFor(articleId ? Number(articleId) : null)

  // Load article context if ?article= is set
  useEffect(() => {
    if (articleId) {
      getArticle(Number(articleId))
        .then(setArticle)
        .catch(() => setArticle(null))
    } else {
      setArticle(null)
    }
  }, [articleId])

  // On mount / when ?c= changes, hydrate store from backend conversation
  useEffect(() => {
    if (convId) {
      // Don't reload from backend if we're already streaming (e.g. just created this conversation)
      const current = getSession(currentSessionKey)
      if (current.streaming) return
      loadFromConversation(Number(convId), currentSessionKey).then((activeTaskId) => {
        if (activeTaskId) {
          reconnectTask(currentSessionKey, activeTaskId, { onArticleMayChange: undefined })
        }
      }).catch(() => {})
    }
  }, [convId, currentSessionKey])

  const refreshConvos = () => {
    listConversations().then(setConvos).catch(() => setConvos([]))
  }
  useEffect(() => { refreshConvos() }, [])

  const newChat = () => {
    resetSession(currentSessionKey)
    setParams({})
  }

  const handleConversationCreated = useCallback((id: number) => {
    const newKey = `conv:${id}`
    migrateSession(currentSessionKey, newKey)
    const next: Record<string, string> = { c: String(id) }
    if (articleId) next.article = articleId
    setParams(next, { replace: true })
  }, [articleId, setParams, currentSessionKey])

  const removeConvo = async (id: number) => {
    if (!confirm('删除这条对话？')) return
    await deleteConversation(id)
    refreshConvos()
  }

  return (
    <Box sx={{ height: 'calc(100vh - 56px)', display: 'flex', flexDirection: 'column' }}>
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{ px: 2, py: 0.8, borderBottom: '1px solid #EEE9E1' }}
      >
        <Tooltip title="历史对话">
          <IconButton onClick={() => { refreshConvos(); setSidebar(true) }} size="small">
            <MenuIcon sx={{ fontSize: 20 }} />
          </IconButton>
        </Tooltip>
        <Typography sx={{ ml: 0.5, fontSize: 13, color: '#8A8A8F' }}>
          {article ? `锁定笔记 #${article.id} · ${article.title?.slice(0, 18) || ''}` : '新对话'}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Button
          size="small"
          startIcon={<AddIcon sx={{ fontSize: 18 }} />}
          onClick={newChat}
          sx={{ color: '#1F1F1F' }}
        >
          新对话
        </Button>
      </Stack>

      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', justifyContent: 'center' }}>
        <Box sx={{ width: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <ChatPanel
            article={article}
            sessionKey={currentSessionKey}
            showHeader={false}
            placeholder={article ? '继续对这篇笔记说…' : '发消息给小红书助手…'}
            heroActions={article ? undefined : suggestions}
            onConversationCreated={handleConversationCreated}
            quickActions={
              article
                ? [
                    { label: '加强钩子', prompt: '开头钩子不够戳人，帮我改得更痛一点' },
                    { label: '整体改写', prompt: '把整篇改写得更有网感、更口语化' },
                    { label: '打分', prompt: '先读一次当前正文，然后给它做五维打分' },
                    { label: '诊断', prompt: '做发布前诊断，重点查违禁词和 CTA' },
                    { label: '生成封面', prompt: '为这篇笔记生成一张干净、高级感的竖版封面' },
                  ]
                : undefined
            }
          />
        </Box>
      </Box>

      <Drawer open={sidebar} onClose={() => setSidebar(false)}>
        <Box sx={{ width: 300, bgcolor: '#fff' }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ p: 2 }}>
            <Typography variant="subtitle1" fontWeight={700}>
              历史对话
            </Typography>
            <Box sx={{ flex: 1 }} />
            <Button
              size="small"
              startIcon={<AddIcon sx={{ fontSize: 16 }} />}
              onClick={() => {
                newChat()
                setSidebar(false)
              }}
            >
              新建
            </Button>
          </Stack>
          <Divider />
          <List dense>
            {convos.map(c => (
              <ListItemButton
                key={c.id}
                onClick={() => {
                  const next: Record<string, string> = { c: String(c.id) }
                  if (c.article_id) next.article = String(c.article_id)
                  setParams(next)
                  setSidebar(false)
                }}
              >
                <ListItemText
                  primary={c.title || '新对话'}
                  secondary={new Date(c.updated_at).toLocaleString()}
                  primaryTypographyProps={{ fontSize: 14, noWrap: true }}
                  secondaryTypographyProps={{ fontSize: 11 }}
                />
                <IconButton
                  size="small"
                  onClick={e => {
                    e.stopPropagation()
                    removeConvo(c.id)
                  }}
                >
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </ListItemButton>
            ))}
            {convos.length === 0 && (
              <Typography variant="caption" color="text.secondary" sx={{ px: 2 }}>
                暂无对话
              </Typography>
            )}
          </List>
        </Box>
      </Drawer>
    </Box>
  )
}
