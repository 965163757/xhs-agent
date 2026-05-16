import { lazy, Suspense, useEffect, useState } from 'react'
import { Routes, Route, NavLink, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { AppBar, Box, CircularProgress, IconButton, Stack, Toolbar, Tooltip, Typography } from '@mui/material'
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined'
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined'
import LogoutIcon from '@mui/icons-material/Logout'
import KeyboardDoubleArrowLeftIcon from '@mui/icons-material/KeyboardDoubleArrowLeft'
import KeyboardDoubleArrowRightIcon from '@mui/icons-material/KeyboardDoubleArrowRight'
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline'
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined'
import ViewModuleOutlinedIcon from '@mui/icons-material/ViewModuleOutlined'
import InsightsOutlinedIcon from '@mui/icons-material/InsightsOutlined'
import ChecklistOutlinedIcon from '@mui/icons-material/ChecklistOutlined'
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined'
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined'
import { Toaster } from 'sonner'
import { useThemeMode } from './ThemeContext'
import { useAuth } from './AuthContext'
import ChatPage from './pages/ChatPage'
import ArticlesPage from './pages/ArticlesPage'
import LoginPage from './pages/LoginPage'
import CommandPalette from './components/CommandPalette'
import OnboardingDialog from './components/OnboardingDialog'
import { navigateWithTransition } from './utils/navigation'

const ArticleDetailPage = lazy(() => import('./pages/ArticleDetailPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const TemplatesPage = lazy(() => import('./pages/TemplatesPage'))
const DiagnosePage = lazy(() => import('./pages/DiagnosePage'))
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage'))
const TasksPage = lazy(() => import('./pages/TasksPage'))
const AiImageLabPage = lazy(() => import('./pages/AiImageLabPage'))

const navItems = [
  { to: '/', label: '创作对话', role: 'Chat', icon: ChatBubbleOutlineIcon },
  { to: '/articles', label: '笔记库', role: 'Articles', icon: DescriptionOutlinedIcon },
  { to: '/templates', label: '模板库', role: 'Templates', icon: ViewModuleOutlinedIcon },
  { to: '/analytics', label: '数据', role: 'Analytics', icon: InsightsOutlinedIcon },
  { to: '/tasks', label: '任务中心', role: 'Trace', icon: ChecklistOutlinedIcon },
  { to: '/ai-image-lab', label: 'AI 图片', role: 'Tool', icon: ImageOutlinedIcon },
  { to: '/settings', label: '设置', role: 'Config', icon: SettingsOutlinedIcon },
]

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', height: '100vh' }}>
        <CircularProgress />
      </Box>
    )
  }
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

function activeFor(pathname: string, to: string) {
  if (to === '/') return pathname === '/'
  return pathname === to || pathname.startsWith(`${to}/`)
}

function routeLabel(pathname: string) {
  if (pathname.startsWith('/articles/') && pathname.endsWith('/diagnose')) return 'diagnose'
  if (pathname.startsWith('/articles/')) return 'article-detail'
  return navItems.find(item => activeFor(pathname, item.to))?.role.toLowerCase() || 'studio'
}

function StudioNav({ compact = false, collapsed = false }: { compact?: boolean; collapsed?: boolean }) {
  const location = useLocation()
  return (
    <Stack
      component="nav"
      spacing={0.2}
      sx={{
        px: compact ? 0 : 0,
        py: compact ? 0 : 1,
        minWidth: 0,
        flexDirection: compact ? 'row' : 'column',
        overflowX: compact ? 'auto' : 'visible',
      }}
    >
      {navItems.map(item => {
        const Icon = item.icon
        return (
          <NavLink key={item.to} to={item.to} end={item.to === '/'} style={{ textDecoration: 'none' }}>
            {({ isActive }) => {
              const active = isActive || activeFor(location.pathname, item.to)
              return (
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: collapsed ? 'center' : 'flex-start',
                    gap: collapsed ? 0 : 1.1,
                    minWidth: compact ? 'max-content' : 0,
                    px: compact ? 1.2 : collapsed ? 0.9 : 1.7,
                    py: compact ? 0.8 : 0.9,
                    borderLeft: compact ? 0 : '2px solid',
                    borderBottom: compact ? '2px solid' : 0,
                    borderColor: active ? 'primary.main' : 'transparent',
                    bgcolor: active ? 'background.default' : 'transparent',
                    color: active ? 'text.primary' : 'text.secondary',
                    fontWeight: active ? 700 : 500,
                    transition: 'background-color 180ms cubic-bezier(0.16,1,0.3,1), color 180ms ease, border-color 180ms ease',
                    '&:hover': { bgcolor: 'background.default', color: 'text.primary' },
                  }}
                >
                  <Icon sx={{ fontSize: 15 }} />
                  {!collapsed && (
                    <>
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography noWrap sx={{ fontSize: 13 }}>
                          {item.label}
                        </Typography>
                        {!compact && (
                          <Typography className="editorial-mono" noWrap sx={{ fontSize: 9, color: active ? 'primary.main' : 'text.disabled', lineHeight: 1.2 }}>
                            {item.role}
                          </Typography>
                        )}
                      </Box>
                      {!compact && active && <Box className="editorial-dot" sx={{ width: 5, height: 5 }} />}
                    </>
                  )}
                </Box>
              )
            }}
          </NavLink>
        )
      })}
    </Stack>
  )
}

export default function App() {
  const nav = useNavigate()
  const location = useLocation()
  const { mode, toggle } = useThemeMode()
  const { user, logout } = useAuth()
  const pageId = routeLabel(location.pathname)
  const [navCollapsed, setNavCollapsed] = useState(() => localStorage.getItem('xhs_global_nav_collapsed') === 'true')

  useEffect(() => {
    localStorage.setItem('xhs_global_nav_collapsed', navCollapsed ? 'true' : 'false')
  }, [navCollapsed])

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: number; conversationId?: number | null; target?: string }>).detail || {}
      const id = Number(detail.id || 0)
      if (!Number.isFinite(id) || id <= 0) return
      const target = detail.target || (() => {
        const qs = new URLSearchParams()
        if (detail.conversationId) qs.set('c', String(detail.conversationId))
        qs.set('chat', '1')
        qs.set('from', 'agent')
        return `/articles/${id}?${qs.toString()}`
      })()
      navigateWithTransition(nav, target)
    }
    window.addEventListener('xhs:open-article', handler)
    return () => window.removeEventListener('xhs:open-article', handler)
  }, [nav])

  useEffect(() => {
    try {
      const raw = localStorage.getItem('xhs_pending_open_article')
      if (!raw) return
      const pending = JSON.parse(raw) as { id?: number; target?: string; at?: number }
      const id = Number(pending.id || 0)
      if (!Number.isFinite(id) || id <= 0) return
      if (Date.now() - Number(pending.at || 0) > 30_000) return
      if (location.pathname !== `/articles/${id}` && pending.target) {
        navigateWithTransition(nav, pending.target)
      }
    } catch {
      /* ignore */
    }
  }, [location.pathname, nav])

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default', overflow: 'hidden' }}>
      <Toaster position="top-center" richColors closeButton theme={mode} />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={
          <ProtectedRoute>
            <>
              <AppBar position="sticky" elevation={0} className="editorial-live">
                <Toolbar sx={{ minHeight: 56, gap: 1.5, px: { xs: 1.5, md: 2 } }}>
                  <Stack
                    direction="row"
                    alignItems="center"
                    spacing={1}
                    sx={{ cursor: 'pointer', mr: { xs: 0.5, md: 2 }, minWidth: { md: 190 } }}
                    onClick={() => nav('/')}
                  >
                    <Box
                      sx={{
                        width: 28,
                        height: 28,
                        border: '1.5px solid',
                        borderColor: 'text.primary',
                        display: 'grid',
                        placeItems: 'center',
                        fontFamily: 'var(--mono)',
                        fontWeight: 800,
                        fontSize: 11,
                        color: 'primary.main',
                        bgcolor: 'background.default',
                      }}
                    >
                      书
                    </Box>
                    <Box sx={{ display: { xs: 'none', sm: 'block' }, minWidth: 0 }}>
                      <Typography sx={{ fontFamily: 'var(--serif)', fontSize: 16, fontWeight: 700, letterSpacing: -0.2, lineHeight: 1.1 }}>
                        创作工作室
                      </Typography>
                      <Typography className="editorial-mono" sx={{ fontSize: 8.5, color: 'text.disabled', lineHeight: 1.2 }}>
                        XHS-Agent
                      </Typography>
                    </Box>
                  </Stack>

                  <Box sx={{ display: { xs: 'flex', md: 'none' }, minWidth: 0, flex: 1 }}>
                    <StudioNav compact />
                  </Box>

                  <Box sx={{ display: { xs: 'none', md: 'block' }, flex: 1, minWidth: 0 }}>
                    <Typography className="editorial-mono" noWrap sx={{ fontSize: 10.5, color: 'text.disabled' }}>
                      xhs-agent / <Box component="span" sx={{ color: 'text.secondary' }}>{pageId}</Box>
                    </Typography>
                  </Box>

                  <Tooltip title={mode === 'light' ? '切换暗色校样' : '切换纸张模式'}>
                    <IconButton size="small" onClick={toggle}>
                      {mode === 'light' ? <DarkModeOutlinedIcon sx={{ fontSize: 18 }} /> : <LightModeOutlinedIcon sx={{ fontSize: 18 }} />}
                    </IconButton>
                  </Tooltip>

                  {user && (
                    <Stack direction="row" alignItems="center" spacing={0.7}>
                      <Box
                        sx={{
                          display: { xs: 'none', sm: 'grid' },
                          gridTemplateColumns: 'auto 1fr auto',
                          alignItems: 'center',
                          gap: 0.8,
                          px: 1,
                          py: 0.45,
                          border: '1px solid',
                          borderColor: 'divider',
                          bgcolor: 'background.paper',
                        }}
                      >
                        <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'success.main' }} />
                        <Typography noWrap sx={{ fontSize: 12, fontWeight: 600, maxWidth: 110 }}>
                          {user.username}
                        </Typography>
                        {user.role === 'admin' && (
                          <Typography className="editorial-mono" sx={{ fontSize: 8.5, color: 'primary.main' }}>
                            admin
                          </Typography>
                        )}
                      </Box>
                      <Tooltip title="退出登录">
                        <IconButton size="small" onClick={logout}>
                          <LogoutIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  )}
                </Toolbar>
              </AppBar>

              <Box sx={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
                <Box
                  sx={{
                    display: { xs: 'none', md: 'flex' },
                    width: navCollapsed ? 58 : 220,
                    flexShrink: 0,
                    borderRight: '1px solid',
                    borderColor: 'divider',
                    bgcolor: 'background.paper',
                    flexDirection: 'column',
                    transition: 'width .22s cubic-bezier(0.16,1,0.3,1)',
                  }}
                >
                  <Box sx={{ px: navCollapsed ? 0.75 : 2, py: 1.2, borderBottom: '1px solid', borderColor: 'divider' }}>
                    <Stack direction="row" alignItems="center" spacing={1}>
                      {!navCollapsed && (
                        <Box sx={{ minWidth: 0, flex: 1 }}>
                          <Typography className="editorial-mono" sx={{ fontSize: 9.5, color: 'text.disabled', mb: 0.8 }}>
                            navigation
                          </Typography>
                          <Typography sx={{ fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: 18 }}>
                            编辑工作流
                          </Typography>
                        </Box>
                      )}
                      <Tooltip title={navCollapsed ? '展开左侧栏' : '收起左侧栏'}>
                        <IconButton size="small" onClick={() => setNavCollapsed(v => !v)} sx={{ mx: navCollapsed ? 'auto' : 0 }}>
                          {navCollapsed ? <KeyboardDoubleArrowRightIcon sx={{ fontSize: 18 }} /> : <KeyboardDoubleArrowLeftIcon sx={{ fontSize: 18 }} />}
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  </Box>
                  <StudioNav collapsed={navCollapsed} />
                  {!navCollapsed && (
                    <Box sx={{ mt: 'auto', px: 2, py: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
                      <Typography className="editorial-mono" sx={{ fontSize: 9, color: 'text.disabled' }}>
                        editor-in-chief
                      </Typography>
                      <Typography noWrap sx={{ fontSize: 12.5, fontWeight: 700 }}>
                        {user?.username || 'editor'}
                      </Typography>
                    </Box>
                  )}
                </Box>

                <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto' }}>
                  <Suspense fallback={<Box sx={{ display: 'grid', placeItems: 'center', py: 10 }}><CircularProgress size={24} /></Box>}>
                    <Routes>
                      <Route path="/" element={<ChatPage />} />
                      <Route path="/articles" element={<ArticlesPage />} />
                      <Route path="/articles/:id" element={<ArticleDetailPage />} />
                      <Route path="/articles/:id/diagnose" element={<DiagnosePage />} />
                      <Route path="/templates" element={<TemplatesPage />} />
                      <Route path="/analytics" element={<AnalyticsPage />} />
                      <Route path="/tasks" element={<TasksPage />} />
                      <Route path="/ai-image-lab" element={<AiImageLabPage />} />
                      <Route path="/settings" element={<SettingsPage />} />
                      <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                  </Suspense>
                </Box>
              </Box>
              <CommandPalette />
              <OnboardingDialog />
            </>
          </ProtectedRoute>
        } />
      </Routes>
    </Box>
  )
}
