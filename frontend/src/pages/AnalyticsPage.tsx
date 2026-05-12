import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Box, Chip, Paper, Stack, Typography } from '@mui/material'
import ReactECharts from 'echarts-for-react'
import { getCalendar, getStats } from '../api/client'

interface Stats {
  total: number
  by_status: Record<string, number>
  scored_count: number
  avg_score: number | null
  top_tags: Array<{ tag: string; count: number }>
}

type CalendarData = Record<string, Array<{ id: number; title: string; status: string }>>

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

  const tagChartOption = stats ? {
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: stats.top_tags.map(t => t.tag),
      axisLabel: { rotate: 30, fontSize: 11 },
    },
    yAxis: { type: 'value' },
    series: [{
      type: 'bar',
      data: stats.top_tags.map(t => t.count),
      itemStyle: { color: '#FF2741', borderRadius: [4, 4, 0, 0] },
    }],
    grid: { left: 40, right: 20, top: 20, bottom: 60 },
  } : null

  const today = new Date()
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()
  const firstDayOfWeek = new Date(today.getFullYear(), today.getMonth(), 1).getDay()
  const monthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 1100, mx: 'auto' }}>
      <Typography sx={{ fontSize: 26, fontWeight: 600, letterSpacing: -0.3, mb: 3 }}>
        数据概览
      </Typography>

      {/* Stats cards */}
      {stats && (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: 2, mb: 4 }}>
          <Paper sx={{ p: 2.5, textAlign: 'center' }}>
            <Typography sx={{ fontSize: 32, fontWeight: 700, color: 'primary.main' }}>{stats.total}</Typography>
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>总笔记数</Typography>
          </Paper>
          <Paper sx={{ p: 2.5, textAlign: 'center' }}>
            <Typography sx={{ fontSize: 32, fontWeight: 700, color: 'success.main' }}>
              {stats.by_status['published'] || 0}
            </Typography>
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>已发布</Typography>
          </Paper>
          <Paper sx={{ p: 2.5, textAlign: 'center' }}>
            <Typography sx={{ fontSize: 32, fontWeight: 700, color: 'warning.main' }}>
              {stats.by_status['draft'] || 0}
            </Typography>
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>草稿</Typography>
          </Paper>
          <Paper sx={{ p: 2.5, textAlign: 'center' }}>
            <Typography sx={{ fontSize: 32, fontWeight: 700 }}>
              {stats.avg_score ?? '—'}
            </Typography>
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>平均评分</Typography>
          </Paper>
        </Box>
      )}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 3, mb: 4 }}>
        {/* Tag distribution */}
        {tagChartOption && (
          <Paper sx={{ p: 2.5 }}>
            <Typography sx={{ fontSize: 15, fontWeight: 600, mb: 1.5 }}>标签分布 Top 15</Typography>
            <ReactECharts option={tagChartOption} style={{ height: 240 }} />
          </Paper>
        )}

        {/* Status pie */}
        {stats && (
          <Paper sx={{ p: 2.5 }}>
            <Typography sx={{ fontSize: 15, fontWeight: 600, mb: 1.5 }}>状态分布</Typography>
            <ReactECharts
              style={{ height: 240 }}
              option={{
                tooltip: { trigger: 'item' },
                series: [{
                  type: 'pie',
                  radius: ['40%', '70%'],
                  data: Object.entries(stats.by_status).map(([k, v]) => ({
                    name: statusLabel[k] || k,
                    value: v,
                  })),
                  itemStyle: { borderRadius: 6 },
                  label: { fontSize: 12 },
                }],
                color: ['#FF2741', '#16A34A', '#FFB800', '#8A8A8F'],
              }}
            />
          </Paper>
        )}
      </Box>

      {/* Content calendar */}
      <Paper sx={{ p: 2.5 }}>
        <Typography sx={{ fontSize: 15, fontWeight: 600, mb: 2 }}>
          内容日历 · {today.getFullYear()}年{today.getMonth() + 1}月
        </Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.5 }}>
          {['日', '一', '二', '三', '四', '五', '六'].map(d => (
            <Typography key={d} sx={{ textAlign: 'center', fontSize: 12, color: 'text.secondary', py: 0.5 }}>
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
            const isToday = day === today.getDate()
            return (
              <Box
                key={day}
                sx={{
                  minHeight: { xs: 40, md: 64 },
                  border: '1px solid',
                  borderColor: isToday ? 'primary.main' : 'divider',
                  borderRadius: 1.5,
                  p: 0.5,
                  cursor: articles.length ? 'pointer' : 'default',
                  bgcolor: isToday ? 'rgba(255,39,65,0.04)' : 'transparent',
                  '&:hover': articles.length ? { bgcolor: 'action.hover' } : {},
                }}
              >
                <Typography sx={{ fontSize: 11, fontWeight: isToday ? 700 : 400, color: isToday ? 'primary.main' : 'text.secondary' }}>
                  {day}
                </Typography>
                {articles.slice(0, 2).map(a => (
                  <Chip
                    key={a.id}
                    label={a.title?.slice(0, 6) || `#${a.id}`}
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
