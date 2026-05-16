import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Collapse,
  Divider,
  Grid,
  IconButton,
  LinearProgress,
  Paper,
  Stack,
  Step,
  StepLabel,
  Stepper,
  Tooltip,
  Typography,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import { toast } from 'sonner'
import {
  applyDiagnosisReport,
  diagnoseStream,
  getActiveDiagnosisTask,
  getTask,
  listDiagnosisReports,
  streamTask,
  type DiagnosisReport,
  type DiagnoseEvent,
  type TaskInfo,
} from '../api/client'
import { formatBeijingDateTime } from '../utils/time'

const STEPS = [
  { key: 'detect', label: '品类检测' },
  { key: 'model_a', label: 'Model A 预评分' },
  { key: 'text_analysis', label: '文本分析' },
  { key: 'agents_start', label: '专家诊断' },
  { key: 'debate_start', label: '专家辩论' },
  { key: 'judge_start', label: '综合裁判' },
  { key: 'done', label: '完成' },
]

const GRADE_COLORS: Record<string, string> = {
  S: '#C8302E',
  A: '#A87029',
  B: '#D3A257',
  C: '#8C8578',
  D: '#8B2520',
}

function RadarChart({ data }: { data: Record<string, number> }) {
  const labels: Record<string, string> = {
    content: '内容',
    visual: '视觉',
    growth: '增长',
    user_reaction: '用户',
    overall: '综合',
  }
  const keys = Object.keys(labels)
  const values = keys.map(k => (data[k] ?? 0) / 100)
  const n = keys.length
  const cx = 120, cy = 120, r = 90

  const points = (radius: number) =>
    keys.map((_, i) => {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2
      return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]
    })

  const dataPoints = values.map((v, i) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2
    return [cx + r * v * Math.cos(angle), cy + r * v * Math.sin(angle)]
  })

  const polygon = (pts: number[][]) => pts.map(p => p.join(',')).join(' ')

  return (
    <svg width={240} height={240} viewBox="0 0 240 240">
      {[0.2, 0.4, 0.6, 0.8, 1.0].map(scale => (
        <polygon
          key={scale}
          points={polygon(points(r * scale))}
          fill="none"
          stroke="var(--rule)"
          strokeWidth={0.5}
        />
      ))}
      {points(r).map((p, i) => (
        <line key={i} x1={cx} y1={cy} x2={p[0]} y2={p[1]} stroke="var(--rule)" strokeWidth={0.5} />
      ))}
      <polygon
        points={polygon(dataPoints)}
        fill="rgba(200,48,46,0.12)"
        stroke="var(--accent)"
        strokeWidth={2}
      />
      {dataPoints.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r={4} fill="var(--accent)" />
      ))}
      {points(r + 16).map((p, i) => (
        <text
          key={i}
          x={p[0]}
          y={p[1]}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={11}
          fill="var(--ink-soft)"
          fontWeight={600}
        >
          {labels[keys[i]]}
        </text>
      ))}
    </svg>
  )
}

function CommentCard({ comment }: { comment: any }) {
  const sentimentColor = comment.sentiment === 'positive' ? 'var(--ok)' : comment.sentiment === 'negative' ? 'var(--hazard)' : 'var(--ink-mute)'
  return (
    <Paper variant="outlined" sx={{ p: 1.5, mb: 1 }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
        <Box sx={{ width: 24, height: 24, border: '1px solid', borderColor: 'text.primary', display: 'grid', placeItems: 'center', fontFamily: 'var(--mono)', fontSize: 10, color: 'primary.main' }}>
          {String(comment.username || 'U').slice(0, 1).toUpperCase()}
        </Box>
        <Typography fontSize={13} fontWeight={600} color="text.primary">{comment.username}</Typography>
        <Chip label={comment.persona || comment.sentiment} size="small" sx={{ fontSize: 10, height: 18, bgcolor: sentimentColor + '15', color: sentimentColor }} />
        <Box flex={1} />
        <Typography fontSize={11} color="text.secondary">❤️ {comment.likes}</Typography>
      </Stack>
      <Typography fontSize={13} color="text.primary" sx={{ pl: 3.5 }}>{comment.comment}</Typography>
    </Paper>
  )
}

function fmtTime(value?: string | null) {
  if (!value) return '-'
  return formatBeijingDateTime(value)
}

export default function DiagnosePage() {
  const { id } = useParams<{ id: string }>()
  const nav = useNavigate()
  const [loading, setLoading] = useState(true)
  const [activeStep, setActiveStep] = useState(0)
  const [progressMsg, setProgressMsg] = useState('准备中...')
  const [report, setReport] = useState<DiagnosisReport | null>(null)
  const [history, setHistory] = useState<DiagnosisReport[]>([])
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [error, setError] = useState('')
  const [applying, setApplying] = useState(false)
  const [expandDebate, setExpandDebate] = useState(false)
  const [expandAgents, setExpandAgents] = useState(false)
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const runSeqRef = useRef(0)

  const loadHistory = useCallback(async () => {
    if (!id) return [] as DiagnosisReport[]
    const items = await listDiagnosisReports(Number(id))
    setHistory(items)
    setHistoryLoaded(true)
    return items
  }, [id])

  const applyDiagnosisEvent = useCallback((ev: DiagnoseEvent | any): boolean => {
    if (ev.type === 'task_id') {
      setActiveTaskId(ev.task_id)
      setProgressMsg('诊断已在后台启动，刷新或关闭页面不会中断')
      return false
    }
    if (ev.type === 'progress') {
      setProgressMsg(ev.message)
      const idx = STEPS.findIndex(s => s.key === ev.step)
      if (idx >= 0) setActiveStep(idx)
      return false
    }
    if (ev.type === 'result') {
      setReport(ev.data)
      setHistory(prev => [ev.data, ...prev.filter(x => (x.id || x.diagnosis_id) !== (ev.data.id || ev.data.diagnosis_id))])
      setActiveStep(STEPS.length - 1)
      setProgressMsg('诊断完成，结果已保存')
      setLoading(false)
      setActiveTaskId(null)
      loadHistory().catch(() => {})
      return true
    }
    if (ev.type === 'error') {
      setError(ev.message)
      setLoading(false)
      setActiveTaskId(null)
      return true
    }
    if (ev.type === 'cancelled') {
      setError('诊断任务已停止')
      setLoading(false)
      setActiveTaskId(null)
      return true
    }
    if (ev.type === 'done') {
      setLoading(false)
      setActiveTaskId(null)
      return true
    }
    return false
  }, [loadHistory])

  const reconnectDiagnosisTask = useCallback(async (taskId: string, knownTask?: TaskInfo | null) => {
    abortRef.current?.abort()
    const runSeq = ++runSeqRef.current
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true)
    setError('')
    setActiveTaskId(taskId)
    setProgressMsg('正在恢复后台诊断任务...')

    try {
      const task = knownTask || await getTask(taskId)
      const events = task.events || []
      let terminal = false
      for (const ev of events) {
        if (runSeq !== runSeqRef.current || ctrl.signal.aborted) return
        terminal = applyDiagnosisEvent(ev) || terminal
      }

      if (task.status !== 'running') {
        if (!terminal) {
          if (task.status === 'failed') setError(task.result_text || '诊断失败')
          else if (task.status === 'cancelled') setError('诊断任务已停止')
          else setLoading(false)
        }
        setActiveTaskId(null)
        return
      }

      setProgressMsg('后台诊断仍在进行，已恢复实时进度')
      await streamTask(
        taskId,
        (ev) => {
          if (runSeq !== runSeqRef.current || ctrl.signal.aborted) return
          applyDiagnosisEvent(ev)
        },
        ctrl.signal,
        events.length,
      )
    } catch (e: any) {
      if (ctrl.signal.aborted || e.name === 'AbortError') return
      if (runSeq === runSeqRef.current) {
        setError(e.message || '恢复后台诊断失败')
        setLoading(false)
      }
    }
  }, [applyDiagnosisEvent])

  const startDiagnosis = useCallback(async () => {
    abortRef.current?.abort()
    const runSeq = ++runSeqRef.current
    setLoading(true)
    setError('')
    setReport(null)
    setActiveTaskId(null)
    setActiveStep(0)
    setProgressMsg('正在创建后台诊断任务...')

    const ctrl = new AbortController()
    abortRef.current = ctrl
    let terminalEventReceived = false

    try {
      await diagnoseStream(
        { article_id: Number(id) },
        (ev: DiagnoseEvent) => {
          if (runSeq !== runSeqRef.current || ctrl.signal.aborted) return
          terminalEventReceived = applyDiagnosisEvent(ev) || terminalEventReceived
        },
        ctrl.signal,
      )
      if (runSeq === runSeqRef.current && !ctrl.signal.aborted && !terminalEventReceived) {
        setProgressMsg('连接已结束，诊断任务仍可在任务中心查看')
      }
    } catch (e: any) {
      if (ctrl.signal.aborted || e.name === 'AbortError') {
        return
      }
      if (runSeq === runSeqRef.current) {
        setError(e.message || '诊断失败')
        setLoading(false)
      }
    }
  }, [id, applyDiagnosisEvent])

  useEffect(() => {
    let alive = true
    ;(async () => {
      setLoading(true)
      setError('')
      try {
        const items = await loadHistory()
        if (!alive) return
        const active = await getActiveDiagnosisTask(Number(id))
        if (!alive) return
        if (active) {
          await reconnectDiagnosisTask(active.id, active)
          return
        }
        if (items.length > 0) {
          setReport(items[0])
          setActiveStep(STEPS.length - 1)
          setProgressMsg('已加载最近一次诊断结果')
          setLoading(false)
        } else {
          await startDiagnosis()
        }
      } catch (e: any) {
        if (!alive) return
        setError(e.message || '加载诊断历史失败')
        setLoading(false)
      }
    })()
    return () => { abortRef.current?.abort() }
  }, [id, loadHistory, reconnectDiagnosisTask, startDiagnosis])

  const copyText = (text: string) => {
    navigator.clipboard.writeText(text)
    toast.success('已复制')
  }

  const applyOptimized = async () => {
    if (!id || !report) return
    const did = Number(report.id || report.diagnosis_id)
    if (!did) {
      toast.error('当前诊断结果尚未保存，无法应用')
      return
    }
    setApplying(true)
    try {
      const r = await applyDiagnosisReport(Number(id), did)
      setReport(r.diagnosis)
      setHistory(prev => prev.map(x => (x.id || x.diagnosis_id) === did ? r.diagnosis : x))
      toast.success(`已应用优化方案：${r.changed.join('、')}`)
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || e?.message || '应用失败')
    } finally {
      setApplying(false)
    }
  }

  if (error) {
    return (
      <Box sx={{ p: 4, textAlign: 'center' }}>
        <Typography color="error" sx={{ mb: 2 }}>{error}</Typography>
        <Button variant="outlined" onClick={startDiagnosis}>重试</Button>
      </Box>
    )
  }

  return (
    <Box className="editorial-page studio-page studio-page--wide">
      <div className="studio-page-head">
        <span className="num">04</span>
        <div>
          <div className="title">发布前诊断</div>
          <div className="desc">把诊断页做成审稿会：评分雷达、问题优先级、专家会议纪要和可一键写回的优化方案同屏可见。</div>
        </div>
        <div className="meta">article #{id}</div>
      </div>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
        <IconButton onClick={() => nav(`/articles/${id}`)} size="small">
          <ArrowBackIcon sx={{ fontSize: 18 }} />
        </IconButton>
        {report && (
          <Chip
            label={`${report.grade}级 · ${report.overall_score}分`}
            sx={{ fontWeight: 700, bgcolor: GRADE_COLORS[report.grade] + '20', color: GRADE_COLORS[report.grade] }}
          />
        )}
        {activeTaskId && (
          <Chip
            size="small"
            color="info"
            label={`后台任务 ${activeTaskId}`}
            sx={{ fontFamily: 'var(--mono)' }}
          />
        )}
        <Box sx={{ flex: 1 }} />
        <Button variant="outlined" size="small" onClick={() => nav(`/articles/${id}`)}>返回笔记</Button>
        <Button variant="contained" size="small" onClick={startDiagnosis} disabled={loading}>重新诊断</Button>
      </Stack>

      {historyLoaded && history.length > 0 && (
        <Alert
          severity="info"
          sx={{ mb: 2 }}
          action={
            <Stack direction="row" spacing={1}>
              <Button
                color="inherit"
                size="small"
                onClick={() => {
                  setReport(history[0])
                  setActiveStep(STEPS.length - 1)
                  setLoading(false)
                }}
              >
                查看最新结果
              </Button>
              <Button color="inherit" size="small" onClick={startDiagnosis} disabled={loading}>
                重新诊断
              </Button>
            </Stack>
          }
        >
          这篇笔记已有 {history.length} 次诊断记录，当前默认展示历史结果；如需更新评分和建议，请重新诊断。
        </Alert>
      )}

      {history.length > 1 && (
        <Card sx={{ mb: 2 }}>
          <CardContent>
            <Stack direction="row" alignItems="center" sx={{ mb: 1.2 }}>
              <Typography fontWeight={700}>历史诊断结果</Typography>
              <Box flex={1} />
              <Chip size="small" label={`${history.length} 条`} />
            </Stack>
            <Stack direction="row" flexWrap="wrap" gap={1}>
              {history.slice(0, 8).map((item, idx) => {
                const selected = (report?.id || report?.diagnosis_id) === (item.id || item.diagnosis_id)
                return (
                  <Button
                    key={item.id || idx}
                    variant={selected ? 'contained' : 'outlined'}
                    size="small"
                    onClick={() => {
                      abortRef.current?.abort()
                      setReport(item)
                      setLoading(false)
                      setError('')
                      setActiveStep(STEPS.length - 1)
                    }}
                    sx={selected ? { bgcolor: 'primary.main', '&:hover': { bgcolor: 'primary.dark' } } : undefined}
                  >
                    {item.grade || '-'}级 · {item.overall_score || 0}分 · {fmtTime(item.created_at)}
                  </Button>
                )
              })}
            </Stack>
          </CardContent>
        </Card>
      )}

      {report && (
        <div className="editorial-audit-strip" style={{ marginBottom: 16 }}>
          <div><b>{report.overall_score || 0}</b><span>overall score</span></div>
          <div><b>{report.grade || '-'}</b><span>diagnosis grade</span></div>
          <div><b>{report.issues?.length || 0}</b><span>issues found</span></div>
          <div><b>{report.elapsed_ms ? `${(report.elapsed_ms / 1000).toFixed(1)}s` : '-'}</b><span>agent elapsed</span></div>
        </div>
      )}

      {/* Progress Stepper */}
      {loading && (
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2 }}>
              <CircularProgress size={20} />
              <Box>
                <Typography fontWeight={600}>{progressMsg}</Typography>
                <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.4 }}>
                  诊断已由后端后台任务接管；刷新、关闭页面或切换到其他页面都不会中断，回来后会自动恢复进度/结果。
                </Typography>
              </Box>
            </Stack>
            <Stepper activeStep={activeStep} alternativeLabel>
              {STEPS.map(s => (
                <Step key={s.key}>
                  <StepLabel>{s.label}</StepLabel>
                </Step>
              ))}
            </Stepper>
          </CardContent>
        </Card>
      )}

      {/* Report */}
      {report && (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 0.95fr) minmax(0, 1.05fr)' },
            gap: 2,
            alignItems: 'start',
            '& > .span-all': { gridColumn: '1 / -1' },
          }}
        >
          {/* Score + Radar */}
          <Grid container spacing={2} className="span-all">
            <Grid item xs={12} md={5}>
              <Card sx={{ height: '100%' }}>
                <CardContent sx={{ textAlign: 'center' }}>
                  <Typography fontSize={64} fontWeight={800} color={GRADE_COLORS[report.grade]}>
                    {report.overall_score}
                  </Typography>
                  <Typography fontSize={20} fontWeight={700} color={GRADE_COLORS[report.grade]}>
                    {report.grade}级
                  </Typography>
                  <Typography fontSize={13} color="text.secondary" sx={{ mt: 1 }}>
                    品类：{report.category_cn} · 耗时 {(report.elapsed_ms / 1000).toFixed(1)}s
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12} md={7}>
              <Card sx={{ height: '100%' }}>
                <CardContent sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                  <RadarChart data={report.radar_data} />
                  <Stack spacing={0.5} sx={{ ml: 2 }}>
                    {Object.entries(report.radar_data).map(([k, v]) => (
                      <Stack key={k} direction="row" alignItems="center" spacing={1}>
                        <Typography fontSize={12} color="text.secondary" sx={{ width: 40 }}>
                          {k === 'content' ? '内容' : k === 'visual' ? '视觉' : k === 'growth' ? '增长' : k === 'user_reaction' ? '用户' : '综合'}
                        </Typography>
                        <LinearProgress
                          variant="determinate"
                          value={v}
                          sx={{ flex: 1, height: 4, borderRadius: 0, minWidth: 80, '& .MuiLinearProgress-bar': { bgcolor: 'primary.main' } }}
                        />
                        <Typography fontSize={12} fontWeight={600}>{v}</Typography>
                      </Stack>
                    ))}
                  </Stack>
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          {/* Issues */}
          <Card>
            <CardContent>
              <div className="editorial-section-label">
                <span className="num">A</span><span className="title">问题诊断</span><span className="desc">按发布风险排序</span>
              </div>
              <Stack spacing={1}>
                {report.issues.map((issue, i) => (
                  <Stack key={i} direction="row" spacing={1} alignItems="flex-start">
                    <Chip
                      label={issue.severity === 'high' ? '严重' : issue.severity === 'medium' ? '中等' : '轻微'}
                      size="small"
                      color={issue.severity === 'high' ? 'error' : issue.severity === 'medium' ? 'warning' : 'default'}
                      sx={{ fontSize: 11, height: 20 }}
                    />
                    <Typography fontSize={13}>{issue.description}</Typography>
                  </Stack>
                ))}
              </Stack>
            </CardContent>
          </Card>

          {/* Suggestions */}
          <Card>
            <CardContent>
              <div className="editorial-section-label">
                <span className="num">B</span><span className="title">优化建议</span><span className="desc">可执行动作</span>
              </div>
              <Stack spacing={1.5}>
                {report.suggestions.map((s, i) => (
                  <Paper key={i} variant="outlined" sx={{ p: 1.5 }}>
                    <Stack direction="row" alignItems="flex-start" spacing={1}>
                      <Chip label={`P${s.priority}`} size="small" color="primary" sx={{ fontSize: 11, height: 20 }} />
                      <Box flex={1}>
                        <Typography fontSize={13}>{s.description}</Typography>
                        {s.expected_impact && (
                          <Typography fontSize={11} color="text.secondary" sx={{ mt: 0.5 }}>
                            预期效果：{s.expected_impact}
                          </Typography>
                        )}
                      </Box>
                    </Stack>
                  </Paper>
                ))}
              </Stack>
            </CardContent>
          </Card>

          {/* Optimized Content */}
          <Card>
            <CardContent>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }} sx={{ mb: 1.5 }}>
                <Box flex={1}>
                  <Typography sx={{ fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: 18, fontWeight: 700 }}>优化方案</Typography>
                  <Typography fontSize={12} color="text.secondary">
                    可一键写回标题、正文和标签；应用前会自动保存一个文章版本，方便回滚。
                  </Typography>
                </Box>
                <Button
                  variant="contained"
                  onClick={applyOptimized}
                  disabled={
                    applying ||
                    !Number(report.id || report.diagnosis_id) ||
                    (!report.optimized_title && !report.optimized_content && !(report.optimized_tags || []).length)
                  }
                >
                  {report.applied_at ? '已应用，可再次应用' : applying ? '应用中...' : '应用优化方案'}
                </Button>
              </Stack>
              <Stack spacing={2}>
                {report.optimized_title && (
                  <Box>
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <Typography fontSize={13} fontWeight={600} color="text.secondary">优化标题</Typography>
                      <IconButton size="small" onClick={() => copyText(report.optimized_title)}>
                        <ContentCopyIcon sx={{ fontSize: 14 }} />
                      </IconButton>
                    </Stack>
                    <Typography fontSize={15} fontWeight={600} sx={{ mt: 0.5 }}>{report.optimized_title}</Typography>
                  </Box>
                )}
                <Divider />
                {report.optimized_content && (
                  <Box>
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <Typography fontSize={13} fontWeight={600} color="text.secondary">优化正文</Typography>
                      <IconButton size="small" onClick={() => copyText(report.optimized_content)}>
                        <ContentCopyIcon sx={{ fontSize: 14 }} />
                      </IconButton>
                    </Stack>
                    <Paper variant="outlined" sx={{ p: 2, mt: 1, whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.8 }}>
                      {report.optimized_content}
                    </Paper>
                  </Box>
                )}
                {report.optimized_tags && report.optimized_tags.length > 0 && (
                  <Box>
                    <Typography fontSize={13} fontWeight={600} color="text.secondary" sx={{ mb: 0.5 }}>推荐标签</Typography>
                    <Stack direction="row" flexWrap="wrap" gap={0.5}>
                      {report.optimized_tags.map((t, i) => (
                        <Chip
                          key={i}
                          label={`#${String(t).replace(/^[#＃]+/, '')}`}
                          size="small"
                          onClick={() => copyText(`#${String(t).replace(/^[#＃]+/, '')}`)}
                          sx={{
                            cursor: 'pointer',
                            minHeight: 22,
                            height: 'auto',
                            color: 'text.primary',
                            '& .MuiChip-label': {
                              py: 0.25,
                              lineHeight: 1.25,
                              whiteSpace: 'normal',
                              overflowWrap: 'anywhere',
                            },
                          }}
                        />
                      ))}
                    </Stack>
                  </Box>
                )}
              </Stack>
            </CardContent>
          </Card>

          {/* Simulated Comments */}
          {report.simulated_comments && report.simulated_comments.length > 0 && (
            <Card>
              <CardContent>
                <div className="editorial-section-label">
                  <span className="num">C</span><span className="title">模拟评论区</span><span className="desc">发布后反馈预演</span>
                </div>
                {report.simulated_comments.map((c, i) => (
                  <CommentCard key={i} comment={c} />
                ))}
              </CardContent>
            </Card>
          )}

          {/* Cover Direction */}
          {report.cover_direction && report.cover_direction.layout && (
            <Card>
              <CardContent>
                <div className="editorial-section-label">
                  <span className="num">D</span><span className="title">封面设计方向</span><span className="desc">视觉首图建议</span>
                </div>
                <Grid container spacing={2}>
                  <Grid item xs={6} md={3}>
                    <Typography fontSize={11} color="text.secondary">构图</Typography>
                    <Typography fontSize={13}>{report.cover_direction.layout}</Typography>
                  </Grid>
                  <Grid item xs={6} md={3}>
                    <Typography fontSize={11} color="text.secondary">配色</Typography>
                    <Typography fontSize={13}>{report.cover_direction.color_scheme}</Typography>
                  </Grid>
                  <Grid item xs={6} md={3}>
                    <Typography fontSize={11} color="text.secondary">文字</Typography>
                    <Typography fontSize={13}>{report.cover_direction.text_style}</Typography>
                  </Grid>
                  <Grid item xs={12} md={3}>
                    <Typography fontSize={11} color="text.secondary">Tips</Typography>
                    {report.cover_direction.tips?.map((t, i) => (
                      <Typography key={i} fontSize={12}>· {t}</Typography>
                    ))}
                  </Grid>
                </Grid>
              </CardContent>
            </Card>
          )}

          {/* Agent Opinions (collapsible) */}
          <Card>
            <CardContent>
              <Stack direction="row" alignItems="center" sx={{ cursor: 'pointer' }} onClick={() => setExpandAgents(!expandAgents)}>
                <Typography fontWeight={700}>专家评估详情</Typography>
                <Box flex={1} />
                {expandAgents ? <ExpandLessIcon /> : <ExpandMoreIcon />}
              </Stack>
              <Collapse in={expandAgents}>
                <Stack spacing={2} sx={{ mt: 2 }}>
                  {report.agent_opinions.map((op, i) => (
                    <div className="editorial-meeting-row" key={i}>
                      <div className="speaker">{String(op.agent_name || op.dimension || 'A').slice(0, 1).toUpperCase()}</div>
                      <div>
                        <div className="role">{op.agent_name || op.dimension}</div>
                        {op.issues && op.issues.length > 0 && (
                          <Typography fontSize={12} sx={{ mb: 0.6 }}>
                            问题：{op.issues.slice(0, 2).join('；')}
                          </Typography>
                        )}
                        {op.suggestions && op.suggestions.length > 0 && (
                          <Typography fontSize={12} color="text.secondary">
                            建议：{op.suggestions.slice(0, 2).join('；')}
                          </Typography>
                        )}
                      </div>
                      <div className="score">{op.score} / 100</div>
                    </div>
                  ))}
                </Stack>
              </Collapse>
            </CardContent>
          </Card>

          {/* Debate (collapsible) */}
          <Card>
            <CardContent>
              <Stack direction="row" alignItems="center" sx={{ cursor: 'pointer' }} onClick={() => setExpandDebate(!expandDebate)}>
                <Typography fontWeight={700}>辩论记录</Typography>
                <Box flex={1} />
                {expandDebate ? <ExpandLessIcon /> : <ExpandMoreIcon />}
              </Stack>
              {report.debate_summary && (
                <Typography fontSize={13} color="text.secondary" sx={{ mt: 1 }}>{report.debate_summary}</Typography>
              )}
              <Collapse in={expandDebate}>
                <Stack spacing={2} sx={{ mt: 2 }}>
                  {report.debate_results.map((d, i) => (
                    <Paper key={i} variant="outlined" sx={{ p: 1.4, bgcolor: 'var(--paper-soft)' }}>
                      <Typography className="editorial-mono" fontWeight={700} fontSize={10.5} sx={{ mb: 1, color: 'primary.main' }}>{d.agent}</Typography>
                      {d.disagreements && d.disagreements.length > 0 && (
                        <Box sx={{ mb: 0.5 }}>
                          <Typography fontSize={11} color="error.main" fontWeight={600}>反驳：</Typography>
                          {d.disagreements.map((item, j) => (
                            <Typography key={j} fontSize={12} sx={{ pl: 1 }}>· {item}</Typography>
                          ))}
                        </Box>
                      )}
                      {d.additions && d.additions.length > 0 && (
                        <Box>
                          <Typography fontSize={11} color="info.main" fontWeight={600}>补充：</Typography>
                          {d.additions.map((item, j) => (
                            <Typography key={j} fontSize={12} sx={{ pl: 1 }}>· {item}</Typography>
                          ))}
                        </Box>
                      )}
                    </Paper>
                  ))}
                </Stack>
              </Collapse>
            </CardContent>
          </Card>

          {/* Actions */}
          <Stack className="span-all" direction="row" spacing={2} justifyContent="center" sx={{ pb: 4 }}>
            <Button variant="outlined" onClick={() => nav(`/articles/${id}`)}>返回笔记</Button>
            <Button variant="contained" onClick={startDiagnosis}>
              重新诊断
            </Button>
          </Stack>
        </Box>
      )}
    </Box>
  )
}
