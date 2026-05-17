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
  IconButton,
  Paper,
  Stack,
  Typography,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
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
  { key: 'detect', label: '品类检测', hint: '本地' },
  { key: 'model_a', label: '预评分', hint: '本地' },
  { key: 'text_analysis', label: '文本分析', hint: '本地' },
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

const SCORE_LABELS: Record<string, string> = {
  content: '内容质量',
  visual: '视觉吸引',
  growth: '增长潜力',
  user_reaction: '互动设计',
  overall: '综合',
}

const SCORE_KEYS = ['content', 'visual', 'growth', 'user_reaction', 'overall']

function scoreTen(value?: number) {
  const n = Math.max(0, Math.min(100, Number(value ?? 0)))
  return (n / 10).toFixed(1)
}

function priorityLabel(severity?: string, index = 0) {
  if (severity === 'high') return 'P1'
  if (severity === 'medium') return 'P2'
  return `P${Math.min(3, index + 1)}`
}

function normalizeDiagnosisStep(step?: string) {
  if (!step) return ''
  if (step.startsWith('agent_done_')) return 'agents_start'
  if (step === 'debate_done') return 'debate_start'
  if (step === 'judge_done') return 'judge_start'
  return step
}

function fallbackProgressForStep(step?: string) {
  const normalized = normalizeDiagnosisStep(step)
  const idx = STEPS.findIndex(s => s.key === normalized)
  if (idx < 0) return 0
  return Math.round((idx / Math.max(1, STEPS.length - 1)) * 100)
}

export default function DiagnosePage() {
  const { id } = useParams<{ id: string }>()
  const nav = useNavigate()
  const [loading, setLoading] = useState(true)
  const [activeStep, setActiveStep] = useState(0)
  const [progressPercent, setProgressPercent] = useState(0)
  const [progressData, setProgressData] = useState<Record<string, any>>({})
  const [progressMsg, setProgressMsg] = useState('准备中...')
  const [report, setReport] = useState<DiagnosisReport | null>(null)
  const [history, setHistory] = useState<DiagnosisReport[]>([])
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [error, setError] = useState('')
  const [applying, setApplying] = useState(false)
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
      setProgressData(ev.data || {})
      const normalizedStep = normalizeDiagnosisStep(ev.step)
      const idx = STEPS.findIndex(s => s.key === normalizedStep)
      if (idx >= 0) setActiveStep(idx)
      const nextProgress = Number(ev.data?.progress)
      setProgressPercent(Number.isFinite(nextProgress) ? Math.max(0, Math.min(100, nextProgress)) : fallbackProgressForStep(normalizedStep))
      return false
    }
    if (ev.type === 'result') {
      setReport(ev.data)
      setHistory(prev => [ev.data, ...prev.filter(x => (x.id || x.diagnosis_id) !== (ev.data.id || ev.data.diagnosis_id))])
      setActiveStep(STEPS.length - 1)
      setProgressPercent(100)
      setProgressData({ progress: 100, score: ev.data?.overall_score, grade: ev.data?.grade })
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
    setProgressPercent(0)
    setProgressData({})
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
          setProgressPercent(100)
          setProgressData({ progress: 100, grade: items[0].grade, score: items[0].overall_score })
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

  const visualNeedsImages = !!report && (
    Number(report.radar_data?.visual ?? 0) < 60 ||
    (report.issues || []).some(issue => /图片|配图|封面|首图|视觉|无图|0\s*图/.test(issue.description || ''))
  )

  const meetingOpinions = report
    ? (
      report.agent_opinions?.length
        ? report.agent_opinions
        : [{
          agent_name: '综合裁判',
          dimension: report.category_cn || report.category || 'overall',
          score: report.overall_score || 0,
          issues: (report.issues || []).map(x => x.description),
          suggestions: (report.suggestions || []).map(x => x.description),
          reasoning: report.debate_summary || '已完成多维度诊断，建议先处理高优先级问题后再发布。',
        }]
    )
    : []

  const canApplyOptimized = !!report && Number(report.id || report.diagnosis_id) > 0 && (
    !!report.optimized_title ||
    !!report.optimized_content ||
    (report.optimized_tags || []).length > 0
  )

  const renderPipeline = (compact = false) => (
    <>
      <div className="diagnose-pipeline">
        {STEPS.filter(s => s.key !== 'done').map((step, idx, arr) => {
          const done = !loading || activeStep > idx
          const active = loading && activeStep === idx
          return (
            <div className="diagnose-pipeline-piece" key={step.key}>
              <div className={`diagnose-pipeline-step ${done ? 'is-done' : ''} ${active ? 'is-active' : ''}`}>
                <span>{done ? '✓' : idx + 1}</span>
                <b>{compact ? step.label.replace('品类检测', '品类').replace('文本分析', '文本').replace('专家诊断', '专家').replace('专家辩论', '辩论').replace('综合裁判', '裁判') : step.label}</b>
                {'hint' in step && step.hint && <em>{step.hint}</em>}
              </div>
              {idx < arr.length - 1 && <i />}
            </div>
          )
        })}
      </div>
      {loading && (
        <div className="diagnose-progress-panel">
          <div className="diagnose-progress-head">
            <span><span className="editorial-dot" />{progressMsg}</span>
            <b>{Math.round(progressPercent)}%</b>
          </div>
          <div className="diagnose-progress-bar" aria-label="诊断进度">
            <i style={{ width: `${Math.max(0, Math.min(100, progressPercent))}%` }} />
          </div>
          <div className="diagnose-progress-meta">
            <span>前三步是本地真实计算，通常很快完成；专家诊断/辩论是远端模型调用。</span>
            {progressData?.total ? <span>{progressData.current ?? 0}/{progressData.total}</span> : null}
          </div>
        </div>
      )}
    </>
  )

  if (error) {
    return (
      <Box sx={{ p: 4, textAlign: 'center' }}>
        <Typography color="error" sx={{ mb: 2 }}>{error}</Typography>
        <Button variant="outlined" onClick={startDiagnosis}>重试</Button>
      </Box>
    )
  }

  return (
    <Box className="editorial-page diagnose-prototype-page">
      <div className="diagnose-topbar">
        <IconButton className="diagnose-back-btn" onClick={() => nav(`/articles/${id}`)} size="small">
          <ArrowBackIcon sx={{ fontSize: 18 }} />
        </IconButton>
        <h2><span className="num">04</span>发布前诊断</h2>
        <span className="diagnose-topbar-meta">
          笔记 #{id}{report?.category_cn ? ` · ${report.category_cn}` : ''}
        </span>
        {report && (
          <Chip
            className="diagnose-grade-chip"
            label={`${report.grade || '-'}级 · ${report.overall_score || 0}分`}
            size="small"
            sx={{ bgcolor: `${GRADE_COLORS[report.grade] || 'var(--accent)'}18`, color: GRADE_COLORS[report.grade] || 'var(--accent)' }}
          />
        )}
        {activeTaskId && <span className="diagnose-task-pill">后台任务 {activeTaskId}</span>}
        <div className="diagnose-topbar-actions">
          <Button
            variant="outlined"
            size="small"
            disabled={!history.length}
            onClick={() => document.getElementById('diagnose-history')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })}
          >
            历史诊断
          </Button>
          <Button variant="contained" size="small" onClick={startDiagnosis} disabled={loading}>
            重新诊断
          </Button>
        </div>
      </div>

      {historyLoaded && history.length > 0 && (
        <div className="diagnose-history-strip" id="diagnose-history">
          <span>已有 {history.length} 次诊断记录</span>
          <div>
            {history.slice(0, 6).map((item, idx) => {
              const selected = (report?.id || report?.diagnosis_id) === (item.id || item.diagnosis_id)
              return (
                <button
                  key={item.id || idx}
                  className={selected ? 'is-selected' : ''}
                  onClick={() => {
                    abortRef.current?.abort()
                    setReport(item)
                    setLoading(false)
                    setError('')
                    setActiveStep(STEPS.length - 1)
                    setProgressPercent(100)
                    setProgressData({ progress: 100, grade: item.grade, score: item.overall_score })
                  }}
                >
                  {item.grade || '-'}级 · {item.overall_score || 0} · {fmtTime(item.created_at)}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {loading && !report && (
        <Card className="diagnose-card diagnose-loading-card">
          <CardContent>
            <Stack direction="row" alignItems="center" spacing={1.4} sx={{ mb: 1.4 }}>
              <CircularProgress size={18} />
              <Box>
                <Typography fontSize={13.5} fontWeight={700}>{progressMsg}</Typography>
                <Typography fontSize={12} color="text.secondary">
                  诊断已由后台任务接管，刷新或关闭页面不会中断；下方展示真实阶段和百分比。
                </Typography>
              </Box>
            </Stack>
            {renderPipeline(true)}
          </CardContent>
        </Card>
      )}

      {report && (
        <>
          <div className="diagnose-content-grid">
            <div className="diagnose-column">
              <Card className="diagnose-card diagnose-pipeline-card">
                <CardContent>
                  <div className="diagnose-card-label">诊断流水线</div>
                  {renderPipeline(true)}
                </CardContent>
              </Card>

              <Card className="diagnose-card diagnose-radar-card">
                <CardContent>
                  <div className="diagnose-card-label">五维评分</div>
                  <div className="diagnose-score-layout">
                    <div className="diagnose-radar-frame">
                      <RadarChart data={report.radar_data || {}} />
                    </div>
                    <div className="diagnose-score-list">
                      {SCORE_KEYS.map(key => (
                        <div className={`diagnose-score-row ${key === 'overall' ? 'is-total' : ''}`} key={key}>
                          <span>{SCORE_LABELS[key]}</span>
                          <b>{scoreTen(report.radar_data?.[key])}</b>
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="diagnose-card diagnose-issues-card">
                <CardContent>
                  <div className="diagnose-card-label">
                    问题诊断
                    {(report.issues || []).length > 6 ? <small>首屏展示 6 / 共 {(report.issues || []).length} 条</small> : null}
                  </div>
                  <div className="diagnose-issue-list">
                    {(report.issues || []).length ? (
                      report.issues.slice(0, 6).map((issue, i) => (
                        <div className="diagnose-issue-row" key={`${issue.description}-${i}`}>
                          <span className={`diagnose-priority ${issue.severity === 'high' ? 'is-alert' : issue.severity === 'medium' ? 'is-draft' : ''}`}>
                            {priorityLabel(issue.severity, i)}
                          </span>
                          <span>{issue.description}</span>
                          <em>{issue.from_agent || '综合'}</em>
                        </div>
                      ))
                    ) : (
                      <div className="diagnose-empty-row">未发现明显发布风险。</div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {visualNeedsImages && (
                <Alert
                  className="diagnose-visual-alert"
                  severity="warning"
                  action={
                    <Stack direction="row" spacing={0.8}>
                      <Button color="inherit" size="small" onClick={() => nav(`/articles/${id}`)}>上传图</Button>
                      <Button color="inherit" size="small" onClick={() => nav(`/articles/${id}?chat=1`)}>让 Agent 生成</Button>
                    </Stack>
                  }
                >
                  视觉/图片是当前短板，建议补首图或内容图后再诊断。
                </Alert>
              )}
            </div>

            <div className="diagnose-column">
              <Card className="diagnose-card diagnose-meeting-card">
                <CardContent>
                  <div className="diagnose-card-label">专家辩论 · 会议纪要</div>
                  <div className="diagnose-meeting-list">
                    {meetingOpinions.slice(0, 4).map((op, i) => (
                      <div className="editorial-meeting-row" key={`${op.agent_name}-${i}`}>
                        <div className="speaker">{String(op.agent_name || op.dimension || 'A').slice(0, 1).toUpperCase()}</div>
                        <div>
                          <div className="role">{op.agent_name || op.dimension}</div>
                          <Typography fontSize={12.5} lineHeight={1.55}>
                            {(op.issues?.[0] || op.reasoning || op.suggestions?.[0] || '已完成该维度评估。').slice(0, 96)}
                          </Typography>
                          {op.suggestions?.length > 0 && (
                            <Typography fontSize={12} color="text.secondary" sx={{ mt: 0.5 }}>
                              建议：{op.suggestions[0].slice(0, 88)}
                            </Typography>
                          )}
                        </div>
                        <div className="score">{scoreTen(op.score)} / 10</div>
                      </div>
                    ))}
                  </div>

                  <div className="diagnose-event-feed event-feed">
                    <div><span className="red">{fmtTime(report.created_at).slice(11, 16) || '--:--'}</span><span>诊断报告已保存</span><span>ok</span></div>
                    <div><span className="red">AI</span><span>专家辩论输出 {report.debate_results?.length || 0} 组补充意见</span><span>live</span></div>
                    <div><span className="red">UX</span><span>等待用户确认是否应用 title/body/tags</span><span>hold</span></div>
                  </div>

                  <div className="diagnose-verdict">
                    <div>综合裁判结论</div>
                    <p>{report.debate_summary || '可发布，但建议先应用高优先级优化项，以提升点击率、收藏率和发布稳定性。'}</p>
                  </div>
                </CardContent>
              </Card>

              <Card className="diagnose-action-card">
                <CardContent>
                  <span>应用优化方案？</span>
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={() => document.getElementById('diagnose-optimized')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  >
                    查看 diff
                  </Button>
                  <Button
                    variant="contained"
                    size="small"
                    className="diagnose-arrow-btn"
                    onClick={applyOptimized}
                    disabled={applying || !canApplyOptimized}
                  >
                    {report.applied_at ? '已应用，可再次应用' : applying ? '应用中...' : '一键应用'}
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>

          <div className="diagnose-secondary-grid">
            <Card className="diagnose-card" id="diagnose-optimized">
              <CardContent>
                <div className="editorial-section-label">
                  <span className="num">A</span><span className="title">优化方案详情</span><span className="desc">title / body / tags</span>
                </div>
                <Stack spacing={1.5}>
                  {report.optimized_title && (
                    <Box>
                      <Stack direction="row" alignItems="center" spacing={1}>
                        <Typography fontSize={12} fontWeight={700} color="text.secondary">优化标题</Typography>
                        <Button size="small" variant="text" onClick={() => copyText(report.optimized_title)}>复制</Button>
                      </Stack>
                      <Typography fontSize={15} fontWeight={700}>{report.optimized_title}</Typography>
                    </Box>
                  )}
                  {report.optimized_content && (
                    <Box>
                      <Stack direction="row" alignItems="center" spacing={1}>
                        <Typography fontSize={12} fontWeight={700} color="text.secondary">优化正文</Typography>
                        <Button size="small" variant="text" onClick={() => copyText(report.optimized_content)}>复制</Button>
                      </Stack>
                      <Paper variant="outlined" className="diagnose-copy-box">
                        {report.optimized_content}
                      </Paper>
                    </Box>
                  )}
                  {(report.optimized_tags || []).length > 0 && (
                    <Box>
                      <Typography fontSize={12} fontWeight={700} color="text.secondary" sx={{ mb: 0.7 }}>推荐标签</Typography>
                      <Stack direction="row" flexWrap="wrap" gap={0.5}>
                        {report.optimized_tags.map((t, i) => (
                          <Chip
                            key={`${t}-${i}`}
                            label={`#${String(t).replace(/^[#＃]+/, '')}`}
                            size="small"
                            onClick={() => copyText(`#${String(t).replace(/^[#＃]+/, '')}`)}
                            sx={{ cursor: 'pointer' }}
                          />
                        ))}
                      </Stack>
                    </Box>
                  )}
                </Stack>
              </CardContent>
            </Card>

            <Card className="diagnose-card">
              <CardContent>
                <div className="editorial-section-label">
                  <span className="num">B</span><span className="title">完整问题清单</span><span className="desc">{(report.issues || []).length} issues</span>
                </div>
                <div className="diagnose-issue-list">
                  {(report.issues || []).map((issue, i) => (
                    <div className="diagnose-issue-row" key={`full-${issue.description}-${i}`}>
                      <span className={`diagnose-priority ${issue.severity === 'high' ? 'is-alert' : issue.severity === 'medium' ? 'is-draft' : ''}`}>
                        {priorityLabel(issue.severity, i)}
                      </span>
                      <span>{issue.description}</span>
                      <em>{issue.from_agent || '综合'}</em>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="diagnose-card">
              <CardContent>
                <div className="editorial-section-label">
                  <span className="num">C</span><span className="title">优化建议</span><span className="desc">{(report.suggestions || []).length} actions</span>
                </div>
                <Stack spacing={1}>
                  {(report.suggestions || []).map((s, i) => (
                    <Paper key={`${s.description}-${i}`} variant="outlined" className="diagnose-suggestion-row">
                      <span>P{s.priority || i + 1}</span>
                      <div>
                        <Typography fontSize={13}>{s.description}</Typography>
                        {s.expected_impact && <Typography fontSize={11.5} color="text.secondary">预期效果：{s.expected_impact}</Typography>}
                      </div>
                    </Paper>
                  ))}
                </Stack>
              </CardContent>
            </Card>

            {report.cover_direction && report.cover_direction.layout && (
              <Card className="diagnose-card">
                <CardContent>
                  <div className="editorial-section-label">
                    <span className="num">D</span><span className="title">封面设计方向</span><span className="desc">视觉首图建议</span>
                  </div>
                  <div className="diagnose-cover-grid">
                    <div><b>构图</b><span>{report.cover_direction.layout}</span></div>
                    <div><b>配色</b><span>{report.cover_direction.color_scheme}</span></div>
                    <div><b>文字</b><span>{report.cover_direction.text_style}</span></div>
                    <div><b>Tips</b><span>{report.cover_direction.tips?.join('；')}</span></div>
                  </div>
                </CardContent>
              </Card>
            )}

            {report.simulated_comments && report.simulated_comments.length > 0 && (
              <Card className="diagnose-card">
                <CardContent>
                  <div className="editorial-section-label">
                    <span className="num">E</span><span className="title">模拟评论区</span><span className="desc">{report.simulated_comments.length} comments</span>
                  </div>
                  {report.simulated_comments.map((c, i) => (
                    <CommentCard key={`${c.username}-${i}`} comment={c} />
                  ))}
                </CardContent>
              </Card>
            )}

            {meetingOpinions.length > 0 && (
              <Card className="diagnose-card">
                <CardContent>
                  <div className="editorial-section-label">
                    <span className="num">F</span><span className="title">专家完整意见</span><span className="desc">{meetingOpinions.length} agents</span>
                  </div>
                  <div className="diagnose-agent-full-list">
                    {meetingOpinions.map((op, i) => (
                      <div className="editorial-meeting-row" key={`full-agent-${op.agent_name}-${i}`}>
                        <div className="speaker">{String(op.agent_name || op.dimension || 'A').slice(0, 1).toUpperCase()}</div>
                        <div>
                          <div className="role">{op.agent_name || op.dimension}</div>
                          {op.reasoning && <Typography fontSize={12.5} lineHeight={1.65}>{op.reasoning}</Typography>}
                          {op.issues?.length > 0 && <Typography fontSize={12} sx={{ mt: 0.7 }}>问题：{op.issues.join('；')}</Typography>}
                          {op.suggestions?.length > 0 && <Typography fontSize={12} color="text.secondary" sx={{ mt: 0.5 }}>建议：{op.suggestions.join('；')}</Typography>}
                        </div>
                        <div className="score">{scoreTen(op.score)} / 10</div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </>
      )}
    </Box>
  )
}
