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
  /**
   * F3 / W1 #18 — disable the Cancelled option: a paid/deposit booking
   * cannot be cancelled by a status change (the backend 400s
   * CANCEL_VIA_WORKFLOW) — it goes through the cancel workflow
   * instead. The parent passes the reason shown under the select.
   */
  disableCancelled?: boolean
  cancelDisabledReason?: string
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
  disableCancelled,
  cancelDisabledReason,
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
          {/* Wave 1.3 (S3) — the dropdown offers the manager vocabulary only:
              Pending / Deposit / Paid / Cancelled. Void (system placeholder),
              Reserved (legacy import) and PaidInFull (merged into Paid) are
              not staff choices, so they have no option here. A booking that
              already holds one of them still displays through renderValue. */}
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
            <MenuItem value={bookcarsTypes.BookingStatus.Pending} className="bs-s bs-s-pending">
              {commonStrings.BOOKING_STATUS_PENDING}
            </MenuItem>
            <MenuItem value={bookcarsTypes.BookingStatus.Deposit} className="bs-s bs-s-deposit" disabled={disablePaymentStatuses}>
              {commonStrings.BOOKING_STATUS_DEPOSIT}
            </MenuItem>
            <MenuItem value={bookcarsTypes.BookingStatus.Paid} className="bs-s bs-s-paid" disabled={disablePaymentStatuses}>
              {commonStrings.BOOKING_STATUS_PAID}
            </MenuItem>
            <MenuItem value={bookcarsTypes.BookingStatus.Cancelled} className="bs-s bs-s-cancelled" disabled={disableCancelled}>
              {commonStrings.BOOKING_STATUS_CANCELLED}
            </MenuItem>
          </Select>
          {disableCancelled && cancelDisabledReason && <FormHelperText>{cancelDisabledReason}</FormHelperText>}
          {required && showRequiredError && !value && <FormHelperText error>{commonStrings.REQUIRED}</FormHelperText>}
        </>
      )}
    </div>
  )
}

export default StatusList
