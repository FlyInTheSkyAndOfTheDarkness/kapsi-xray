import { createContext, useContext, useEffect, useState } from 'react'
import { API, getToken, setToken } from '../lib/api.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const token = getToken()
    if (!token) {
      setReady(true)
      return
    }
    API.me()
      .then((r) => setUser(r.user))
      .catch(() => setToken(null))
      .finally(() => setReady(true))
  }, [])

  const login = async (email, password) => {
    const r = await API.login(email, password)
    setToken(r.token)
    setUser(r.user)
  }
  const register = async (email, password) => {
    const r = await API.register(email, password)
    setToken(r.token)
    setUser(r.user)
  }
  const logout = () => {
    setToken(null)
    setUser(null)
  }

  return <AuthContext.Provider value={{ user, ready, login, register, logout }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
