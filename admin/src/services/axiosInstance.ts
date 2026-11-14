import axios from 'axios'
import env from '@/config/env.config'

const axiosInstance = axios.create({ baseURL: env.API_HOST })

// GA-Q4-4 (#54): mutations require network — honest offline state, no
// silent queuing. When the browser reports offline, non-GET requests are
// rejected here, before anything is sent, and the OfflineBanner is told
// (via a window event) so it can show the localized reason. The banner
// owns the message because this module cannot import the lang strings
// itself (langHelper -> UserService -> this module would be circular).
// Reads go through untouched: the API is network-only in the service
// worker too, so a read either reaches the server or fails honestly.
axiosInstance.interceptors.request.use((config) => {
  const method = (config.method ?? 'get').toLowerCase()
  if (method !== 'get' && method !== 'head' && method !== 'options' && typeof navigator !== 'undefined' && navigator.onLine === false) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('ga:offline-mutation-blocked'))
    }
    return Promise.reject(Object.assign(new Error('OFFLINE_NO_NETWORK'), { code: 'OFFLINE_NO_NETWORK' }))
  }
  return config
})

export default axiosInstance
