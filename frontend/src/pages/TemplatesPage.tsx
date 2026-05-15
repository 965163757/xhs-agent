import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
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
  const [loading, setLoading] = useState(true)
  const [active, setActive] = useState<Template | null>(null)
  const [topic, setTopic] = useState('')
  const [busy, setBusy] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{ id: number } | null>(null)
  const [form, setForm] = useState({ name: '', category: '', description: '', body: '', tags: '' })
  const nav = useNavigate()

  const refresh = () => listTemplates().then(setItems).catch(() => setItems([])).finally(() => setLoading(false))
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
    setDeleteTarget({ id })
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    try {
      await deleteTemplate(deleteTarget.id)
      toast.success('已删除')
      refresh()
    } catch { /* ignore */ }
    setDeleteTarget(null)
  }

  return (
    <Box className="editorial-page" sx={{ p: { xs: 2, md: 3 }, maxWidth: 1180, mx: 'auto' }}>
      <Stack direction="row" alignItems="flex-start" sx={{ mb: 3.5 }}>
        <Stack spacing={0.3}>
          <Typography sx={{ fontFamily: 'var(--serif)', fontSize: 30, fontWeight: 800, letterSpacing: -0.8 }}>
            模板库
          </Typography>
          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
            选一个结构模板，给一个主题，AI 按骨架生成完整笔记
          </Typography>
        </Stack>
        <Box sx={{ flex: 1 }} />
        <Button
          startIcon={<AddIcon />}
          variant="outlined"
          size="small"
          onClick={() => setShowCreate(true)}
          sx={{ mt: 0.5 }}
        >
          自定义模板
        </Button>
      </Stack>

      {loading && (
        <Box sx={{ display: 'grid', placeItems: 'center', py: 10 }}>
          <CircularProgress size={28} />
        </Box>
      )}

      {!loading && items.length === 0 && (
        <Box sx={{ textAlign: 'center', py: 10 }}>
          <Typography className="editorial-mono" sx={{ fontSize: 11, color: 'primary.main', mb: 1.5 }}>EMPTY LIBRARY</Typography>
          <Typography sx={{ fontSize: 14, color: 'text.secondary' }}>
            暂无模板，创建一个或在对话中让助手提取
          </Typography>
        </Box>
      )}

      {!loading && (
        <Box
          sx={{
            display: 'grid',
            gap: 2,
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
                bgcolor: 'background.paper',
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 0,
                p: 2.5,
                cursor: 'pointer',
                transition: 'all .18s cubic-bezier(0.16,1,0.3,1)',
                position: 'relative',
                '&:hover': {
                  borderColor: 'primary.main',
                  boxShadow: 'none',
                  transform: 'translateY(-1px)',
                },
                '&:hover .del-btn': { opacity: 1 },
              }}
            >
              <IconButton
                className="del-btn"
                size="small"
                onClick={(e) => handleDelete(t.id, e)}
                sx={{ position: 'absolute', top: 10, right: 10, opacity: 0, transition: 'opacity .15s' }}
              >
                <DeleteOutlineIcon sx={{ fontSize: 15 }} />
              </IconButton>
              <Stack direction="row" alignItems="center" spacing={0.8} sx={{ mb: 1 }}>
                <Typography sx={{ fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: 17, fontWeight: 650 }}>{t.name}</Typography>
                <Chip
                  size="small"
                  label={t.category}
                  sx={{ fontSize: 10.5, height: 18, bgcolor: 'var(--accent-soft)', color: 'primary.main' }}
                />
              </Stack>
              <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mb: 1.5, lineHeight: 1.5 }}>
                {t.description}
              </Typography>
              <Box
                sx={{
                  p: 1.5,
                  bgcolor: 'var(--paper-soft)',
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 0,
                  whiteSpace: 'pre-wrap',
                  fontSize: 11.5,
                  color: 'text.secondary',
                  maxHeight: 140,
                  overflow: 'hidden',
                  lineHeight: 1.6,
                  fontFamily: '"JetBrains Mono", ui-monospace, Menlo, monospace',
                  position: 'relative',
                  '&::after': {
                    content: '""',
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    height: 40,
                    background: 'linear-gradient(transparent, var(--paper-soft))',
                    pointerEvents: 'none',
                  },
                }}
              >
                {t.body}
              </Box>
              {(t.tags || []).length > 0 && (
                <Stack direction="row" spacing={0.4} sx={{ mt: 1.2, flexWrap: 'wrap', gap: 0.4 }}>
                  {(t.tags || []).slice(0, 4).map(x => (
                    <Chip
                      key={x}
                      label={x}
                      size="small"
                      sx={{
                        fontSize: 10.5,
                        minHeight: 20,
                        height: 'auto',
                        color: 'text.primary',
                        maxWidth: '100%',
                        '& .MuiChip-label': {
                          py: 0.2,
                          lineHeight: 1.25,
                          whiteSpace: 'normal',
                          overflowWrap: 'anywhere',
                        },
                      }}
                    />
                  ))}
                </Stack>
              )}
            </Box>
          ))}
        </Box>
      )}

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)}>
        <DialogTitle sx={{ fontWeight: 700 }}>确认删除</DialogTitle>
        <DialogContent>
          <DialogContentText>删除后无法恢复，确定要删除这个模板吗？</DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setDeleteTarget(null)}>取消</Button>
          <Button onClick={confirmDelete} color="error" variant="contained">删除</Button>
        </DialogActions>
      </Dialog>

      {/* Apply dialog */}
      <Dialog open={!!active} onClose={() => !busy && setActive(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700, fontSize: 16 }}>
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
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setActive(null)} disabled={busy}>
            取消
          </Button>
          <Button
            variant="contained"
            onClick={apply}
            disabled={!topic || busy}
            startIcon={busy ? <CircularProgress size={14} /> : null}
          >
            {busy ? '生成中…' : '生成并打开'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Create template dialog */}
      <Dialog open={showCreate} onClose={() => !busy && setShowCreate(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700, fontSize: 16 }}>
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
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setShowCreate(false)} disabled={busy}>
            取消
          </Button>
          <Button
            variant="contained"
            onClick={handleCreate}
            disabled={!form.name || !form.body || busy}
            startIcon={busy ? <CircularProgress size={14} /> : null}
          >
            {busy ? '创建中…' : '创建模板'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
