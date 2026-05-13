import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
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
import { getArticle, diagnoseStream, type DiagnosisReport, type DiagnoseEvent } from '../api/client'

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
  S: '#FF2741',
  A: '#FF7A00',
  B: '#F59E0B',
  C: '#6B7280',
  D: '#DC2626',
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
          stroke="#e5e7eb"
          strokeWidth={0.5}
        />
      ))}
      {points(r).map((p, i) => (
        <line key={i} x1={cx} y1={cy} x2={p[0]} y2={p[1]} stroke="#e5e7eb" strokeWidth={0.5} />
      ))}
      <polygon
        points={polygon(dataPoints)}
        fill="rgba(255,39,65,0.15)"
        stroke="#FF2741"
        strokeWidth={2}
      />
      {dataPoints.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r={4} fill="#FF2741" />
      ))}
      {points(r + 16).map((p, i) => (
        <text
          key={i}
          x={p[0]}
          y={p[1]}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={11}
          fill="#6B7280"
          fontWeight={600}
        >
          {labels[keys[i]]}
        </text>
      ))}
    </svg>
  )
}

function CommentCard({ comment }: { comment: any }) {
  const sentimentColor = comment.sentiment === 'positive' ? '#16A34A' : comment.sentiment === 'negative' ? '#DC2626' : '#6B7280'
  return (
    <Paper variant="outlined" sx={{ p: 1.5, mb: 1 }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
        <Typography fontSize={16}>{comment.avatar_emoji || '👤'}</Typography>
        <Typography fontSize={13} fontWeight={600} color="text.primary">{comment.username}</Typography>
        <Chip label={comment.persona || comment.sentiment} size="small" sx={{ fontSize: 10, height: 18, bgcolor: sentimentColor + '15', color: sentimentColor }} />
        <Box flex={1} />
        <Typography fontSize={11} color="text.secondary">❤️ {comment.likes}</Typography>
      </Stack>
      <Typography fontSize={13} color="text.primary" sx={{ pl: 3.5 }}>{comment.comment}</Typography>
    </Paper>
  )
}

export default function DiagnosePage() {
  const { id } = useParams<{ id: string }>()
  const nav = useNavigate()
  const [loading, setLoading] = useState(true)
  const [activeStep, setActiveStep] = useState(0)
  const [progressMsg, setProgressMsg] = useState('准备中...')
  const [report, setReport] = useState<DiagnosisReport | null>(null)
  const [error, setError] = useState('')
  const [expandDebate, setExpandDebate] = useState(false)
  const [expandAgents, setExpandAgents] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const runSeqRef = useRef(0)

  const startDiagnosis = useCallback(async () => {
    abortRef.current?.abort()
    const runSeq = ++runSeqRef.current
    setLoading(true)
    setError('')
    setReport(null)
    setActiveStep(0)
    setProgressMsg('准备中...')

    const ctrl = new AbortController()
    abortRef.current = ctrl
    let terminalEventReceived = false

    try {
      await diagnoseStream(
        { article_id: Number(id) },
        (ev: DiagnoseEvent) => {
          if (runSeq !== runSeqRef.current || ctrl.signal.aborted) return
          if (ev.type === 'progress') {
            setProgressMsg(ev.message)
            const idx = STEPS.findIndex(s => s.key === ev.step)
            if (idx >= 0) setActiveStep(idx)
          } else if (ev.type === 'result') {
            terminalEventReceived = true
            setReport(ev.data)
            setActiveStep(STEPS.length - 1)
            setLoading(false)
          } else if (ev.type === 'error') {
            terminalEventReceived = true
            setError(ev.message)
            setLoading(false)
          }
        },
        ctrl.signal,
      )
      if (runSeq === runSeqRef.current && !ctrl.signal.aborted && !terminalEventReceived) {
        setError('诊断结束但未返回结果，请重试')
        setLoading(false)
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
  }, [id])

  useEffect(() => {
    startDiagnosis()
    return () => { abortRef.current?.abort() }
  }, [startDiagnosis])

  const copyText = (text: string) => {
    navigator.clipboard.writeText(text)
    toast.success('已复制')
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
    <Box sx={{ maxWidth: 1100, mx: 'auto', p: { xs: 2, md: 3 } }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 3 }}>
        <IconButton onClick={() => nav(`/articles/${id}`)}>
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h6" fontWeight={700}>笔记诊断</Typography>
        {report && (
          <Chip
            label={`${report.grade}级 · ${report.overall_score}分`}
            sx={{ ml: 2, fontWeight: 700, bgcolor: GRADE_COLORS[report.grade] + '20', color: GRADE_COLORS[report.grade] }}
          />
        )}
      </Stack>

      {/* Progress Stepper */}
      {loading && (
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2 }}>
              <CircularProgress size={20} />
              <Typography fontWeight={600}>{progressMsg}</Typography>
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
        <Stack spacing={3}>
          {/* Score + Radar */}
          <Grid container spacing={3}>
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
                          sx={{ flex: 1, height: 6, borderRadius: 3, minWidth: 80, '& .MuiLinearProgress-bar': { bgcolor: '#FF2741' } }}
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
              <Typography fontWeight={700} sx={{ mb: 1.5 }}>问题诊断</Typography>
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
              <Typography fontWeight={700} sx={{ mb: 1.5 }}>优化建议</Typography>
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
              <Typography fontWeight={700} sx={{ mb: 1.5 }}>优化方案</Typography>
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
                        <Chip key={i} label={t} size="small" onClick={() => copyText(t)} sx={{ cursor: 'pointer' }} />
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
                <Typography fontWeight={700} sx={{ mb: 1.5 }}>模拟评论区</Typography>
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
                <Typography fontWeight={700} sx={{ mb: 1.5 }}>封面设计方向</Typography>
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
                    <Paper key={i} variant="outlined" sx={{ p: 2 }}>
                      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                        <Typography fontWeight={600} fontSize={14}>{op.agent_name || op.dimension}</Typography>
                        <Chip label={`${op.score}分`} size="small" color={op.score >= 75 ? 'success' : op.score >= 60 ? 'warning' : 'error'} />
                      </Stack>
                      {op.issues && op.issues.length > 0 && (
                        <Box sx={{ mb: 1 }}>
                          <Typography fontSize={12} color="text.secondary" fontWeight={600}>问题：</Typography>
                          {op.issues.map((issue, j) => (
                            <Typography key={j} fontSize={12} sx={{ pl: 1 }}>· {issue}</Typography>
                          ))}
                        </Box>
                      )}
                      {op.suggestions && op.suggestions.length > 0 && (
                        <Box>
                          <Typography fontSize={12} color="text.secondary" fontWeight={600}>建议：</Typography>
                          {op.suggestions.map((sug, j) => (
                            <Typography key={j} fontSize={12} sx={{ pl: 1 }}>· {sug}</Typography>
                          ))}
                        </Box>
                      )}
                    </Paper>
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
                    <Paper key={i} variant="outlined" sx={{ p: 2 }}>
                      <Typography fontWeight={600} fontSize={13} sx={{ mb: 1 }}>{d.agent}</Typography>
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
          <Stack direction="row" spacing={2} justifyContent="center" sx={{ pb: 4 }}>
            <Button variant="outlined" onClick={() => nav(`/articles/${id}`)}>返回笔记</Button>
            <Button variant="contained" onClick={startDiagnosis} sx={{ bgcolor: '#FF2741', '&:hover': { bgcolor: '#E0223A' } }}>
              重新诊断
            </Button>
          </Stack>
        </Stack>
      )}
    </Box>
  )
}
