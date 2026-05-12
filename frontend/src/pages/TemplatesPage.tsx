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
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
  CircularProgress,
} from '@mui/material'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import AddIcon from '@mui/icons-material/Add'
import { applyTemplate, createTemplate, deleteTemplate, listTemplates, type Template } from '../api/client'
import { toast } from 'sonner'

export default function TemplatesPage() {
  const [items, setItems] = useState<Template[]>([])
  const [active, setActive] = useState<Template | null>(null)
  const [topic, setTopic] = useState('')
  const [busy, setBusy] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ name: '', category: '', description: '', body: '', tags: '' })
  const nav = useNavigate()

  const refresh = () => listTemplates().then(setItems).catch(() => setItems([]))
  useEffect(() => { refresh() }, [])

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

  const handleCreate = async () => {
    if (!form.name || !form.body) return
    setBusy(true)
    try {
      await createTemplate({
        name: form.name,
        category: form.category || '自定义',
        description: form.description,
        body: form.body,
        tags: form.tags.split(/[,，\s]+/).filter(Boolean).map(t => t.startsWith('#') ? t : `#${t}`),
      })
      toast.success('模板已创建')
      setShowCreate(false)
      setForm({ name: '', category: '', description: '', body: '', tags: '' })
      refresh()
    } catch (e: any) {
      toast.error(e?.message || '创建失败')
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm('删除这个模板？')) return
    try {
      await deleteTemplate(id)
      toast.success('已删除')
      refresh()
    } catch { /* ignore */ }
  }

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 1100, mx: 'auto' }}>
      <Stack direction="row" alignItems="center" sx={{ mb: 0.5 }}>
        <Typography sx={{ fontSize: 26, fontWeight: 600, letterSpacing: -0.3 }}>
          模板库
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Button
          startIcon={<AddIcon />}
          variant="outlined"
          size="small"
          onClick={() => setShowCreate(true)}
        >
          自定义模板
        </Button>
      </Stack>
      <Typography sx={{ fontSize: 13.5, color: 'text.secondary', mb: 3 }}>
        选一个结构模板，给一个主题，AI 会按模板骨架生成完整笔记。也可以自己创建模板。
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
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 2.5,
              p: 2,
              cursor: 'pointer',
              transition: 'all .15s',
              position: 'relative',
              '&:hover': { borderColor: 'text.secondary', bgcolor: 'background.default' },
              '&:hover .del-btn': { opacity: 1 },
            }}
          >
            <IconButton
              className="del-btn"
              size="small"
              onClick={(e) => handleDelete(t.id, e)}
              sx={{ position: 'absolute', top: 8, right: 8, opacity: 0, transition: 'opacity .15s' }}
            >
              <DeleteOutlineIcon sx={{ fontSize: 16 }} />
            </IconButton>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.8 }}>
              <Typography sx={{ fontSize: 16, fontWeight: 600 }}>{t.name}</Typography>
              <Chip
                size="small"
                label={t.category}
                sx={{ bgcolor: 'action.hover', fontSize: 11, height: 20 }}
              />
            </Stack>
            <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 1.2 }}>
              {t.description}
            </Typography>
            <Box
              sx={{
                p: 1.4,
                bgcolor: 'background.default',
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1.5,
                whiteSpace: 'pre-wrap',
                fontSize: 12,
                color: 'text.secondary',
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

      {/* Apply dialog */}
      <Dialog open={!!active} onClose={() => !busy && setActive(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontSize: 17, fontWeight: 600 }}>
          按模板生成：{active?.name}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
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

      {/* Create template dialog */}
      <Dialog open={showCreate} onClose={() => !busy && setShowCreate(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontSize: 17, fontWeight: 600 }}>
          创建自定义模板
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="模板名称"
              fullWidth
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
            />
            <TextField
              label="分类"
              fullWidth
              placeholder="如：种草、教程、测评"
              value={form.category}
              onChange={e => setForm({ ...form, category: e.target.value })}
            />
            <TextField
              label="描述"
              fullWidth
              placeholder="一句话说明适用场景"
              value={form.description}
              onChange={e => setForm({ ...form, description: e.target.value })}
            />
            <TextField
              label="模板骨架"
              fullWidth
              multiline
              minRows={6}
              placeholder={"[钩子]\n- 一句戳痛点的话\n\n[正文]\n- 第一段：...\n- 第二段：...\n\n[CTA]\n- 引导互动"}
              value={form.body}
              onChange={e => setForm({ ...form, body: e.target.value })}
            />
            <TextField
              label="标签（逗号分隔）"
              fullWidth
              placeholder="好物推荐, 种草, 测评"
              value={form.tags}
              onChange={e => setForm({ ...form, tags: e.target.value })}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowCreate(false)} disabled={busy}>
            取消
          </Button>
          <Button
            variant="contained"
            onClick={handleCreate}
            disabled={!form.name || !form.body || busy}
            startIcon={busy ? <CircularProgress size={14} /> : null}
            sx={{ bgcolor: '#FF2741', '&:hover': { bgcolor: '#D61030' } }}
          >
            {busy ? '创建中…' : '创建模板'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
