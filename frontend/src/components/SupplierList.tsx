import React, { useEffect, useState } from 'react'
import * as bookcarsTypes from ':bookcars-types'
import * as bookcarsHelper from ':bookcars-helper'
import SafeImage from '@/components/SafeImage'
import env from '@/config/env.config'
import * as SupplierService from '@/services/SupplierService'
import { strings as commonStrings } from '@/lang/common'
import Progress from '@/components/Progress'

import '@/assets/css/supplier-list.css'

const SupplierList = () => {
  const [suppliers, setSuppliers] = useState<bookcarsTypes.User[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetch = async () => {
      try {
        const _suppliers = await SupplierService.getAllSuppliers()
        setSuppliers(_suppliers)
      } finally {
        setLoading(false)
      }
    }

    fetch()
  }, [])

  return (
    <div className="supplier-list">
      {loading ? (
        <Progress />
      ) : suppliers.length === 0 ? (
        <div style={{ width: '100%', textAlign: 'center', marginTop: 15, color: '#717171' }}>{commonStrings.NO_SUPPLIERS}</div>
      ) : (
        suppliers.map((supplier) => (
          <div key={supplier._id} className="supplier" title={supplier.fullName}>
            <div className="img">
              <SafeImage src={bookcarsHelper.joinURL(env.CDN_USERS, supplier.avatar)} alt={supplier.fullName} />
            </div>
            <div className="name">{supplier.fullName}</div>
          </div>
        ))
      )}
    </div>
  )
}

export default SupplierList
