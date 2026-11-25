import React, { useState } from 'react'
import * as bookcarsTypes from ':bookcars-types'
import * as bookcarsHelper from ':bookcars-helper'
import Layout from '@/components/Layout'
import env from '@/config/env.config'
import * as helper from '@/utils/helper'
import BookingList from '@/components/BookingList'
import SupplierFilter from '@/components/SupplierFilter'
import StatusFilter from '@/components/StatusFilter'
import BookingFilter from '@/components/BookingFilter'
import { strings as headerStrings } from '@/lang/header'
import Progress from '@/components/Progress'
import * as SupplierService from '@/services/SupplierService'
import * as UserService from '@/services/UserService'
import { strings } from '@/lang/bookings'

import '@/assets/css/bookings.css'

const Bookings = () => {
  const [user, setUser] = useState<bookcarsTypes.User>()
  const [balance, setBalance] = useState<{ currency: string, outstanding: number, overdue: number, depositHeld: number, bookings: number }>()
  const [allSuppliers, setAllSuppliers] = useState<bookcarsTypes.User[]>([])
  const [suppliers, setSuppliers] = useState<string[]>()
  const [statuses, setStatuses] = useState(helper.getBookingStatuses().map((status) => status.value))
  const [filter, setFilter] = useState<bookcarsTypes.Filter | null>()
  const [loadingSuppliers, setLoadingSuppliers] = useState(true)
  // const [loadingPage, setLoadingPage] = useState(true)

  const handleSupplierFilterChange = (_suppliers: string[]) => {
    setSuppliers(_suppliers)
  }

  const handleStatusFilterChange = (_statuses: bookcarsTypes.BookingStatus[]) => {
    setStatuses(_statuses)
  }

  const handleBookingFilterSubmit = (_filter: bookcarsTypes.Filter | null) => {
    setFilter(_filter)
  }

  const onLoad = async (_user?: bookcarsTypes.User) => {
    setUser(_user)
    if (_user?._id) {
      try {
        setBalance(await UserService.getClientBalance(_user._id))
      } catch {
        // Balance banner is best-effort; the list must load regardless.
      }
    }
    setLoadingSuppliers(true)

    const _allSuppliers = await SupplierService.getAllSuppliers()
    const _suppliers = bookcarsHelper.flattenSuppliers(_allSuppliers)
    setAllSuppliers(_allSuppliers)
    setSuppliers(_suppliers)
    setLoadingSuppliers(false)
  }

  return (
    <>
      <Layout onLoad={onLoad} strict>
        {user && (
          <div className="bookings">
            <h1 className="sr-only">{headerStrings.BOOKINGS}</h1>
            {balance && balance.outstanding > 0 && (
              <div className="bookings__balance">
                {strings.BALANCE_OUTSTANDING.replace('{count}', String(balance.bookings)).replace('{amount}', String(balance.outstanding)).replace('{currency}', balance.currency)}
                {balance.overdue > 0 && ` ${strings.BALANCE_OVERDUE.replace('{amount}', String(balance.overdue)).replace('{currency}', balance.currency)}`}
              </div>
            )}
            <div className="col-1">
              <div>
                <SupplierFilter suppliers={allSuppliers} onChange={handleSupplierFilterChange} className="cl-supplier-filter" />
                <StatusFilter onChange={handleStatusFilterChange} className="cl-status-filter" />
                <BookingFilter onSubmit={handleBookingFilterSubmit} language={(user && user.language) || env.DEFAULT_LANGUAGE} className="cl-booking-filter" collapse={!env.isMobile} />
              </div>
            </div>
            <div className="col-2">
              <BookingList
                user={user}
                language={user.language}
                suppliers={suppliers}
                statuses={statuses}
                filter={filter}
                loading={loadingSuppliers}
                hideDates={env.isMobile}
                checkboxSelection={false}
                // onLoad={() => setLoadingPage(false)}
                hideSupplierColumn={env.HIDE_SUPPLIERS}
              />
            </div>
          </div>
        )}
      </Layout>

      {loadingSuppliers && <Progress />}
    </>
  )
}

export default Bookings
