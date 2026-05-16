import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Box, Chip, Paper, Stack, Typography } from '@mui/material'
import { getCalendar, getStats } from '../api/client'
import { getBeijingTodayParts } from '../utils/time'

interface Stats {
  total: number
  by_status: Record<string, number>
  scored_count: number
  avg_score: number | null
  top_tags: Array<{ tag: string; count: number }>
}

type CalendarData = Record<string, Array<{ id: number; title: string; status: string }>>

function StatCard({ value, label, color }: { value: string | number; label: string; color?: string }) {
  return (
    <Paper
      sx={{
        p: 2.5,
        textAlign: 'center',
        position: 'relative',
        overflow: 'hidden',
        '&:hover': { transform: 'translateY(-1px)', borderColor: 'primary.main' },
        transition: 'all 0.18s cubic-bezier(0.16,1,0.3,1)',
      }}
    >
      <Typography sx={{ fontFamily: 'var(--serif)', fontSize: 34, fontWeight: 800, color: color || 'text.primary', letterSpacing: -1 }}>
        {value}
      </Typography>
      <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mt: 0.3, fontWeight: 500 }}>
        {label}
      </Typography>
    </Paper>
  )
}

function TagBarChart({ items }: { items: Array<{ tag: string; count: number }> }) {
  const max = Math.max(1, ...items.map(x => x.count))
  if (!items.length) {
    return <Typography sx={{ py: 6, textAlign: 'center', fontSize: 13, color: 'text.secondary' }}>暂无标签数据</Typography>
  }
  return (
    <Stack spacing={1.1} sx={{ height: 240, justifyContent: 'center' }}>
      {items.slice(0, 10).map(item => (
        <Box key={item.tag}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <Typography sx={{ width: 70, fontSize: 11, color: 'text.secondary', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {item.tag}
            </Typography>
            <Box sx={{ flex: 1, height: 9, borderRadius: 0, bgcolor: 'var(--paper-soft)', overflow: 'hidden' }}>
              <Box
                sx={{
                  width: `${Math.max(6, (item.count / max) * 100)}%`,
                  height: '100%',
                  borderRadius: 0,
                  bgcolor: 'text.primary',
                }}
              />
            </Box>
            <Typography sx={{ width: 24, fontSize: 11, fontWeight: 700, color: 'text.primary', textAlign: 'right' }}>
              {item.count}
            </Typography>
          </Stack>
        </Box>
      ))}
    </Stack>
  )
}

function StatusDonutChart({
  data,
  labels,
}: {
  data: Record<string, number>
  labels: Record<string, string>
}) {
  const colors = ['#C8302E', '#3E6B4E', '#A87029', '#8C8578']
  const entries = Object.entries(data).filter(([, v]) => v > 0)
  const total = entries.reduce((sum, [, v]) => sum + v, 0)
  let offset = 25
  const radius = 54
  const circumference = 2 * Math.PI * radius

  if (!total) {
    return <Typography sx={{ py: 6, textAlign: 'center', fontSize: 13, color: 'text.secondary' }}>暂无状态数据</Typography>
  }

  return (
    <Stack direction="row" alignItems="center" justifyContent="center" spacing={2} sx={{ height: 240 }}>
      <Box sx={{ position: 'relative', width: 150, height: 150 }}>
        <svg width="150" height="150" viewBox="0 0 150 150">
          <circle cx="75" cy="75" r={radius} fill="none" stroke="#F3F4F6" strokeWidth="18" />
          {entries.map(([key, value], i) => {
            const dash = (value / total) * circumference
            const circle = (
              <circle
                key={key}
                cx="75"
                cy="75"
                r={radius}
                fill="none"
                stroke={colors[i % colors.length]}
                strokeWidth="18"
                strokeLinecap="round"
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 75 75)"
              />
            )
            offset += dash
            return circle
          })}
        </svg>
        <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
          <Box sx={{ textAlign: 'center' }}>
            <Typography sx={{ fontSize: 24, fontWeight: 800 }}>{total}</Typography>
            <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>总计</Typography>
          </Box>
        </Box>
      </Box>
      <Stack spacing={1}>
        {entries.map(([key, value], i) => (
          <Stack key={key} direction="row" alignItems="center" spacing={1}>
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: colors[i % colors.length] }} />
            <Typography sx={{ fontSize: 12, color: 'text.secondary', minWidth: 56 }}>{labels[key] || key}</Typography>
            <Typography sx={{ fontSize: 12, fontWeight: 700 }}>{value}</Typography>
          </Stack>
        ))}
      </Stack>
    </Stack>
  )
}

export default function AnalyticsPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [calendar, setCalendar] = useState<CalendarData>({})
  const nav = useNavigate()

  useEffect(() => {
    getStats().then(setStats).catch(() => {})
    getCalendar().then(setCalendar).catch(() => {})
  }, [])

  const statusLabel: Record<string, string> = {
    draft: '草稿',
    published: '已发布',
    scheduled: '定时发布',
  }

  const today = getBeijingTodayParts()
  const daysInMonth = new Date(today.year, today.month, 0).getDate()
  const firstDayOfWeek = new Date(today.year, today.month - 1, 1).getDay()
  const monthStr = `${today.year}-${String(today.month).padStart(2, '0')}`

  return (
    <Box className="editorial-page studio-page">
      <div className="studio-page-head">
        <span className="num">05</span>
        <div>
          <div className="title">数据概览</div>
          <div className="desc">编辑部数据看板：稿件状态、平均评分、标签分布和发布日历。</div>
        </div>
        <div className="meta">{monthStr}</div>
      </div>

      {/* Stats cards */}
      {stats && (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: 2, mb: 4 }}>
          <StatCard value={stats.total} label="总笔记数" color="#C8302E" />
          <StatCard value={stats.by_status['published'] || 0} label="已发布" color="#16A34A" />
          <StatCard value={stats.by_status['draft'] || 0} label="草稿" color="#A87029" />
          <StatCard value={stats.avg_score ?? '—'} label="平均评分" />
        </Box>
      )}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2.5, mb: 4 }}>
        {/* Tag distribution */}
        {stats && (
          <Paper sx={{ p: 2.5 }}>
            <Typography sx={{ fontSize: 14, fontWeight: 600, mb: 1.5 }}>标签分布 Top 15</Typography>
            <TagBarChart items={stats.top_tags} />
          </Paper>
        )}

        {/* Status pie */}
        {stats && (
          <Paper sx={{ p: 2.5 }}>
            <Typography sx={{ fontSize: 14, fontWeight: 600, mb: 1.5 }}>状态分布</Typography>
            <StatusDonutChart data={stats.by_status} labels={statusLabel} />
          </Paper>
        )}
      </Box>

      {/* Content calendar */}
      <Paper sx={{ p: 2.5 }}>
        <Typography sx={{ fontSize: 14, fontWeight: 600, mb: 2 }}>
          内容日历 · {today.year}年{today.month}月
        </Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.5 }}>
          {['日', '一', '二', '三', '四', '五', '六'].map(d => (
            <Typography key={d} sx={{ textAlign: 'center', fontSize: 11, color: 'text.secondary', py: 0.5, fontWeight: 600 }}>
              {d}
            </Typography>
          ))}
          {Array.from({ length: firstDayOfWeek }).map((_, i) => (
            <Box key={`empty-${i}`} />
          ))}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1
            const dateStr = `${monthStr}-${String(day).padStart(2, '0')}`
            const articles = calendar[dateStr] || []
            const isToday = day === today.day
            return (
              <Box
                key={day}
                sx={{
                  minHeight: { xs: 40, md: 64 },
                  border: '1px solid',
                  borderColor: isToday ? 'primary.main' : 'divider',
                  borderRadius: 0,
                  p: 0.5,
                  cursor: articles.length ? 'pointer' : 'default',
                  bgcolor: isToday ? 'var(--accent-soft)' : 'transparent',
                  transition: 'all 0.15s ease',
                  '&:hover': articles.length ? { bgcolor: 'rgba(0,0,0,0.02)', borderColor: 'text.secondary' } : {},
                }}
              >
                <Typography sx={{ fontSize: 11, fontWeight: isToday ? 700 : 400, color: isToday ? 'primary.main' : 'text.secondary' }}>
                  {day}
                </Typography>
                {articles.slice(0, 2).map(a => (
                  <Chip
                    key={a.id}
                    label={a.title?.slice(0, 5) || `#${a.id}`}
                    size="small"
                    onClick={() => nav(`/articles/${a.id}`)}
                    sx={{ fontSize: 9, height: 16, mt: 0.3, maxWidth: '100%', '& .MuiChip-label': { px: 0.5 } }}
                  />
                ))}
                {articles.length > 2 && (
                  <Typography sx={{ fontSize: 9, color: 'text.secondary' }}>+{articles.length - 2}</Typography>
                )}
              </Box>
            )
          })}
        </Box>
      </Paper>
    </Box>
  )
}
