import { createContext, useContext, useEffect, useState } from 'react'
import { api } from './api/client'

interface AuthUser {
  id: number
  username: string
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
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!token) {
      setLoading(false)
      return
    }
    api.get('/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { setUser(r.data); setLoading(false) })
      .catch(() => { localStorage.removeItem(TOKEN_KEY); setToken(null); setUser(null); setLoading(false) })
  }, [token])

  const login = async (username: string, password: string) => {
    const r = await api.post('/auth/login', { username, password })
    localStorage.setItem(TOKEN_KEY, r.data.token)
    setToken(r.data.token)
    setUser(r.data.user)
  }

  const register = async (username: string, password: string) => {
    const r = await api.post('/auth/register', { username, password })
    localStorage.setItem(TOKEN_KEY, r.data.token)
    setToken(r.data.token)
    setUser(r.data.user)
  }

  const logout = () => {
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
