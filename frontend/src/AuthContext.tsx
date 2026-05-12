import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { api } from './api/client'

interface AuthUser {
  id: number
  username: string
  role: 'admin' | 'user'
  created_at: string
}

interface AuthContextType {
  user: AuthUser | null
  token: string | null
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  register: (username: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  token: null,
  loading: true,
  login: async () => {},
  register: async () => {},
  logout: () => {},
})

export function useAuth() {
  return useContext(AuthContext)
}

const TOKEN_KEY = 'xhs_token'

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY))
  const [loading, setLoading] = useState(() => !!localStorage.getItem(TOKEN_KEY))
  const didLoginRef = useRef(false)

  useEffect(() => {
    const stored = localStorage.getItem(TOKEN_KEY)
    if (!stored) {
      setLoading(false)
      return
    }
    let cancelled = false
    api.get('/auth/me', { headers: { Authorization: `Bearer ${stored}` } })
      .then(r => {
        if (!cancelled && !didLoginRef.current) {
          setUser(r.data)
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled && !didLoginRef.current) {
          const current = localStorage.getItem(TOKEN_KEY)
          if (current === stored || !current) {
            localStorage.removeItem(TOKEN_KEY)
            setToken(null)
            setUser(null)
          }
          setLoading(false)
        }
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const handleForceLogout = () => {
      if (didLoginRef.current) return
      setToken(null)
      setUser(null)
      setLoading(false)
    }
    window.addEventListener('auth:logout', handleForceLogout)
    return () => window.removeEventListener('auth:logout', handleForceLogout)
  }, [])

  const login = async (username: string, password: string) => {
    didLoginRef.current = true
    const r = await api.post('/auth/login', { username, password })
    localStorage.setItem(TOKEN_KEY, r.data.token)
    setToken(r.data.token)
    setUser(r.data.user)
    setLoading(false)
  }

  const register = async (username: string, password: string) => {
    didLoginRef.current = true
    const r = await api.post('/auth/register', { username, password })
    localStorage.setItem(TOKEN_KEY, r.data.token)
    setToken(r.data.token)
    setUser(r.data.user)
    setLoading(false)
  }

  const logout = () => {
    didLoginRef.current = false
    localStorage.removeItem(TOKEN_KEY)
    setToken(null)
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  )
}
