import { useEffect, useState } from 'react'
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

const suggestions = [
  { icon: '✍️', title: '从零写一篇', text: '帮我写一篇「早C晚A护肤」的小红书笔记' },
  { icon: '🔄', title: '改写现有稿', text: '帮我把笔记 #1 改写得更有网感、加强钩子' },
  { icon: '🎨', title: '生成封面', text: '为笔记 #1 生成一张干净、高级感的竖版封面' },
  { icon: '🧪', title: '发布前诊断', text: '帮我诊断笔记 #1 能不能发，有没有违禁词' },
]

export default function ChatPage() {
  const [params, setParams] = useSearchParams()
  const articleId = params.get('article')
  const [article, setArticle] = useState<Article | null>(null)
  const [sidebar, setSidebar] = useState(false)
  const [convos, setConvos] = useState<Conversation[]>([])

  // session key - remounts ChatPanel when switched (so message history resets)
  const [sessionKey, setSessionKey] = useState(0)

  useEffect(() => {
    if (articleId) {
      getArticle(Number(articleId))
        .then(setArticle)
        .catch(() => setArticle(null))
    } else {
      setArticle(null)
    }
    setSessionKey(k => k + 1)
  }, [articleId])

  const refreshConvos = () => {
    listConversations().then(setConvos).catch(() => setConvos([]))
  }
  useEffect(() => {
    refreshConvos()
  }, [])

  const newChat = () => {
    if (articleId) setParams({})
    setSessionKey(k => k + 1)
  }

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
          <IconButton onClick={() => setSidebar(true)} size="small">
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
        <Box sx={{ width: '100%', maxWidth: 820, display: 'flex', flexDirection: 'column' }}>
          {!article && (
            <Box
              sx={{
                px: { xs: 2, md: 3 },
                pt: 3,
                pb: 0.5,
                color: '#8A8A8F',
              }}
            >
              <Typography
                sx={{ fontSize: 28, fontWeight: 600, letterSpacing: -0.5, color: '#1F1F1F' }}
              >
                今天想写什么笔记？
              </Typography>
              <Typography sx={{ fontSize: 14, color: '#8A8A8F', mt: 1 }}>
                说出你的灵感，我会帮你创作、改写、打分、诊断和配图。
              </Typography>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
                  gap: 1,
                  mt: 2,
                }}
              >
                {suggestions.map(s => (
                  <Box
                    key={s.title}
                    sx={{
                      textAlign: 'left',
                      p: 1.4,
                      border: '1px solid #EEE9E1',
                      borderRadius: 2.5,
                      transition: 'all .15s',
                      opacity: 0.9,
                    }}
                  >
                    <Typography sx={{ fontSize: 18, lineHeight: 1 }}>{s.icon}</Typography>
                    <Typography
                      sx={{ fontSize: 13.5, fontWeight: 600, mt: 0.5, color: '#1F1F1F' }}
                    >
                      {s.title}
                    </Typography>
                    <Typography sx={{ fontSize: 12.5, color: '#8A8A8F', mt: 0.2 }}>
                      {s.text}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </Box>
          )}

          <Box sx={{ flex: 1, minHeight: 0 }}>
            <ChatPanel
              key={`chat-${sessionKey}-${articleId || 'new'}`}
              article={article}
              showHeader={false}
              placeholder={article ? '继续对这篇笔记说…' : '发消息给小红书助手…'}
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
                  if (c.article_id) {
                    setParams({ article: String(c.article_id) })
                  } else {
                    setParams({})
                  }
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
