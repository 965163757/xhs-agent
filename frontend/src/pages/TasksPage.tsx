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

function statusColor(status: string): 'default' | 'success' | 'error' | 'warning' | 'info' {
  if (status === 'completed') return 'success'
  if (status === 'failed') return 'error'
  if (status === 'cancelled' || status === 'stale') return 'warning'
  if (status === 'running') return 'info'
  return 'default'
}

function TaskCard({ task, onRefresh }: { task: TaskInfo; onRefresh: () => void }) {
  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState<TaskInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const trace = (detail || task).trace || {}
  const tools = Array.isArray(trace.tools) ? trace.tools : []
  const timings = trace.timings_ms || {}
  const counts = trace.event_counts || {}

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
    <Paper sx={{ p: 2, borderRadius: 3 }}>
      <Stack direction={{ xs: 'column', md: 'row' }} alignItems={{ xs: 'flex-start', md: 'center' }} spacing={1.2}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5, flexWrap: 'wrap', gap: 0.6 }}>
            <Typography sx={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700 }}>{task.id}</Typography>
            <Chip size="small" color={statusColor(task.status)} label={task.status} />
            {trace.task_type && <Chip size="small" label={trace.task_type === 'diagnosis' ? '诊断任务' : trace.task_type} />}
            {trace.article_id && <Chip size="small" label={`笔记 #${trace.article_id}`} />}
            {task.conversation_id && <Chip size="small" label={`对话 #${task.conversation_id}`} />}
            {task.trace_id && <Chip size="small" label={`trace ${task.trace_id}`} sx={{ fontFamily: 'monospace' }} />}
          </Stack>
          <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
            更新时间：{formatBeijingDateTime(task.updated_at)} · 事件 {task.event_count ?? task.events?.length ?? 0} · 耗时 {fmt(timings.elapsed)}
          </Typography>
          {task.result_preview && <Typography sx={{ mt: 0.8, fontSize: 13, color: 'text.secondary', whiteSpace: 'pre-wrap' }}>{task.result_preview}</Typography>}
        </Box>
        <Stack direction="row" spacing={1}>
          {task.status === 'running' && <Button size="small" color="warning" variant="outlined" onClick={stop}>停止</Button>}
          <Button size="small" variant="outlined" onClick={loadDetail}>{open ? '收起' : '查看 Trace'}</Button>
        </Stack>
      </Stack>

      <Collapse in={open}>
        <Box sx={{ mt: 2, borderTop: '1px solid', borderColor: 'divider', pt: 2 }}>
          {busy && <CircularProgress size={18} />}
          {!busy && (
            <Stack spacing={2}>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 1 }}>
                <Paper variant="outlined" sx={{ p: 1.2 }}><Typography sx={{ fontSize: 11, color: 'text.secondary' }}>首事件</Typography><Typography sx={{ fontWeight: 700 }}>{fmt(timings.first_event)}</Typography></Paper>
                <Paper variant="outlined" sx={{ p: 1.2 }}><Typography sx={{ fontSize: 11, color: 'text.secondary' }}>首字</Typography><Typography sx={{ fontWeight: 700 }}>{fmt(timings.first_token)}</Typography></Paper>
                <Paper variant="outlined" sx={{ p: 1.2 }}><Typography sx={{ fontSize: 11, color: 'text.secondary' }}>输出字符</Typography><Typography sx={{ fontWeight: 700 }}>{trace.token_chars ?? 0}</Typography></Paper>
                <Paper variant="outlined" sx={{ p: 1.2 }}><Typography sx={{ fontSize: 11, color: 'text.secondary' }}>工具数</Typography><Typography sx={{ fontWeight: 700 }}>{tools.length}</Typography></Paper>
              </Box>

              <Box>
                <Typography sx={{ fontSize: 13, fontWeight: 700, mb: 1 }}>事件统计</Typography>
                <Stack direction="row" spacing={0.6} flexWrap="wrap" sx={{ gap: 0.6 }}>
                  {Object.entries(counts).map(([k, v]) => <Chip key={k} size="small" label={`${k}: ${v}`} />)}
                  {!Object.keys(counts).length && <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>暂无事件</Typography>}
                </Stack>
              </Box>

              <Box>
                <Typography sx={{ fontSize: 13, fontWeight: 700, mb: 1 }}>工具调用</Typography>
                <Stack spacing={1}>
                  {tools.map((t: any, i: number) => (
                    <Paper key={t.id || i} variant="outlined" sx={{ p: 1.2, bgcolor: t.ok === false ? 'rgba(220,38,38,0.04)' : 'background.paper' }}>
                      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                        <Typography sx={{ fontSize: 13, fontWeight: 700 }}>{t.name || 'tool'}</Typography>
                        <Chip size="small" color={t.ok === false ? 'error' : 'success'} label={t.ok === false ? '失败' : '完成'} />
                        <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{fmt(t.elapsed_ms)}</Typography>
                      </Stack>
                      {Array.isArray(t.progress) && t.progress.length > 0 && (
                        <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{t.progress.slice(-1)[0]?.message}</Typography>
                      )}
                    </Paper>
                  ))}
                  {!tools.length && <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>未调用工具</Typography>}
                </Stack>
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
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 1100, mx: 'auto' }}>
      <Stack direction="row" alignItems="center" sx={{ mb: 3 }}>
        <Box sx={{ flex: 1 }}>
          <Typography sx={{ fontSize: 24, fontWeight: 800, letterSpacing: -0.5 }}>任务中心</Typography>
          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>查看 Agent 执行 Trace、工具耗时、失败原因和任务恢复状态</Typography>
        </Box>
        <Button startIcon={<RefreshIcon />} variant="outlined" onClick={load}>刷新</Button>
      </Stack>
      {loading ? <Box sx={{ display: 'grid', placeItems: 'center', py: 10 }}><CircularProgress size={24} /></Box> : (
        <Stack spacing={1.5}>
          {items.map(t => <TaskCard key={t.id} task={t} onRefresh={load} />)}
          {!items.length && <Paper sx={{ p: 5, textAlign: 'center', color: 'text.secondary' }}>暂无任务</Paper>}
        </Stack>
      )}
    </Box>
  )
}
