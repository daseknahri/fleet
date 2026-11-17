import React, { createContext, useContext, useState, useEffect } from 'react'
import * as bookcarsTypes from ':bookcars-types'
import * as SettingService from '@/services/SettingService'

interface SettingContextType {
  settings?: bookcarsTypes.Setting
  refresh: () => Promise<void>
}

const SettingContext = createContext<SettingContextType | undefined>(undefined)

export const SettingProvider = ({ children }: { children: React.ReactNode }) => {
  const [settings, setSettings] = useState<bookcarsTypes.Setting>()

  // Fallback to the model defaults so the anonymous search form still
  // renders if settings fail to load (e.g. API unreachable): the form
  // only needs these four numeric limits.
  const DEFAULT_SETTINGS: bookcarsTypes.Setting = {
    _id: '',
    minPickupHours: 1,
    minRentalHours: 1,
    minPickupDropoffHour: 0,
    maxPickupDropoffHour: 23,
  }

  const refresh = async () => {
    try {
      const _settings = await SettingService.getSettings()
      if (!_settings) {
        throw new Error('No settings returned from API')
      }
      setSettings(_settings)
    } catch (err) {
      console.error(err)
      setSettings(DEFAULT_SETTINGS)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  return (
    <SettingContext.Provider value={{ settings, refresh }}>
      {children}
    </SettingContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const useSetting = () => {
  const context = useContext(SettingContext)
  if (!context) {
    throw new Error('useSetting must be used within an SettingProvider')
  }
  return context
}
