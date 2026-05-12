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

function StatCard({ value, label, color }: { value: string | number; label: string; color?: string }) {
  return (
    <Paper
      sx={{
        p: 2.5,
        textAlign: 'center',
        position: 'relative',
        overflow: 'hidden',
        '&:hover': { transform: 'translateY(-2px)', boxShadow: '0 8px 24px rgba(0,0,0,0.06)' },
        transition: 'all 0.25s cubic-bezier(0.4,0,0.2,1)',
      }}
    >
      <Typography sx={{ fontSize: 32, fontWeight: 800, color: color || 'text.primary', letterSpacing: -1 }}>
        {value}
      </Typography>
      <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mt: 0.3, fontWeight: 500 }}>
        {label}
      </Typography>
    </Paper>
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

  const tagChartOption = stats ? {
    tooltip: { trigger: 'axis', backgroundColor: '#1A1A1A', borderColor: 'transparent', textStyle: { color: '#fff', fontSize: 12 } },
    xAxis: {
      type: 'category',
      data: stats.top_tags.map(t => t.tag),
      axisLabel: { rotate: 30, fontSize: 11, color: '#8C8C8C' },
      axisLine: { lineStyle: { color: 'rgba(0,0,0,0.06)' } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      axisLabel: { fontSize: 11, color: '#8C8C8C' },
      splitLine: { lineStyle: { color: 'rgba(0,0,0,0.04)' } },
      axisLine: { show: false },
    },
    series: [{
      type: 'bar',
      data: stats.top_tags.map(t => t.count),
      itemStyle: {
        borderRadius: [6, 6, 0, 0],
        color: {
          type: 'linear',
          x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: '#FF2442' },
            { offset: 1, color: '#FF7A00' },
          ],
        },
      },
      barWidth: '60%',
    }],
    grid: { left: 40, right: 20, top: 20, bottom: 60 },
  } : null

  const today = new Date()
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()
  const firstDayOfWeek = new Date(today.getFullYear(), today.getMonth(), 1).getDay()
  const monthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 1100, mx: 'auto' }}>
      <Stack spacing={0.3} sx={{ mb: 3.5 }}>
        <Typography sx={{ fontSize: 24, fontWeight: 800, letterSpacing: -0.5 }}>
          数据概览
        </Typography>
        <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
          创作数据一目了然
        </Typography>
      </Stack>

      {/* Stats cards */}
      {stats && (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: 2, mb: 4 }}>
          <StatCard value={stats.total} label="总笔记数" color="#FF2442" />
          <StatCard value={stats.by_status['published'] || 0} label="已发布" color="#16A34A" />
          <StatCard value={stats.by_status['draft'] || 0} label="草稿" color="#D97706" />
          <StatCard value={stats.avg_score ?? '—'} label="平均评分" />
        </Box>
      )}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2.5, mb: 4 }}>
        {/* Tag distribution */}
        {tagChartOption && (
          <Paper sx={{ p: 2.5 }}>
            <Typography sx={{ fontSize: 14, fontWeight: 600, mb: 1.5 }}>标签分布 Top 15</Typography>
            <ReactECharts option={tagChartOption} style={{ height: 240 }} />
          </Paper>
        )}

        {/* Status pie */}
        {stats && (
          <Paper sx={{ p: 2.5 }}>
            <Typography sx={{ fontSize: 14, fontWeight: 600, mb: 1.5 }}>状态分布</Typography>
            <ReactECharts
              style={{ height: 240 }}
              option={{
                tooltip: { trigger: 'item', backgroundColor: '#1A1A1A', borderColor: 'transparent', textStyle: { color: '#fff', fontSize: 12 } },
                series: [{
                  type: 'pie',
                  radius: ['42%', '72%'],
                  data: Object.entries(stats.by_status).map(([k, v]) => ({
                    name: statusLabel[k] || k,
                    value: v,
                  })),
                  itemStyle: { borderRadius: 8, borderColor: '#fff', borderWidth: 3 },
                  label: { fontSize: 12, color: '#6B6B6B' },
                  emphasis: { itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0,0,0,0.1)' } },
                }],
                color: ['#FF2442', '#16A34A', '#FFB800', '#8C8C8C'],
              }}
            />
          </Paper>
        )}
      </Box>

      {/* Content calendar */}
      <Paper sx={{ p: 2.5 }}>
        <Typography sx={{ fontSize: 14, fontWeight: 600, mb: 2 }}>
          内容日历 · {today.getFullYear()}年{today.getMonth() + 1}月
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
            const isToday = day === today.getDate()
            return (
              <Box
                key={day}
                sx={{
                  minHeight: { xs: 40, md: 64 },
                  border: '1px solid',
                  borderColor: isToday ? 'primary.main' : 'divider',
                  borderRadius: 2,
                  p: 0.5,
                  cursor: articles.length ? 'pointer' : 'default',
                  bgcolor: isToday ? 'rgba(255,36,66,0.03)' : 'transparent',
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
