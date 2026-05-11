import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
  CircularProgress,
} from '@mui/material'
import { applyTemplate, listTemplates, type Template } from '../api/client'

export default function TemplatesPage() {
  const [items, setItems] = useState<Template[]>([])
  const [active, setActive] = useState<Template | null>(null)
  const [topic, setTopic] = useState('')
  const [busy, setBusy] = useState(false)
  const nav = useNavigate()

  useEffect(() => {
    listTemplates().then(setItems).catch(() => setItems([]))
  }, [])

  const apply = async () => {
    if (!active || !topic) return
    setBusy(true)
    try {
      const art = await applyTemplate(active.id, topic)
      nav(`/articles/${art.id}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 1100, mx: 'auto' }}>
      <Typography sx={{ fontSize: 26, fontWeight: 600, letterSpacing: -0.3, mb: 0.5 }}>
        模板库
      </Typography>
      <Typography sx={{ fontSize: 13.5, color: '#8A8A8F', mb: 3 }}>
        选一个结构模板，给一个主题，AI 会按模板骨架生成完整笔记。
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gap: 1.5,
          gridTemplateColumns: {
            xs: '1fr',
            sm: 'repeat(2, 1fr)',
            md: 'repeat(3, 1fr)',
          },
        }}
      >
        {items.map(t => (
          <Box
            key={t.id}
            onClick={() => {
              setActive(t)
              setTopic('')
            }}
            sx={{
              border: '1px solid #EEE9E1',
              borderRadius: 2.5,
              p: 2,
              cursor: 'pointer',
              transition: 'all .15s',
              '&:hover': { borderColor: '#B8B4AB', bgcolor: '#FAF7F2' },
            }}
          >
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.8 }}>
              <Typography sx={{ fontSize: 16, fontWeight: 600 }}>{t.name}</Typography>
              <Chip
                size="small"
                label={t.category}
                sx={{ bgcolor: '#F4EFE5', fontSize: 11, height: 20 }}
              />
            </Stack>
            <Typography sx={{ fontSize: 13, color: '#8A8A8F', mb: 1.2 }}>
              {t.description}
            </Typography>
            <Box
              sx={{
                p: 1.4,
                bgcolor: '#FAF7F2',
                border: '1px solid #EEE9E1',
                borderRadius: 1.5,
                whiteSpace: 'pre-wrap',
                fontSize: 12,
                color: '#8A8A8F',
                maxHeight: 160,
                overflow: 'hidden',
                lineHeight: 1.65,
                fontFamily: 'ui-monospace, Menlo, monospace',
              }}
            >
              {t.body}
            </Box>
            <Stack direction="row" spacing={0.5} sx={{ mt: 1, flexWrap: 'wrap', gap: 0.5 }}>
              {(t.tags || []).map(x => (
                <Chip key={x} label={x} size="small" sx={{ fontSize: 11, height: 20 }} />
              ))}
            </Stack>
          </Box>
        ))}
      </Box>

      <Dialog open={!!active} onClose={() => !busy && setActive(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontSize: 17, fontWeight: 600 }}>
          按模板生成：{active?.name}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography sx={{ fontSize: 13, color: '#8A8A8F' }}>
              {active?.description}
            </Typography>
            <TextField
              label="主题 / 灵感"
              placeholder="比如：新手入门水光针避雷"
              fullWidth
              value={topic}
              onChange={e => setTopic(e.target.value)}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setActive(null)} disabled={busy}>
            取消
          </Button>
          <Button
            variant="contained"
            onClick={apply}
            disabled={!topic || busy}
            startIcon={busy ? <CircularProgress size={14} /> : null}
            sx={{ bgcolor: '#FF2741', '&:hover': { bgcolor: '#D61030' } }}
          >
            {busy ? '生成中…' : '生成并打开'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
