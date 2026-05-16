import { useEffect, useState } from 'react'
import { Box, Button, Chip, CircularProgress, Collapse, Paper, Stack, Typography } from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import { cancelTask, getTask, listTasks, type TaskInfo } from '../api/client'
import { formatBeijingDateTime } from '../utils/time'

function fmt(ms?: number) {
  if (!ms && ms !== 0) return '—'
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  return `${Math.floor(s / 60)}m${Math.round(s % 60)}s`
}

function statusTone(status: string) {
  if (status === 'completed') return { color: 'success.main', label: 'completed' }
  if (status === 'failed') return { color: 'error.main', label: 'failed' }
  if (status === 'cancelled' || status === 'stale') return { color: 'warning.main', label: status }
  if (status === 'running') return { color: 'primary.main', label: 'running' }
  return { color: 'text.secondary', label: status }
}

function taskName(task: TaskInfo) {
  const type = task.trace?.task_type
  if (type === 'diagnosis') return '诊断任务'
  if (type === 'chat') return '对话任务'
  if (type === 'image') return '生图任务'
  return type || 'Agent 任务'
}

function TaskCard({ task, onRefresh }: { task: TaskInfo; onRefresh: () => void }) {
  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState<TaskInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const current = detail || task
  const trace = current.trace || {}
  const tools = Array.isArray(trace.tools) ? trace.tools : []
  const timings = trace.timings_ms || {}
  const counts = trace.event_counts || {}
  const tone = statusTone(current.status)
  const events = current.events || []

  const loadDetail = async () => {
    setOpen(v => !v)
    if (!detail) {
      setBusy(true)
      try { setDetail(await getTask(task.id)) } finally { setBusy(false) }
    }
  }

  const stop = async () => {
    await cancelTask(task.id).catch(() => {})
    onRefresh()
  }

  return (
    <Paper className={current.status === 'running' ? 'editorial-live' : undefined} sx={{ p: 2 }}>
      <Stack direction={{ xs: 'column', md: 'row' }} alignItems={{ xs: 'flex-start', md: 'center' }} spacing={1.2}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.8, flexWrap: 'wrap', gap: 0.7 }}>
            <Chip
              size="small"
              label={tone.label}
              sx={{ color: tone.color, borderColor: tone.color, bgcolor: 'background.paper' }}
            />
            <Typography sx={{ fontSize: 13.5, fontWeight: 700 }}>{taskName(current)}</Typography>
            <Typography className="editorial-mono" sx={{ fontSize: 10, color: 'text.disabled' }}>
              {current.id.slice(0, 12)}
            </Typography>
            {trace.article_id && <Chip size="small" label={`article #${trace.article_id}`} />}
            {current.conversation_id && <Chip size="small" label={`conversation #${current.conversation_id}`} />}
            <Box sx={{ flex: 1 }} />
            <Typography className="editorial-mono" sx={{ fontSize: 10, color: 'text.disabled' }}>
              {formatBeijingDateTime(current.updated_at || current.created_at || '')}
            </Typography>
          </Stack>
          {current.result_preview && (
            <Typography sx={{ fontSize: 12.5, color: 'text.secondary', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
              {current.result_preview}
            </Typography>
          )}
        </Box>
        <Stack direction="row" spacing={1}>
          {current.status === 'running' && <Button size="small" color="warning" variant="outlined" onClick={stop}>停止</Button>}
          <Button size="small" variant="outlined" onClick={loadDetail}>{open ? '收起' : '查看 Trace'}</Button>
        </Stack>
      </Stack>

      <Collapse in={open}>
        <Box sx={{ mt: 2, borderTop: '1px solid', borderColor: 'divider', pt: 2 }}>
          {busy && <CircularProgress size={18} />}
          {!busy && (
            <Stack spacing={2}>
              <Box className="editorial-stat-grid">
                <div className="editorial-stat"><b>{fmt(timings.first_event)}</b><span>first event</span></div>
                <div className="editorial-stat"><b>{fmt(timings.first_token)}</b><span>first token</span></div>
                <div className="editorial-stat"><b>{trace.token_chars ?? 0}</b><span>output chars</span></div>
                <div className="editorial-stat"><b>{tools.length}</b><span>tool calls</span></div>
              </Box>

              <Box>
                <div className="editorial-section-label"><span className="num">A</span><span className="title">事件统计</span></div>
                <Stack direction="row" spacing={0.6} flexWrap="wrap" sx={{ gap: 0.6 }}>
                  {Object.entries(counts).map(([k, v]) => <Chip key={k} size="small" label={`${k}: ${v}`} />)}
                  {!Object.keys(counts).length && <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>暂无事件</Typography>}
                </Stack>
              </Box>

              <Box>
                <div className="editorial-section-label"><span className="num">B</span><span className="title">工具调用 Ledger</span></div>
                <div className="editorial-ledger">
                  {tools.map((t: any, i: number) => (
                    <div className="editorial-ledger-row" key={t.id || i}>
                      <span>{String(i + 1).padStart(2, '0')}</span>
                      <span>{t.name || 'tool'}</span>
                      <span style={{ color: t.ok === false ? 'var(--hazard)' : 'var(--ok)' }}>{t.ok === false ? 'failed' : 'done'}</span>
                      <span>{fmt(t.elapsed_ms)}</span>
                    </div>
                  ))}
                  {!tools.length && <div className="editorial-ledger-row"><span>--</span><span>未调用工具</span><span>hold</span><span>--</span></div>}
                </div>
              </Box>

              <Box>
                <div className="editorial-section-label"><span className="num">C</span><span className="title">事件流</span></div>
                <div className="editorial-ledger">
                  {events.slice(-6).map((ev: any, i) => (
                    <div className="editorial-ledger-row" key={i}>
                      <span>{String(i + 1).padStart(2, '0')}</span>
                      <span>{ev.message || ev.type || 'event'}</span>
                      <span>{ev.step || ev.type || 'event'}</span>
                      <span>{ev.done ? 'done' : 'live'}</span>
                    </div>
                  ))}
                  {!events.length && <div className="editorial-ledger-row"><span>--</span><span>暂无事件</span><span>hold</span><span>--</span></div>}
                </div>
              </Box>
            </Stack>
          )}
        </Box>
      </Collapse>
    </Paper>
  )
}

export default function TasksPage() {
  const [items, setItems] = useState<TaskInfo[]>([])
  const [loading, setLoading] = useState(true)
  const load = async () => {
    setLoading(true)
    try { setItems(await listTasks(100)) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  return (
    <Box className="editorial-page studio-page">
      <Stack direction="row" alignItems="center" sx={{ mb: 2.5, borderBottom: '1px solid', borderColor: 'divider', pb: 1.5 }}>
        <Typography className="editorial-mono" sx={{ fontSize: 10, fontWeight: 800, color: 'primary.main', transform: 'translateY(-7px)', mr: 1.5 }}>08</Typography>
        <Box sx={{ flex: 1 }}>
          <Typography sx={{ fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: 32, fontWeight: 800, letterSpacing: -0.8, lineHeight: 1 }}>任务中心</Typography>
          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>Agent 执行 Trace、工具耗时、失败原因和任务恢复状态</Typography>
        </Box>
        <Button startIcon={<RefreshIcon />} variant="outlined" onClick={load}>刷新</Button>
      </Stack>
      {loading ? <Box sx={{ display: 'grid', placeItems: 'center', py: 10 }}><CircularProgress size={24} /></Box> : (
        <Stack spacing={1.5}>
          {items.map(t => <TaskCard key={t.id} task={t} onRefresh={load} />)}
          {!items.length && (
            <Paper sx={{ p: 5, textAlign: 'center', color: 'text.secondary' }}>
              <Typography className="editorial-mono" sx={{ color: 'primary.main', mb: 1 }}>EMPTY TRACE</Typography>
              暂无任务
            </Paper>
          )}
        </Stack>
      )}
    </Box>
  )
}
