/* eslint-disable react-refresh/only-export-components */
import React, { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import * as bookcarsTypes from ':bookcars-types'
import * as UserService from '@/services/UserService'
import { strings } from '@/lang/common'
import * as helper from '@/utils/helper'

// Create context
export interface UserContextType {
  user: bookcarsTypes.User | null
  setUser: React.Dispatch<React.SetStateAction<bookcarsTypes.User | null>>
  userLoaded: boolean
  setUserLoaded: React.Dispatch<React.SetStateAction<boolean>>
  unauthorized: boolean
  authOffline: boolean
  retryAuth: () => Promise<void>
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
  const [authOffline, setAuthOffline] = useState(false)

  const exit = useCallback(async () => {
    setUser(null)
    setUserLoaded(true)
    try { await UserService.signout(false, false) } catch { /* already signed out locally; the server call is best-effort */ }
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
        setAuthOffline(false)
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
        // R2-A10 - only 401/403 mean "signed out".
        await exit()
        helper.info(strings.SESSION_EXPIRED)
      } else {
        // R2-A10 - any other status is a connection problem: keep the session.
        setAuthOffline(true)
      }
    } catch (err) {
      if (UserService.isAuthError(err)) {
        await exit()
        helper.info(strings.SESSION_EXPIRED)
      } else {
        // R2-A10 - network blip, not a sign-out: keep the session, show Retry.
        setAuthOffline(true)
      }
    } finally {
      setUserLoaded(true)
    }
  }, [exit])

  const retryAuth = useCallback(async () => {
    setAuthOffline(false)
    await checkUser()
  }, [checkUser])

  const value = useMemo(() => ({ user, setUser, userLoaded, setUserLoaded, unauthorized, authOffline, retryAuth }), [user, userLoaded, unauthorized, authOffline, retryAuth])

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