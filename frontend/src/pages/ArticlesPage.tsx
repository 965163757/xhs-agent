import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Box,
  Button,
  Chip,
  IconButton,
  Stack,
  Tooltip,
  Typography,
  TextField,
  InputAdornment,
} from '@mui/material'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import SearchIcon from '@mui/icons-material/Search'
import AddIcon from '@mui/icons-material/Add'
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline'
import EditNoteIcon from '@mui/icons-material/EditNote'
import { deleteArticle, listArticles, type Article } from '../api/client'

export default function ArticlesPage() {
  const [items, setItems] = useState<Article[]>([])
  const [query, setQuery] = useState('')
  const nav = useNavigate()
  const refresh = () => listArticles().then(setItems).catch(() => setItems([]))
  useEffect(() => {
    refresh()
  }, [])

  const filtered = items.filter(
    a =>
      !query ||
      a.title.toLowerCase().includes(query.toLowerCase()) ||
      a.body.toLowerCase().includes(query.toLowerCase()) ||
      (a.tags || []).some(t => t.toLowerCase().includes(query.toLowerCase()))
  )

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 1100, mx: 'auto' }}>
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 3 }}>
        <Typography sx={{ fontSize: 26, fontWeight: 600, letterSpacing: -0.3 }}>
          我的笔记
        </Typography>
        <Typography sx={{ fontSize: 13, color: '#B8B4AB' }}>{items.length} 篇</Typography>
        <Box sx={{ flex: 1 }} />
        <TextField
          size="small"
          placeholder="搜索标题/正文/标签"
          value={query}
          onChange={e => setQuery(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ fontSize: 18, color: '#B8B4AB' }} />
              </InputAdornment>
            ),
          }}
          sx={{ width: 240 }}
        />
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => nav('/')}
          sx={{ bgcolor: '#FF2741', '&:hover': { bgcolor: '#D61030' } }}
        >
          去创作
        </Button>
      </Stack>

      {filtered.length === 0 && (
        <Box
          sx={{
            textAlign: 'center',
            py: 8,
            color: '#B8B4AB',
          }}
        >
          <Typography sx={{ fontSize: 14 }}>
            {items.length === 0
              ? '还没有笔记，去「对话」里让助手帮你写一篇。'
              : '没有匹配的笔记'}
          </Typography>
        </Box>
      )}

      <Stack spacing={1.2}>
        {filtered.map(a => (
          <Box
            key={a.id}
            onClick={() => nav(`/articles/${a.id}`)}
            sx={{
              display: 'flex',
              gap: 2,
              p: 1.6,
              border: '1px solid #EEE9E1',
              borderRadius: 2.5,
              cursor: 'pointer',
              transition: 'all .15s',
              '&:hover': {
                borderColor: '#B8B4AB',
                bgcolor: '#FAF7F2',
                '& .row-actions': { opacity: 1 },
              },
            }}
          >
            <Box
              sx={{
                width: 84,
                height: 84,
                borderRadius: 2,
                bgcolor: '#F4EFE5',
                backgroundImage: a.cover_image ? `url(${a.cover_image})` : undefined,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                display: 'grid',
                placeItems: 'center',
                color: '#B8B4AB',
                fontSize: 22,
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              {!a.cover_image && (a.title.slice(0, 1) || '红')}
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Stack direction="row" alignItems="center" spacing={1}>
                <Typography sx={{ fontSize: 15.5, fontWeight: 600 }} noWrap>
                  {a.title || '无标题'}
                </Typography>
                <Chip
                  size="small"
                  label={a.status}
                  sx={{ bgcolor: '#F4EFE5', fontSize: 11, height: 20 }}
                />
                {typeof a.score?.overall === 'number' && (
                  <Chip
                    size="small"
                    label={`评分 ${a.score.overall}`}
                    sx={{ bgcolor: '#E6F7EC', color: '#0F8C3D', fontSize: 11, height: 20 }}
                  />
                )}
                {a.images && a.images.length > 0 && (
                  <Chip
                    size="small"
                    label={`${a.images.length} 图`}
                    sx={{ bgcolor: '#FFF2E0', color: '#B45309', fontSize: 11, height: 20 }}
                  />
                )}
              </Stack>
              <Typography
                sx={{
                  fontSize: 13,
                  color: '#8A8A8F',
                  mt: 0.5,
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {a.body}
              </Typography>
              <Stack direction="row" spacing={0.5} sx={{ mt: 0.8, flexWrap: 'wrap', gap: 0.5 }}>
                {(a.tags || []).slice(0, 6).map(t => (
                  <Chip
                    key={t}
                    label={t}
                    size="small"
                    sx={{
                      bgcolor: '#fff',
                      border: '1px solid #EEE9E1',
                      fontSize: 11,
                      height: 20,
                    }}
                  />
                ))}
              </Stack>
            </Box>
            <Stack sx={{ alignItems: 'flex-end', justifyContent: 'space-between' }}>
              <Typography sx={{ fontSize: 11, color: '#B8B4AB', whiteSpace: 'nowrap' }}>
                {new Date(a.updated_at).toLocaleDateString()}
              </Typography>
              <Stack
                direction="row"
                spacing={0.4}
                className="row-actions"
                sx={{ opacity: { xs: 1, md: 0 }, transition: 'opacity .15s' }}
              >
                <Tooltip title="在对话中继续优化">
                  <IconButton
                    size="small"
                    onClick={e => {
                      e.stopPropagation()
                      nav(`/?article=${a.id}`)
                    }}
                  >
                    <ChatBubbleOutlineIcon fontSize="small" />
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
                    <EditNoteIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title="删除">
                  <IconButton
                    size="small"
                    onClick={e => {
                      e.stopPropagation()
                      if (confirm('删除这篇笔记？')) deleteArticle(a.id).then(refresh)
                    }}
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>
            </Stack>
          </Box>
        ))}
      </Stack>
    </Box>
  )
}
