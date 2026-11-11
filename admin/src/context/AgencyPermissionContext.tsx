/* eslint-disable react-refresh/only-export-components */
import React, { ReactNode, createContext, useContext, useEffect, useMemo, useState } from 'react'
import * as bookcarsTypes from ':bookcars-types'
import * as AgencyMembershipService from '@/services/AgencyMembershipService'
import { useUserContext } from './UserContext'

// Permission names, mirroring the backend AgencyPermission enum values
// (backend/src/utils/agencyAuthorization.ts). The effective permission list
// for the signed-in user comes from GET /api/agency-memberships/me, computed
// by the backend from its own role matrix (H-038) — the UI never
// re-implements the matrix, it only names the permissions it gates on.
export const AgencyPermission = {
  ReadAgencyProfile: 'readAgencyProfile',
  ManageAgencyProfile: 'manageAgencyProfile',
  ReadBookings: 'readBookings',
  ManageBookings: 'manageBookings',
  ReadFleet: 'readFleet',
  ManageFleet: 'manageFleet',
  ReadLocations: 'readLocations',
  ManageLocations: 'manageLocations',
  ReadClients: 'readClients',
  ManageClients: 'manageClients',
  ReadPrivateDocuments: 'readPrivateDocuments',
  ManagePrivateDocuments: 'managePrivateDocuments',
  ReadExpenses: 'readExpenses',
  ManageExpenses: 'manageExpenses',
  ReadPayments: 'readPayments',
  RecordPayments: 'recordPayments',
  ReadCash: 'readCash',
  ManageCash: 'manageCash',
  RecordCash: 'recordCash',
  ReadInvoices: 'readInvoices',
  ManageInvoices: 'manageInvoices',
  DecideInvoices: 'decideInvoices',
  ReadAgents: 'readAgents',
  ManageAgents: 'manageAgents',
  ReadReminders: 'readReminders',
  ManageReminders: 'manageReminders',
} as const

export type AgencyPermissionName = (typeof AgencyPermission)[keyof typeof AgencyPermission]

const ALL_PERMISSIONS: string[] = Object.values(AgencyPermission)

export interface AgencyPermissionContextType {
  role: bookcarsTypes.AgencyRole | null
  supplier: string | null
  permissions: string[]
  loaded: boolean
  can: (permission: AgencyPermissionName) => boolean
}

const AgencyPermissionContext = createContext<AgencyPermissionContextType | null>(null)

interface AgencyPermissionProviderProps {
  children: ReactNode
}

export const AgencyPermissionProvider: React.FC<AgencyPermissionProviderProps> = ({ children }) => {
  const userContext = useUserContext()
  const user = userContext?.user
  const userId = user?._id
  const userType = user?.type

  const [role, setRole] = useState<bookcarsTypes.AgencyRole | null>(null)
  const [supplier, setSupplier] = useState<string | null>(null)
  const [permissions, setPermissions] = useState<string[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false

    if (!userId || !userType) {
      setRole(null)
      setSupplier(null)
      setPermissions([])
      setLoaded(false)
      return undefined
    }

    if (userType === bookcarsTypes.UserType.User) {
      setRole(null)
      setSupplier(null)
      setPermissions([])
      setLoaded(true)
      return undefined
    }

    setLoaded(false)
    AgencyMembershipService.getMine()
      .then((mine) => {
        if (cancelled) {
          return
        }
        setRole(mine.role)
        setSupplier(mine.supplier)
        setPermissions(mine.permissions || [])
        setLoaded(true)
      })
      .catch(() => {
        if (cancelled) {
          return
        }
        // Fallback mirrors the backend's own bypass rules: platform admins
        // and agency owners hold every permission; for staff the backend
        // denies what the role lacks, so offer nothing rather than a dead
        // action.
        const fallback = userType === bookcarsTypes.UserType.Admin || userType === bookcarsTypes.UserType.Supplier
          ? ALL_PERMISSIONS
          : []
        setRole(userType === bookcarsTypes.UserType.Staff ? null : bookcarsTypes.AgencyRole.Owner)
        setSupplier(userType === bookcarsTypes.UserType.Supplier ? userId : null)
        setPermissions(fallback)
        setLoaded(true)
      })

    return () => {
      cancelled = true
    }
  }, [userId, userType])

  const value = useMemo<AgencyPermissionContextType>(() => ({
    role,
    supplier,
    permissions,
    loaded,
    can: (permission: AgencyPermissionName) => permissions.includes(permission),
  }), [role, supplier, permissions, loaded])

  return <AgencyPermissionContext.Provider value={value}>{children}</AgencyPermissionContext.Provider>
}

export const useAgencyPermissions = () => useContext(AgencyPermissionContext)
