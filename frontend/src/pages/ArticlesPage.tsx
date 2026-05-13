import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  Stack,
  Tooltip,
  Typography,
  TextField,
  InputAdornment,
  ToggleButton,
  ToggleButtonGroup,
  MenuItem,
  Select,
  FormControl,
} from '@mui/material'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import SearchIcon from '@mui/icons-material/Search'
import AddIcon from '@mui/icons-material/Add'
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline'
import EditNoteIcon from '@mui/icons-material/EditNote'
import SortIcon from '@mui/icons-material/Sort'
import { deleteArticle, listArticles, type Article } from '../api/client'
import { toast } from 'sonner'
import ConfirmDialog from '../components/ConfirmDialog'
import { formatBeijingDate } from '../utils/time'

type SortKey = 'updated' | 'score' | 'title'

const statusColors: Record<string, { bg: string; color: string }> = {
  draft: { bg: 'rgba(107,114,128,0.08)', color: '#6B7280' },
  published: { bg: 'rgba(22,163,74,0.08)', color: '#16A34A' },
  scheduled: { bg: 'rgba(217,119,6,0.08)', color: '#D97706' },
}

function articleScore(a: Article) {
  const direct = Number(a.score?.overall)
  if (Number.isFinite(direct)) return Math.round(direct)
  const total = Number(a.score?.total_score ?? a.score?.overall_score ?? a.score?.model_a_score?.total_score)
  return Number.isFinite(total) ? Math.round(total) : 0
}

export default function ArticlesPage() {
  const [items, setItems] = useState<Article[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [sortBy, setSortBy] = useState<SortKey>('updated')
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null)
  const nav = useNavigate()
  const refresh = () => listArticles().then(setItems).catch(() => setItems([])).finally(() => setLoading(false))
  useEffect(() => {
    refresh()
  }, [])

  const statuses = useMemo(() => {
    const set = new Set(items.map(a => a.status))
    return Array.from(set).sort()
  }, [items])

  const filtered = useMemo(() => {
    let list = items.filter(
      a =>
        !query ||
        a.title.toLowerCase().includes(query.toLowerCase()) ||
        a.body.toLowerCase().includes(query.toLowerCase()) ||
        (a.tags || []).some(t => t.toLowerCase().includes(query.toLowerCase()))
    )
    if (statusFilter !== 'all') {
      list = list.filter(a => a.status === statusFilter)
    }
    list = [...list].sort((a, b) => {
      if (sortBy === 'score') return articleScore(b) - articleScore(a)
      if (sortBy === 'title') return a.title.localeCompare(b.title)
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    })
    return list
  }, [items, query, statusFilter, sortBy])

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 1100, mx: 'auto' }}>
      {/* Header */}
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 3.5 }}>
        <Stack spacing={0.2}>
          <Typography sx={{ fontSize: 24, fontWeight: 800, letterSpacing: -0.5 }}>
            我的笔记
          </Typography>
          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
            {items.length} 篇笔记
          </Typography>
        </Stack>
        <Box sx={{ flex: 1 }} />
        <ToggleButtonGroup
          size="small"
          exclusive
          value={statusFilter}
          onChange={(_, v) => v && setStatusFilter(v)}
          sx={{
            '& .MuiToggleButton-root': {
              fontSize: 12,
              px: 1.4,
              py: 0.5,
              textTransform: 'none',
              borderRadius: '8px !important',
              border: '1px solid',
              borderColor: 'divider',
              '&.Mui-selected': {
                bgcolor: 'rgba(255,36,66,0.06)',
                color: '#FF2442',
                borderColor: 'rgba(255,36,66,0.2)',
              },
            },
          }}
        >
          <ToggleButton value="all">全部</ToggleButton>
          {statuses.map(s => (
            <ToggleButton key={s} value={s}>{s === 'draft' ? '草稿' : s === 'published' ? '已发布' : s}</ToggleButton>
          ))}
        </ToggleButtonGroup>
        <FormControl size="small" sx={{ minWidth: 100 }}>
          <Select
            value={sortBy}
            onChange={e => setSortBy(e.target.value as SortKey)}
            startAdornment={<SortIcon sx={{ fontSize: 14, mr: 0.5, color: 'text.secondary' }} />}
            sx={{ fontSize: 12, height: 32, borderRadius: 2 }}
          >
            <MenuItem value="updated">最近更新</MenuItem>
            <MenuItem value="score">评分最高</MenuItem>
            <MenuItem value="title">标题排序</MenuItem>
          </Select>
        </FormControl>
        <TextField
          size="small"
          placeholder="搜索…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
              </InputAdornment>
            ),
          }}
          sx={{ width: 180 }}
        />
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => nav('/')}
          sx={{
            background: 'linear-gradient(135deg,#FF2442,#FF7A00)',
            '&:hover': { background: 'linear-gradient(135deg,#E01E3A,#E06A00)' },
          }}
        >
          去创作
        </Button>
      </Stack>

      {loading && (
        <Box sx={{ display: 'grid', placeItems: 'center', py: 10 }}>
          <CircularProgress size={28} />
        </Box>
      )}

      {!loading && filtered.length === 0 && (
        <Box sx={{ textAlign: 'center', py: 10 }}>
          <Typography sx={{ fontSize: 48, mb: 1.5 }}>
            {items.length === 0 ? '📝' : '🔍'}
          </Typography>
          <Typography sx={{ fontSize: 14, color: 'text.secondary' }}>
            {items.length === 0
              ? '还没有笔记，去创作页让助手帮你写一篇'
              : '没有匹配的笔记'}
          </Typography>
        </Box>
      )}

      <Stack spacing={1.5}>
        {filtered.map(a => (
          <Box
            key={a.id}
            onClick={() => nav(`/articles/${a.id}`)}
            sx={{
              display: 'flex',
              gap: 2,
              p: 2,
              bgcolor: 'background.paper',
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 3,
              cursor: 'pointer',
              transition: 'all .2s cubic-bezier(0.4,0,0.2,1)',
              '&:hover': {
                borderColor: 'rgba(255,36,66,0.15)',
                boxShadow: '0 4px 16px rgba(255,36,66,0.06), 0 2px 6px rgba(0,0,0,0.03)',
                transform: 'translateY(-1px)',
                '& .row-actions': { opacity: 1 },
              },
            }}
          >
            {/* Thumbnail */}
            <Box
              sx={{
                width: 80,
                height: 80,
                borderRadius: 2.5,
                bgcolor: 'rgba(0,0,0,0.03)',
                backgroundImage: a.cover_image ? `url(${a.cover_image})` : undefined,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                display: 'grid',
                placeItems: 'center',
                color: 'text.secondary',
                fontSize: 20,
                fontWeight: 700,
                flexShrink: 0,
                overflow: 'hidden',
              }}
            >
              {!a.cover_image && (a.title.slice(0, 1) || '红')}
            </Box>

            {/* Content */}
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Stack direction="row" alignItems="center" spacing={0.8} sx={{ mb: 0.5 }}>
                <Typography sx={{ fontSize: 15, fontWeight: 600 }} noWrap>
                  {a.title || '无标题'}
                </Typography>
                <Chip
                  size="small"
                  label={a.status === 'draft' ? '草稿' : a.status === 'published' ? '已发布' : a.status}
                  sx={{
                    ...(statusColors[a.status] || { bg: 'rgba(0,0,0,0.04)', color: 'text.secondary' }),
                    bgcolor: statusColors[a.status]?.bg || 'rgba(0,0,0,0.04)',
                    color: statusColors[a.status]?.color || undefined,
                    fontSize: 11,
                    height: 20,
                    fontWeight: 500,
                  }}
                />
                {articleScore(a) > 0 && (
                  <Chip
                    size="small"
                    label={`${articleScore(a)}分`}
                    sx={{ bgcolor: 'rgba(22,163,74,0.08)', color: '#16A34A', fontSize: 11, height: 20, fontWeight: 600 }}
                  />
                )}
              </Stack>
              <Typography
                sx={{
                  fontSize: 13,
                  color: 'text.secondary',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                  lineHeight: 1.6,
                }}
              >
                {a.body}
              </Typography>
              <Stack direction="row" spacing={0.5} sx={{ mt: 0.8, flexWrap: 'wrap', gap: 0.4 }}>
                {(a.tags || []).slice(0, 5).map(t => (
                  <Chip
                    key={t}
                    label={t}
                    size="small"
                    sx={{
                      fontSize: 10.5,
                      height: 18,
                      bgcolor: 'rgba(0,0,0,0.03)',
                      border: '1px solid',
                      borderColor: 'divider',
                    }}
                  />
                ))}
              </Stack>
            </Box>

            {/* Actions */}
            <Stack sx={{ alignItems: 'flex-end', justifyContent: 'space-between', py: 0.3 }}>
              <Typography sx={{ fontSize: 11, color: 'text.secondary', whiteSpace: 'nowrap' }}>
                {formatBeijingDate(a.updated_at)}
              </Typography>
              <Stack
                direction="row"
                spacing={0.3}
                className="row-actions"
                sx={{ opacity: { xs: 1, md: 0 }, transition: 'opacity .2s' }}
              >
                <Tooltip title="对话优化">
                  <IconButton
                    size="small"
                    onClick={e => {
                      e.stopPropagation()
                      nav(`/?article=${a.id}`)
                    }}
                  >
                    <ChatBubbleOutlineIcon sx={{ fontSize: 15 }} />
                  </IconButton>
                </Tooltip>
                <Tooltip title="编辑">
                  <IconButton
                    size="small"
                    onClick={e => {
                      e.stopPropagation()
                      nav(`/articles/${a.id}`)
                    }}
                  >
                    <EditNoteIcon sx={{ fontSize: 15 }} />
                  </IconButton>
                </Tooltip>
                <Tooltip title="删除">
                  <IconButton
                    size="small"
                    onClick={e => {
                      e.stopPropagation()
                      setDeleteTarget(a.id)
                    }}
                  >
                    <DeleteOutlineIcon sx={{ fontSize: 15 }} />
                  </IconButton>
                </Tooltip>
              </Stack>
            </Stack>
          </Box>
        ))}
      </Stack>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="确认删除"
        message="删除后无法恢复，确定要删除这篇笔记吗？"
        confirmLabel="删除"
        danger
        onConfirm={() => {
          if (deleteTarget !== null) {
            deleteArticle(deleteTarget).then(() => {
              toast.success('已删除')
              refresh()
            })
          }
          setDeleteTarget(null)
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </Box>
  )
}
