import React from 'react'
import {
  CheckCircle as CheckIcon,
  RemoveCircle as VoidIcon,
  PauseCircle as PendingIcon,
  Cancel as CancelledIcon,
} from '@mui/icons-material'
import * as bookcarsTypes from ':bookcars-types'
import * as helper from '@/utils/helper'
import { strings as commonStrings } from '@/lang/common'

import '@/assets/css/booking-status.css'

interface BookingStatusProps {
  value: bookcarsTypes.BookingStatus
  showIcon?: boolean,
  /** Wave 1.6 — the rent is paid but the refundable deposit is still
   * outstanding: show "Rent paid — deposit due" instead of plain "Paid".
   * Only applies to Paid (PaidInFull means the deposit is in). */
  depositDue?: boolean,
  /** F-04 — the contract lifecycle is Completed: show "Completed" instead of the payment status. */
  completed?: boolean,
  onClick?: (e: React.MouseEvent<HTMLElement>) => void
}

const getIcon = (value: bookcarsTypes.BookingStatus) => {
  if ([
    bookcarsTypes.BookingStatus.Deposit,
    bookcarsTypes.BookingStatus.Reserved,
    bookcarsTypes.BookingStatus.Paid,
    bookcarsTypes.BookingStatus.PaidInFull,
  ].includes(value)) {
    return <CheckIcon className={`bs-icon bs-icon-${value?.toLowerCase()}`} />
  }

  if (value === bookcarsTypes.BookingStatus.Void) {
    return <VoidIcon className="bs-icon bs-icon-void" />
  }

  if (value === bookcarsTypes.BookingStatus.Pending) {
    return <PendingIcon className="bs-icon bs-icon-pending" />
  }

  return <CancelledIcon className="bs-icon bs-icon-cancelled" />
}

const BookingStatus = ({
  showIcon,
  onClick,
  value,
  depositDue,
  completed
}: BookingStatusProps) => (
  <div
    className="booking-status"
    onClick={(e) => {
      if (onClick) {
        onClick(e)
      }
    }}
    role="presentation"
  >
    {showIcon && getIcon(value)}
    <span className={`bs bs-${value?.toLowerCase()}`}>{completed ? commonStrings.BOOKING_COMPLETED : depositDue && value === bookcarsTypes.BookingStatus.Paid ? commonStrings.BOOKING_STATUS_PAID_DEPOSIT_DUE : helper.getBookingStatus(value)}</span>
  </div>
)

export default BookingStatus
