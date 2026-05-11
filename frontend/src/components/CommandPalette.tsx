import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Box,
  Dialog,
  InputAdornment,
  List,
  ListItemButton,
  ListItemText,
  TextField,
  Typography,
} from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined'
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline'
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined'
import { listArticles, type Article } from '../api/client'

type QuickAction = { label: string; icon: React.ReactNode; path: string }

const staticActions: QuickAction[] = [
  { label: '新建对话', icon: <ChatBubbleOutlineIcon sx={{ fontSize: 18 }} />, path: '/' },
  { label: '笔记列表', icon: <DescriptionOutlinedIcon sx={{ fontSize: 18 }} />, path: '/articles' },
  { label: '模板库', icon: <DescriptionOutlinedIcon sx={{ fontSize: 18 }} />, path: '/templates' },
  { label: '设置', icon: <SettingsOutlinedIcon sx={{ fontSize: 18 }} />, path: '/settings' },
]

export default function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [articles, setArticles] = useState<Article[]>([])
  const [selectedIdx, setSelectedIdx] = useState(0)
  const nav = useNavigate()

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen(o => !o)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    if (open) {
      listArticles().then(setArticles).catch(() => {})
      setQuery('')
      setSelectedIdx(0)
    }
  }, [open])

  const results = useMemo(() => {
    const q = query.toLowerCase()
    const actions: Array<{ label: string; secondary?: string; icon: React.ReactNode; path: string }> = []

    for (const a of staticActions) {
      if (!q || a.label.toLowerCase().includes(q)) {
        actions.push(a)
      }
    }

    for (const art of articles) {
      if (
        !q ||
        art.title.toLowerCase().includes(q) ||
        (art.tags || []).some(t => t.toLowerCase().includes(q))
      ) {
        actions.push({
          label: art.title || '无标题',
          secondary: `#${art.id} · ${art.status}`,
          icon: <DescriptionOutlinedIcon sx={{ fontSize: 18 }} />,
          path: `/articles/${art.id}`,
        })
      }
    }

    return actions.slice(0, 12)
  }, [query, articles])

  function go(path: string) {
    setOpen(false)
    nav(path)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIdx(i => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && results[selectedIdx]) {
      e.preventDefault()
      go(results[selectedIdx].path)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => setOpen(false)}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 3,
          overflow: 'hidden',
          mt: '15vh',
          alignSelf: 'flex-start',
        },
      }}
    >
      <Box sx={{ p: 0 }}>
        <TextField
          autoFocus
          fullWidth
          placeholder="搜索笔记、跳转页面…"
          value={query}
          onChange={e => { setQuery(e.target.value); setSelectedIdx(0) }}
          onKeyDown={handleKeyDown}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ fontSize: 20, color: 'text.secondary' }} />
              </InputAdornment>
            ),
            sx: { fontSize: 15, py: 1.5, px: 2 },
          }}
          variant="standard"
          sx={{ '& .MuiInput-underline:before': { borderBottom: '1px solid', borderColor: 'divider' } }}
        />
        {results.length > 0 ? (
          <List dense sx={{ maxHeight: 360, overflow: 'auto', py: 0.5 }}>
            {results.map((r, i) => (
              <ListItemButton
                key={i}
                selected={i === selectedIdx}
                onClick={() => go(r.path)}
                sx={{ px: 2, py: 0.8, gap: 1.5 }}
              >
                <Box sx={{ color: 'text.secondary', display: 'flex' }}>{r.icon}</Box>
                <ListItemText
                  primary={r.label}
                  secondary={r.secondary}
                  primaryTypographyProps={{ fontSize: 14, fontWeight: 500 }}
                  secondaryTypographyProps={{ fontSize: 12 }}
                />
                {i === selectedIdx && (
                  <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>↵</Typography>
                )}
              </ListItemButton>
            ))}
          </List>
        ) : query ? (
          <Box sx={{ py: 4, textAlign: 'center' }}>
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>无匹配结果</Typography>
          </Box>
        ) : null}
        <Box sx={{ px: 2, py: 1, borderTop: '1px solid', borderColor: 'divider', display: 'flex', gap: 2 }}>
          <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>
            ↑↓ 导航 · ↵ 打开 · Esc 关闭
          </Typography>
        </Box>
      </Box>
    </Dialog>
  )
}
