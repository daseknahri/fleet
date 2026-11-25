import React, { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '@mui/material'
import { DirectionsCar as CarIcon } from '@mui/icons-material'
import { formatDateTimeCasablanca } from '@/utils/dateHelper'
import * as bookcarsTypes from ':bookcars-types'
import * as bookcarsHelper from ':bookcars-helper'
import * as helper from '@/utils/helper'
import * as BookingService from '@/services/BookingService'
import * as InvoiceService from '@/services/InvoiceService'
import * as UserService from '@/services/UserService'
import * as PaymentService from '@/services/PaymentService'
import { strings } from '@/lang/checkout-status'
import { strings as masterStrings } from '@/lang/master'
import { strings as commonStrings } from '@/lang/common'
import { strings as checkoutStrings } from '@/lang/checkout'
import Toast from '@/components/Toast'
import Error from '@/components/Error'
import Progress from '@/components/Progress'

import '@/assets/css/checkout-status.css'

interface CheckoutStatusProps {
  bookingId: string,
  sessionId?: string,
  payLater?: boolean,
  language: string,
  status: 'success' | 'error'
  className?: string
}

const CheckoutStatus = (
  {
    bookingId,
    sessionId,
    payLater,
    language,
    status,
    className,
  }: CheckoutStatusProps
) => {
  const [booking, setBooking] = useState<bookcarsTypes.Booking>()
  const [invoice, setInvoice] = useState<InvoiceService.CustomerInvoiceSummary | null>()
  const [price, setPrice] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const { sessionId: sessionIdFromUrl } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const [sessionIdMismatch, setSessionIdMismatch] = useState(false)

  useEffect(() => {
    const init = async () => {
      // If accessed via a route with :sessionId, verify matching URL param
      if (sessionIdFromUrl && sessionId !== sessionIdFromUrl) {
        setSessionIdMismatch(true)
        setLoading(false)
        return
      }

      // Pass sessionId to getBooking so backend verifyTokenOptional approves the unauthenticated request
      try {
        const _booking = await BookingService.getBooking(bookingId, sessionId)
        setBooking(_booking)
        setPrice(await PaymentService.convertPrice(_booking.price!))
        // R2-A06 - invoice summary, only for a signed-in customer (a guest
        // has no session; the invoice becomes available after activation
        // via the Booking page). 401/403/204 -> null, render nothing.
        if (UserService.getCurrentUser()) {
          InvoiceService.getByBooking(bookingId).then(setInvoice).catch(() => setInvoice(null))
        }
      } catch (err) {
        helper.error(err)
        setError(true)
      } finally {
        setLoading(false)
      }
    }

    if (bookingId) {
      init()
    }
  }, [bookingId, sessionId, sessionIdFromUrl])

  // R2-A15 - resend the activation email for a guest booking, the
  // exact pattern Layout.tsx already uses for the validate-email wall.
  const handleResendActivation = async (e: React.MouseEvent<HTMLElement>) => {
    e.preventDefault()
    try {
      const driverEmail = (booking as unknown as Record<string, unknown>)?.driverEmail as string | undefined
      if (!driverEmail) {
        return
      }
      const status = await UserService.resendLink({ email: driverEmail })
      if (status === 200) {
        helper.info(masterStrings.VALIDATION_EMAIL_SENT)
      } else {
        helper.error(null, masterStrings.VALIDATION_EMAIL_ERROR)
      }
    } catch (err) {
      helper.error(err, masterStrings.VALIDATION_EMAIL_ERROR)
    }
  }

  if (loading) {
    return <Progress />
  }

  if (error) {
    return <Error message={commonStrings.GENERIC_ERROR} />
  }

  if (sessionIdMismatch) {
    return (
      <div className={`checkout-status ${className || ''}`}>
        <div className="session-id-mismatch">
          <Error message={strings.SESSION_ID_MISMATCH} />
        </div>
      </div>
    )
  }

  const days = (booking && bookcarsHelper.days(new Date(booking.from), new Date(booking.to))) || 0
  const success = status === 'success'

  return booking && (
    <div className={`checkout-status ${className || ''}`}>
      <Toast
        title={strings.CONGRATULATIONS}
        text={success
          ? payLater ? strings.SUCCESS_PAY_LATER : strings.SUCCESS
          : strings.ERROR}
        status={status}
      />

      {success && (
        <div className="details">
          <div className="status-details-container">
            <div className="status-info">
              <CarIcon />
              <span>{checkoutStrings.BOOKING_DETAILS}</span>
            </div>
            <div className="status-details">
              <div className="status-detail">
                <span className="status-detail-title">{strings.REFERENCE}</span>
                <div className="status-detail-value">
                  <span>{booking.reference}</span>
                </div>
              </div>
              <div className="status-detail">
                <span className="status-detail-title">{checkoutStrings.CAR}</span>
                <div className="status-detail-value">
                  <span>{(booking.car as bookcarsTypes.Car).name}</span>
                </div>
              </div>
              <div className="status-detail">
                <span className="status-detail-title">{checkoutStrings.DAYS}</span>
                <div className="status-detail-value">
                  {`${helper.getDaysShort(days)} (${formatDateTimeCasablanca(booking.from)} (${commonStrings.TIMEZONE_MOROCCO}) - ${formatDateTimeCasablanca(booking.to)} (${commonStrings.TIMEZONE_MOROCCO}))`}
                </div>
              </div>
              <div className="status-detail">
                <span className="status-detail-title">{commonStrings.PICK_UP_LOCATION}</span>
                <div className="status-detail-value">{(booking.pickupLocation as bookcarsTypes.Location).name}</div>
              </div>
              <div className="status-detail">
                <span className="status-detail-title">{commonStrings.DROP_OFF_LOCATION}</span>
                <div className="status-detail-value">{(booking.dropOffLocation as bookcarsTypes.Location).name}</div>
              </div>
              <div className="status-detail">
                <span className="status-detail-title">{checkoutStrings.COST}</span>
                <div className="status-detail-value status-price">{bookcarsHelper.formatPrice(price, commonStrings.CURRENCY, language)}</div>
              </div>
              {payLater && booking.expireAt && (
                <div className="status-detail">
                  <span className="status-detail-title">{strings.HOLD_EXPIRES}</span>
                  <div className="status-detail-value">
                    {`${formatDateTimeCasablanca(booking.expireAt)} (${commonStrings.TIMEZONE_MOROCCO})`}
                  </div>
                </div>
              )}
              {invoice && invoice.status === 'Issued' && (
                <div className="status-detail">
                  <span className="status-detail-title">{strings.INVOICE_VIEW}</span>
                  <div className="status-detail-value">
                    <Button variant="text" onClick={() => InvoiceService.downloadPdf(invoice.id, `invoice-${invoice.number || invoice.id}.pdf`)}>{strings.INVOICE_VIEW}</Button>
                  </div>
                </div>
              )}
              {invoice && invoice.status === 'Draft' && (
                <div className="status-detail">
                  <div className="status-detail-value">{strings.INVOICE_PENDING}</div>
                </div>
              )}
            </div>
          </div>

          {success && (booking as unknown as Record<string, unknown>).driverVerified === false && (
            <div className="activation-notice">
              <p>{strings.ACTIVATE_ACCOUNT_NOTICE}</p>
              <p>
                <Button variant="outlined" onClick={handleResendActivation}>{strings.RESEND_ACTIVATION}</Button>
                <Button variant="text" onClick={() => navigate('/booking-lookup')}>{strings.FIND_BOOKING}</Button>
              </p>
            </div>
          )}

          <div className="side-panel">
            <h1>{strings.STATUS_TITLE}</h1>
            <p>{strings.STATUS_MESSAGE}</p>
          </div>
        </div>
      )}
    </div>
  )
}

export default CheckoutStatus
