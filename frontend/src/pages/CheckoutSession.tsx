import React, { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '@mui/material'
import { strings } from '@/lang/checkout'
import { strings as checkoutStatusStrings } from '@/lang/checkout-status'
import { strings as commonStrings } from '@/lang/common'
import Layout from '@/components/Layout'
import NoMatch from './NoMatch'
import * as StripeService from '@/services/StripeService'
import * as BookingService from '@/services/BookingService'
import * as UserService from '@/services/UserService'
import Info from './Info'
import Error from '@/components/Error'
import CheckoutStatus from '@/components/CheckoutStatus'

import '@/assets/css/checkout-session.css'

const CheckoutSession = () => {
  const { sessionId } = useParams()
  const navigate = useNavigate()
  const [bookingId, setBookingId] = useState('')
  const [loading, setLoading] = useState(true)
  const [noMatch, setNoMatch] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState(false)
  // R2-A04 - the session ended without a payment: 'expired' (Stripe
  // session gone, 404 from the check) or 'released' (session exists
  // but the booking is gone, 204). noMatch is now only the missing
  // sessionId path.
  const [sessionExpired, setSessionExpired] = useState<'expired' | 'released' | null>(null)

  useEffect(() => {
    if (!sessionId) {
      setNoMatch(true)
      setLoading(false)
      return
    }

    const checkSession = async () => {
      try {
        setLoading(true)
        const status = await StripeService.checkCheckoutSession(sessionId)

        if (status === 200) {
          const _bookingId = await BookingService.getBookingId(sessionId)
          setBookingId(_bookingId)
          setSuccess(true)
        } else if (status === 204) {
          setSessionExpired('released')
        } else {
          setError(true)
        }
      } catch (err) {
        setSuccess(false)
        // R2-A04 - a 404 from the session check means the Stripe session
        // expired (or was deleted): say so, instead of generic failure.
        // Anything else keeps the generic payment-failed branch.
        if ((err as unknown as { response?: { status?: number } })?.response?.status === 404) {
          setSessionExpired('expired')
        } else {
          setError(true)
        }
      } finally {
        setLoading(false)
      }
    }

    checkSession()
  }, [sessionId])

  return (
    <Layout>
      <div className="checkout-session">
        {
          loading
            ? <Info message={strings.CHECKING} hideLink />
            : (
              noMatch
                ? <NoMatch hideHeader />
                : sessionExpired
                  ? (
                    <>
                      <Info message={sessionExpired === 'expired' ? checkoutStatusStrings.SESSION_EXPIRED : checkoutStatusStrings.BOOKING_RELEASED} hideLink />
                      <p>
                        <Button variant="contained" onClick={() => navigate('/')}>{checkoutStatusStrings.SEARCH_AGAIN}</Button>
                      </p>
                    </>
                  )
                  : error
                    ? <Info message={strings.PAYMENT_FAILED} hideLink />
                : (
                  success && bookingId ? (
                    <CheckoutStatus
                      bookingId={bookingId}
                      sessionId={sessionId}
                      language={UserService.getLanguage()}
                      status={success ? 'success' : 'error'}
                      className="status"
                    />
                  ) : (
                    <Error message={commonStrings.GENERIC_ERROR} homeLink />
                  )
                )
            )
        }
      </div>
    </Layout>
  )
}

export default CheckoutSession
