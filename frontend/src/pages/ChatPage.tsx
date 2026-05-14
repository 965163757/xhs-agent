import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
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
  Checkbox,
  Chip,
  Menu,
  MenuItem,
  useMediaQuery,
} from '@mui/material'
import MenuIcon from '@mui/icons-material/Menu'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import KeyboardDoubleArrowLeftIcon from '@mui/icons-material/KeyboardDoubleArrowLeft'
import ChecklistIcon from '@mui/icons-material/Checklist'
import {
  listConversations,
  deleteConversation,
  deleteConversations,
  getArticle,
  listArticles,
  type Conversation,
  type Article,
} from '../api/client'
import ChatPanel from '../components/ChatPanel'
import ConfirmDialog from '../components/ConfirmDialog'
import { loadFromConversation, migrateSession, reconnectTask, resetSession, sessionKeyFor, getSession } from '../chatStore'
import { formatBeijingDateTime } from '../utils/time'

const suggestions = [
  { icon: '✍️', title: '一键完整成稿', prompt: '帮我完整做一篇关于「早C晚A护肤」的小红书笔记，目标受众是20-25岁学生党，包含标题候选、标签、封面方向和发布前自检' },
  { icon: '📋', title: '给我选题灵感', prompt: '我是美妆博主，帮我列5个最近适合发的选题方向，要有爆款潜力' },
  { icon: '🎨', title: '生成封面图', prompt: '帮我生成一张小红书风格的封面图，主题是「秋冬护肤」，要干净高级感' },
  { icon: '🧪', title: '诊断我的笔记', prompt: '帮我诊断笔记 #1，看看哪里可以优化' },
]

export default function ChatPage() {
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const articleId = params.get('article')
  const convId = params.get('c')
  const [article, setArticle] = useState<Article | null>(null)
  const isDesktop = useMediaQuery('(min-width:900px)')
  const [historyOpen, setHistoryOpen] = useState(() => localStorage.getItem('xhs_chat_history_open') !== 'false')
  const [mobileSidebar, setMobileSidebar] = useState(false)
  const [convos, setConvos] = useState<Conversation[]>([])
  const [articleOptions, setArticleOptions] = useState<Article[]>([])
  const [articleMenuAnchor, setArticleMenuAnchor] = useState<HTMLElement | null>(null)
  const [deleteConvoId, setDeleteConvoId] = useState<number | null>(null)
  const [selectedConvoIds, setSelectedConvoIds] = useState<number[]>([])
  const [batchDeleteIds, setBatchDeleteIds] = useState<number[] | null>(null)
  const [batchMode, setBatchMode] = useState(false)
  const justCreatedRef = useRef(false)
  const currentSessionKey = convId ? `conv:${convId}` : sessionKeyFor(articleId ? Number(articleId) : null)
  const selectedCount = selectedConvoIds.length
  const allSelected = convos.length > 0 && selectedCount === convos.length

  useEffect(() => {
    localStorage.setItem('xhs_chat_history_open', historyOpen ? 'true' : 'false')
  }, [historyOpen])

  useEffect(() => {
    if (articleId) {
      getArticle(Number(articleId))
        .then(setArticle)
        .catch(() => setArticle(null))
    } else {
      setArticle(null)
    }
  }, [articleId])

  useEffect(() => {
    if (convId) {
      if (justCreatedRef.current) {
        justCreatedRef.current = false
        return
      }
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
    listConversations().then(items => {
      setConvos(items)
      setSelectedConvoIds(prev => prev.filter(id => items.some(c => c.id === id)))
    }).catch(() => {
      setConvos([])
      setSelectedConvoIds([])
    })
  }
  useEffect(() => { refreshConvos() }, [])

  const newChat = () => {
    resetSession(currentSessionKey)
    setBatchMode(false)
    setSelectedConvoIds([])
    setParams({})
  }

  const openArticleMenu = (anchor: HTMLElement) => {
    setArticleMenuAnchor(anchor)
    listArticles().then(setArticleOptions).catch(() => setArticleOptions([]))
  }

  const selectArticleContext = (nextArticleId: number | null) => {
    const next: Record<string, string> = {}
    if (convId) next.c = convId
    if (nextArticleId) next.article = String(nextArticleId)
    setArticleMenuAnchor(null)
    setParams(next, { replace: true })
  }

  const handleConversationCreated = useCallback((id: number) => {
    justCreatedRef.current = true
    const newKey = `conv:${id}`
    migrateSession(currentSessionKey, newKey)
    const next: Record<string, string> = { c: String(id) }
    if (articleId) next.article = articleId
    setParams(next, { replace: true })
  }, [articleId, setParams, currentSessionKey])

  const removeConvo = async (id: number) => {
    setDeleteConvoId(id)
  }

  const confirmRemoveConvo = async () => {
    if (deleteConvoId === null) return
    await deleteConversation(deleteConvoId)
    if (convId === String(deleteConvoId)) newChat()
    refreshConvos()
    setDeleteConvoId(null)
    setSelectedConvoIds(prev => prev.filter(id => id !== deleteConvoId))
  }

  const toggleConvoSelection = (id: number) => {
    setSelectedConvoIds(prev => (
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    ))
  }

  const toggleSelectAll = () => {
    setSelectedConvoIds(allSelected ? [] : convos.map(c => c.id))
  }

  const confirmBatchRemoveConvos = async () => {
    const ids = batchDeleteIds || []
    if (!ids.length) return
    await deleteConversations(ids)
    if (convId && ids.includes(Number(convId))) newChat()
    setSelectedConvoIds([])
    setBatchDeleteIds(null)
    setBatchMode(false)
    refreshConvos()
  }

  const toggleHistory = () => {
    refreshConvos()
    if (isDesktop) setHistoryOpen(v => !v)
    else setMobileSidebar(true)
  }

  const closeHistory = () => {
    if (isDesktop) setHistoryOpen(false)
    else setMobileSidebar(false)
  }

  const HistorySidebar = ({ temporary = false }: { temporary?: boolean }) => (
    <Box sx={{ width: temporary ? 340 : 304, bgcolor: 'background.paper', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ px: 1.5, py: 1.4 }}>
        <Typography sx={{ fontSize: 15, fontWeight: 800 }}>
          历史对话
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Tooltip title="新对话">
          <IconButton
            size="small"
            onClick={() => {
              newChat()
              if (temporary) setMobileSidebar(false)
            }}
          >
            <AddIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title={temporary ? '收起' : '收起侧栏'}>
          <IconButton size="small" onClick={closeHistory}>
            <KeyboardDoubleArrowLeftIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
      </Stack>
      {convos.length > 0 && (
        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ px: 1.5, pb: 1.2 }}>
          {!batchMode ? (
            <Tooltip title="批量管理">
              <IconButton
                size="small"
                onClick={() => { setBatchMode(true); setSelectedConvoIds([]) }}
                sx={{
                  width: 30,
                  height: 30,
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 2,
                }}
              >
                <ChecklistIcon sx={{ fontSize: 17 }} />
              </IconButton>
            </Tooltip>
          ) : (
            <Button size="small" onClick={toggleSelectAll} sx={{ fontSize: 12 }}>
              {allSelected ? '取消全选' : '全选'}
            </Button>
          )}
          <Typography sx={{ flex: 1, fontSize: 12, color: 'text.secondary' }}>
            {batchMode ? (selectedCount > 0 ? `已选 ${selectedCount} 条` : '选择要删除的对话') : ''}
          </Typography>
          {batchMode && selectedCount > 0 && (
            <Button
              size="small"
              color="error"
              startIcon={<DeleteOutlineIcon sx={{ fontSize: 14 }} />}
              onClick={() => setBatchDeleteIds(selectedConvoIds)}
              sx={{ fontSize: 12 }}
            >
              删除
            </Button>
          )}
          {batchMode && (
            <Button size="small" onClick={() => { setBatchMode(false); setSelectedConvoIds([]) }} sx={{ fontSize: 12 }}>
              取消
            </Button>
          )}
        </Stack>
      )}
      <Divider />
      <List dense sx={{ px: 0.75, py: 1, overflow: 'auto', flex: 1 }}>
        {convos.map(c => (
          <ListItemButton
            key={c.id}
            selected={convId === String(c.id)}
            onClick={() => {
              if (batchMode) {
                toggleConvoSelection(c.id)
                return
              }
              const next: Record<string, string> = { c: String(c.id) }
              if (c.article_id) next.article = String(c.article_id)
              setParams(next)
              if (temporary) setMobileSidebar(false)
            }}
            sx={{ borderRadius: 2, mb: 0.35, py: 0.9 }}
          >
            {batchMode && (
              <Checkbox
                size="small"
                checked={selectedConvoIds.includes(c.id)}
                onClick={e => e.stopPropagation()}
                onChange={() => toggleConvoSelection(c.id)}
                sx={{ mr: 0.5, p: 0.5 }}
              />
            )}
            <ListItemText
              primary={c.title || '新对话'}
              secondary={formatBeijingDateTime(c.updated_at)}
              primaryTypographyProps={{ fontSize: 13.5, noWrap: true, fontWeight: convId === String(c.id) ? 700 : 500 }}
              secondaryTypographyProps={{ fontSize: 11 }}
            />
            {!batchMode && (
              <IconButton
                size="small"
                onClick={e => {
                  e.stopPropagation()
                  removeConvo(c.id)
                }}
              >
                <DeleteOutlineIcon sx={{ fontSize: 15 }} />
              </IconButton>
            )}
          </ListItemButton>
        ))}
        {convos.length === 0 && (
          <Typography sx={{ px: 2, py: 3, fontSize: 13, color: 'text.secondary', textAlign: 'center' }}>
            暂无对话
          </Typography>
        )}
      </List>
    </Box>
  )

  return (
    <Box sx={{ height: 'calc(100vh - 56px)', display: 'flex', overflow: 'hidden' }}>
      {isDesktop && (
        <Box
          sx={{
            width: historyOpen ? 304 : 0,
            flexShrink: 0,
            overflow: 'hidden',
            borderRight: historyOpen ? 1 : 0,
            borderColor: 'divider',
            transition: 'width .22s ease',
            bgcolor: 'background.paper',
          }}
        >
          <HistorySidebar />
        </Box>
      )}

      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      {/* Top bar with context info */}
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{
          px: 2.5,
          py: 1,
          borderBottom: 1,
          borderColor: 'divider',
          bgcolor: 'background.paper',
        }}
      >
        <Tooltip title="历史对话">
          <IconButton onClick={toggleHistory} size="small">
            <MenuIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
        {article ? (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.8,
              px: 1.2,
              py: 0.4,
              borderRadius: 2,
              bgcolor: 'rgba(255,36,66,0.05)',
              border: '1px solid rgba(255,36,66,0.1)',
            }}
          >
            <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: '#FF2442' }} />
            <Typography sx={{ fontSize: 12, color: 'text.primary', fontWeight: 500 }}>
              笔记 #{article.id} · {article.title?.slice(0, 18) || ''}
            </Typography>
          </Box>
        ) : (
          <Typography sx={{ fontSize: 12.5, color: 'text.secondary', fontWeight: 500 }}>
            新对话
          </Typography>
        )}
        <Button
          size="small"
          variant="outlined"
          onClick={e => openArticleMenu(e.currentTarget)}
          sx={{ fontSize: 12, borderColor: 'divider', color: 'text.secondary', maxWidth: 220 }}
        >
          {article ? '切换参考笔记' : '选择库中笔记'}
        </Button>
        {article && (
          <Chip
            size="small"
            label="清除上下文"
            onClick={() => selectArticleContext(null)}
            sx={{ height: 22, fontSize: 11 }}
          />
        )}
        <Box sx={{ flex: 1 }} />
        <Button
          size="small"
          startIcon={<AddIcon sx={{ fontSize: 16 }} />}
          onClick={newChat}
          sx={{ fontSize: 12, color: 'text.secondary', fontWeight: 500 }}
        >
          新对话
        </Button>
      </Stack>

      <Menu anchorEl={articleMenuAnchor} open={!!articleMenuAnchor} onClose={() => setArticleMenuAnchor(null)}>
        <MenuItem onClick={() => selectArticleContext(null)} selected={!articleId}>
          不绑定笔记，直接新创作
        </MenuItem>
        {articleOptions.map(item => (
          <MenuItem
            key={item.id}
            selected={String(item.id) === articleId}
            onClick={() => selectArticleContext(item.id)}
            sx={{ minWidth: 320 }}
          >
            <Stack sx={{ minWidth: 0 }}>
              <Typography noWrap sx={{ fontSize: 13, fontWeight: 600 }}>
                #{item.id} {item.title || '（无标题）'}
              </Typography>
              <Typography noWrap sx={{ fontSize: 11, color: 'text.secondary' }}>
                {item.status} · {(item.tags || []).slice(0, 3).map(t => `#${String(t).replace(/^[#＃]+/, '')}`).join(' ')}
              </Typography>
            </Stack>
          </MenuItem>
        ))}
        {articleOptions.length === 0 && <MenuItem disabled>暂无可选笔记</MenuItem>}
      </Menu>

      {/* Chat area */}
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', justifyContent: 'center' }}>
        <Box sx={{ width: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <ChatPanel
            article={article}
            sessionKey={currentSessionKey}
            showHeader={false}
            placeholder={article ? '继续对这篇笔记说…' : '发消息给小红书助手…'}
            heroActions={article ? undefined : suggestions}
            onConversationCreated={handleConversationCreated}
            onArticleCreated={(id) => nav(`/articles/${id}`)}
            quickActions={
              article
                ? [
                    { label: '加强钩子', prompt: '开头钩子不够戳人，帮我改得更痛一点' },
                    { label: '整体改写', prompt: '把整篇改写得更有网感、更口语化' },
                    { label: '参考仿写', prompt: `参考笔记 #${article.id} 的中文小红书写法，仿写一篇【新主题】的小红书笔记。参考它的结构、语气和节奏，但主题可以变化；如果需要同风格图片，我会明确说“同时仿图”。` },
                    { label: '打分', prompt: '先读一次当前正文，然后给它做五维打分' },
                    { label: '诊断', prompt: '做发布前诊断，重点查违禁词和 CTA' },
                    { label: '生成封面', prompt: '为这篇笔记生成一张干净、高级感的竖版封面' },
                  ]
                : [
                    { label: '参考仿写', prompt: '我想参考笔记 #【参考ID】 的中文小红书写法，仿写一篇【新主题】的小红书笔记。请先确认参考笔记、新主题、是否写成新草稿，以及是否需要同风格图片。' },
                    { label: '一键成稿', prompt: '帮我完成一篇【主题】的小红书笔记，目标受众是【人群】，包含标题候选、标签、封面方向和发布前自检。先不要真实生成图片，除非我明确说要出图。' },
                    { label: '生成图片', prompt: '帮我生成一张【主题】的小红书风格图片，比例【3:4】，分辨率【1536x2048】，不绑定笔记。' },
                  ]
            }
          />
        </Box>
      </Box>
      </Box>

      {/* Mobile history drawer */}
      <Drawer open={!isDesktop && mobileSidebar} onClose={() => setMobileSidebar(false)}>
        <HistorySidebar temporary />
      </Drawer>

      <ConfirmDialog
        open={deleteConvoId !== null}
        title="确认删除"
        message="删除后无法恢复，确定要删除这条对话吗？"
        confirmLabel="删除"
        danger
        onConfirm={confirmRemoveConvo}
        onCancel={() => setDeleteConvoId(null)}
      />

      <ConfirmDialog
        open={!!batchDeleteIds?.length}
        title="确认批量删除"
        message={`删除后无法恢复，确定要删除选中的 ${batchDeleteIds?.length || 0} 条对话吗？`}
        confirmLabel="批量删除"
        danger
        onConfirm={confirmBatchRemoveConvos}
        onCancel={() => setBatchDeleteIds(null)}
      />
    </Box>
  )
}
