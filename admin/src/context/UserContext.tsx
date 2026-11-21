/* eslint-disable react-refresh/only-export-components */
import React, { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import * as bookcarsTypes from ':bookcars-types'
import * as UserService from '@/services/UserService'

// Create context
export interface UserContextType {
  user: bookcarsTypes.User | null
  setUser: React.Dispatch<React.SetStateAction<bookcarsTypes.User | null>>
  userLoaded: boolean
  setUserLoaded: React.Dispatch<React.SetStateAction<boolean>>
  unauthorized: boolean
  setUnauthorized: React.Dispatch<React.SetStateAction<boolean>>
}

const UserContext = createContext<UserContextType | null>(null)

// Create a provider
interface UserProviderProps {
  children: ReactNode
  refreshKey?: number
}

export const UserProvider: React.FC<UserProviderProps> = ({ children, refreshKey }) => {
  const [user, setUser] = useState<bookcarsTypes.User | null>(null)
  const [userLoaded, setUserLoaded] = useState(false)
  const [unauthorized, setUnauthorized] = useState(false)

  const value = useMemo(() => ({ user, setUser, userLoaded, setUserLoaded, unauthorized, setUnauthorized }), [user, userLoaded, unauthorized, setUnauthorized])

  const exit = useCallback(async () => {
    setUser(null)
    setUserLoaded(true)
    await UserService.signout(false)
  }, [])

  const checkUser = useCallback(async () => {
    setUserLoaded(false)

    const currentUser = UserService.getCurrentUser()
    if (!currentUser) {
      await exit()
      return
    }

    try {
      const status = await UserService.validateAccessToken()

      if (status === 200) {
        const _user = await UserService.getUser(currentUser._id)
        if (_user) {
          if (_user.blacklisted) {
            setUser(_user)
            setUnauthorized(true)
          } else {
            setUser(_user)
            setUnauthorized(false)
          }
        } else {
          await exit()
        }
      } else if (status === 401 || status === 403) {
        // Wave 1.7 (P1-1) — only a 401/403 means the session is dead.
        // Any other non-200 status (e.g. a 5xx) is a server problem,
        // not a session problem: keep the session and let the next
        // navigation re-validate.
        await exit()
      } else {
        setUser(currentUser)
        setUnauthorized(false)
      }
    } catch (err) {
      // Wave 1.7 (P1-1) — the session is wiped only when the server
      // actually says the token is invalid (401/403). A network error
      // or 5xx keeps the session: the manager stays signed in through
      // a blip, and the next navigation re-validates. The existing
      // OfflineBanner (App.tsx) is the visible offline surface — no
      // new toast, so an outage does not spam one per validation.
      const status = (err as { response?: { status?: number } })?.response?.status
      if (status === 401 || status === 403) {
        await exit()
      } else {
        setUser(currentUser)
        setUnauthorized(false)
      }
    } finally {
      setUserLoaded(true)
    }
  }, [exit])

  // Ref to track the previous refreshKey
  const prevRefreshKey = useRef(refreshKey)

  useEffect(() => {
    // Check if refreshKey has actually changed
    if (prevRefreshKey.current !== refreshKey) {
      checkUser()
      prevRefreshKey.current = refreshKey // Update the ref to the current refreshKey
    }
  }, [refreshKey, checkUser])

  useEffect(() => {
    if (refreshKey === undefined) {
      checkUser()
    }
  }, [refreshKey, checkUser])

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>
}

// Create a custom hook to access context
export const useUserContext = () => useContext(UserContext)
