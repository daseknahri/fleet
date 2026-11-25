import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Button,
  Paper,
  FormControl,
  InputLabel,
  Input,
  FormHelperText,
} from '@mui/material'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as BookingService from '@/services/BookingService'
import Layout from '@/components/Layout'
import { strings } from '@/lang/booking-lookup'
import * as helper from '@/utils/helper'
import Footer from '@/components/Footer'
import Error from '@/components/Error'
import { schema, FormFields } from '@/models/BookingLookupForm'

import '@/assets/css/activate.css'

// R2-A15 - guest booking lookup by reference + email. On success the
// booking detail opens via the session capability token (?session=),
// the same token getBooking already accepts. A wrong reference OR a
// wrong email shows the same generic LOOKUP_NOT_FOUND (no oracle).
const BookingLookup = () => {
  const navigate = useNavigate()
  const [visible, setVisible] = useState(false)
  const [notFound, setNotFound] = useState(false)

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormFields>({
    resolver: zodResolver(schema),
    mode: 'onSubmit',
  })

  const onLoad = () => {
    setVisible(true)
  }

  const onSubmit = async ({ reference, email }: FormFields) => {
    try {
      setNotFound(false)
      const { bookingId, sessionId } = await BookingService.lookupGuest(reference, email)
      navigate(`/booking?b=${bookingId}&session=${sessionId}`)
    } catch (err) {
      if ((err as any)?.response?.status === 404) {
        setNotFound(true)
      } else {
        helper.error(err)
      }
    }
  }

  return (
    <Layout onLoad={onLoad}>
      {visible && (
        <div className="booking-lookup">
          <Paper className="form">
            <h1>{strings.TITLE}</h1>
            <form onSubmit={handleSubmit(onSubmit)}>
              <FormControl fullWidth margin="dense">
                <InputLabel>{strings.REFERENCE}</InputLabel>
                <Input {...register('reference')} autoComplete="off" />
                {errors.reference && <FormHelperText error>{errors.reference.message}</FormHelperText>}
              </FormControl>
              <FormControl fullWidth margin="dense">
                <InputLabel>{strings.EMAIL}</InputLabel>
                <Input {...register('email')} type="email" autoComplete="email" />
                {errors.email && <FormHelperText error>{errors.email.message}</FormHelperText>}
              </FormControl>
              <div className="form-error">
                {notFound && <Error message={strings.LOOKUP_NOT_FOUND} />}
              </div>
              <Button type="submit" variant="contained" className="btn-primary" disabled={isSubmitting}>
                {strings.SUBMIT}
              </Button>
            </form>
          </Paper>
        </div>
      )}
      <Footer />
    </Layout>
  )
}

export default BookingLookup
