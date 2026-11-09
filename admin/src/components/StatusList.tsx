import React, { useState, useEffect, useId, CSSProperties } from 'react'
import {
  InputLabel,
  Select,
  MenuItem,
  SelectChangeEvent,
  TextFieldVariants,
  FormHelperText
} from '@mui/material'
import * as bookcarsTypes from ':bookcars-types'
import { strings as commonStrings } from '@/lang/common'
import * as helper from '@/utils/helper'

import '@/assets/css/status-list.css'

interface StatusListProps {
  value?: string
  label?: string
  required?: boolean
  variant?: TextFieldVariants
  disabled?: boolean
  disablePaymentStatuses?: boolean
  style?: CSSProperties
  onChange?: (value: bookcarsTypes.BookingStatus) => void
}

const StatusList = ({
  value: statusListValue,
  label,
  required,
  variant,
  disabled,
  disablePaymentStatuses,
  style,
  onChange
}: StatusListProps) => {
  const [value, setValue] = useState('')
  const [showRequiredError, setShowRequiredError] = useState(false)
  const labelId = useId()

  useEffect(() => {
    if (statusListValue && statusListValue !== value) {
      setValue(statusListValue)
    }
  }, [statusListValue, value])

  const handleChange = (e: SelectChangeEvent<string>) => {
    setValue(e.target.value)
    setShowRequiredError(false)

    if (onChange) {
      onChange(e.target.value as bookcarsTypes.BookingStatus)
    }
  }

  return (
    <div
      style={style || {}}
      onInvalidCapture={(e) => {
        e.preventDefault()
        if (required) {
          setShowRequiredError(true)
        }
      }}
    >
      {disabled ? (
        <span className={`bs-s-sv bs-s-${value}`} style={{ marginTop: 5 }}>
          {helper.getBookingStatus(value as bookcarsTypes.BookingStatus)}
        </span>
      ) : (
        <>
          <InputLabel id={labelId} className={required ? 'required' : ''}>{label}</InputLabel>
          <Select
            label={label}
            labelId={labelId}
            value={value}
            onChange={handleChange}
            variant={variant || 'standard'}
            required={required}
            fullWidth
            renderValue={(_value) => (
              <span className={`bs-s-sv bs-s-${_value.toLowerCase()}`}>
                {helper.getBookingStatus(_value as bookcarsTypes.BookingStatus)}
              </span>
            )}
          >
            <MenuItem value={bookcarsTypes.BookingStatus.Void} className="bs-s bs-s-void">
              {commonStrings.BOOKING_STATUS_VOID}
            </MenuItem>
            <MenuItem value={bookcarsTypes.BookingStatus.Pending} className="bs-s bs-s-pending">
              {commonStrings.BOOKING_STATUS_PENDING}
            </MenuItem>
            <MenuItem value={bookcarsTypes.BookingStatus.Deposit} className="bs-s bs-s-deposit" disabled={disablePaymentStatuses}>
              {commonStrings.BOOKING_STATUS_DEPOSIT}
            </MenuItem>
            <MenuItem value={bookcarsTypes.BookingStatus.Paid} className="bs-s bs-s-paid" disabled={disablePaymentStatuses}>
              {commonStrings.BOOKING_STATUS_PAID}
            </MenuItem>
            <MenuItem value={bookcarsTypes.BookingStatus.PaidInFull} className="bs-s bs-s-paidinfull" disabled={disablePaymentStatuses}>
              {commonStrings.BOOKING_STATUS_PAID_IN_FULL}
            </MenuItem>
            <MenuItem value={bookcarsTypes.BookingStatus.Reserved} className="bs-s bs-s-reserved">
              {commonStrings.BOOKING_STATUS_RESERVED}
            </MenuItem>
            <MenuItem value={bookcarsTypes.BookingStatus.Cancelled} className="bs-s bs-s-cancelled">
              {commonStrings.BOOKING_STATUS_CANCELLED}
            </MenuItem>
          </Select>
          {required && showRequiredError && !value && <FormHelperText error>{commonStrings.REQUIRED}</FormHelperText>}
        </>
      )}
    </div>
  )
}

export default StatusList
