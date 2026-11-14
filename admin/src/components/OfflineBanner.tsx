import React, { useEffect, useState } from 'react'
import { toast } from 'react-toastify'
import { strings } from '@/lang/offline'

// GA-Q4-4 (#54): honest offline state for the admin app. While the browser
// reports offline, a banner stays visible at the top of every admin page
// and mutations are blocked (the shared axios instance rejects non-GET
// requests and dispatches 'ga:offline-mutation-blocked'; this component
// owns the localized message because axiosInstance cannot import the lang
// strings itself — langHelper -> UserService -> axiosInstance would be a
// circular import). Nothing is queued and nothing is written offline: the
// user is told, in their own language, and retries after reconnecting.
const OfflineBanner = () => {
  const [online, setOnline] = useState(() => (typeof navigator !== 'undefined' ? navigator.onLine : true))

  useEffect(() => {
    const onOffline = () => setOnline(false)
    const onOnline = () => {
      setOnline(true)
      toast.info(strings.OFFLINE_BACK_ONLINE)
    }
    const onBlockedMutation = () => {
      toast.error(strings.OFFLINE_MUTATION_BLOCKED)
    }
    window.addEventListener('offline', onOffline)
    window.addEventListener('online', onOnline)
    window.addEventListener('ga:offline-mutation-blocked', onBlockedMutation)
    return () => {
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('ga:offline-mutation-blocked', onBlockedMutation)
    }
  }, [])

  if (online) {
    return null
  }

  return (
    <div
      role="alert"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 2000,
        backgroundColor: '#1a1a1a',
        color: '#fff',
        textAlign: 'center',
        padding: '8px 16px',
        fontSize: 14,
      }}
    >
      {strings.OFFLINE_BANNER}
    </div>
  )
}

export default OfflineBanner
