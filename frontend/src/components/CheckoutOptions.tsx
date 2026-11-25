import React, { useEffect, useMemo, useState } from 'react'
import {
  Button,
  FormControl,
  FormControlLabel,
  Skeleton,
  Switch,
} from '@mui/material'
import {
  EventSeat as BookingIcon,
} from '@mui/icons-material'
import * as bookcarsTypes from ':bookcars-types'
import * as bookcarsHelper from ':bookcars-helper'
import { strings as csStrings } from '@/lang/cars'
import { strings as commonStrings } from '@/lang/common'
import { strings } from '@/lang/checkout'
import * as helper from '@/utils/helper'
import * as PaymentService from '@/services/PaymentService'
import Error from '@/components/Error'

import '@/assets/css/checkout-options.css'

interface CheckoutOptionsProps {
  car: bookcarsTypes.Car
  from: Date
  to: Date
  language: string
  clientSecret: string | null
  payPalLoaded: boolean
  onPriceChange: (value: number) => void
  onAdManuallyCheckedChange: (value: boolean) => void
  onCancellationChange: (value: boolean) => void
  onAmendmentsChange: (value: boolean) => void
  onTheftProtectionChange: (value: boolean) => void
  onCollisionDamageWaiverChange: (value: boolean) => void
  onFullInsuranceChange: (value: boolean) => void
  onAdditionalDriverChange: (value: boolean) => void
}

const CheckoutOptions = ({
  car,
  from,
  to,
  language,
  clientSecret,
  payPalLoaded,
  onPriceChange,
  onAdManuallyCheckedChange,
  onCancellationChange,
  onAmendmentsChange,
  onTheftProtectionChange,
  onCollisionDamageWaiverChange,
  onFullInsuranceChange,
  onAdditionalDriverChange,
}: CheckoutOptionsProps) => {
  const days = useMemo(() => {
    if (from && to) {
      return bookcarsHelper.days(from, to)
    }
    return 0
  }, [from, to])
  const [cancellation, setCancellation] = useState(false)
  const [amendments, setAmendments] = useState(false)
  const [theftProtection, setTheftProtection] = useState(false)
  const [collisionDamageWaiver, setCollisionDamageWaiver] = useState(false)
  const [fullInsurance, setFullInsurance] = useState(false)
  const [additionalDriver, setAdditionalDriver] = useState(false)

  const [cancellationOption, setCancellationOption] = useState('')
  const [amendmentsOption, setAmendmentsOption] = useState('')
  const [theftProtectionOption, setTheftProtectionOption] = useState('')
  const [collisionDamageWaiverOption, setCollisionDamageWaiverOption] = useState('')
  const [fullInsuranceOption, setFullInsuranceOption] = useState('')
  const [additionalDriverOption, setAdditionalDriverOption] = useState('')
  const [loading, setLoading] = useState(true)
  const [optionsError, setOptionsError] = useState(false)

  const fetchPrices = async () => {
    try {
      const priceChangeRate = car.supplier.priceChangeRate || 0
      setCancellationOption(await helper.getCancellationOption(car.cancellation, language, priceChangeRate))
      setAmendmentsOption(await helper.getAmendmentsOption(car.amendments, language, priceChangeRate))
      setTheftProtectionOption(await helper.getTheftProtectionOption(car.theftProtection, days, language, priceChangeRate))
      setCollisionDamageWaiverOption(await helper.getCollisionDamageWaiverOption(car.collisionDamageWaiver, days, language, priceChangeRate))
      setFullInsuranceOption(await helper.getFullInsuranceOption(car.fullInsurance, days, language, priceChangeRate))
      setAdditionalDriverOption(await helper.getAdditionalDriverOption(car.additionalDriver, days, language, priceChangeRate))
      setOptionsError(false)
    } catch {
      // R2-A14 - the option prices cannot fall back: show error + Retry.
      setOptionsError(true)
    } finally {
      setLoading(false)
    }
  }

  const handleRetryOptions = () => {
    setOptionsError(false)
    setLoading(true)
    fetchPrices()
  }

  useEffect(() => {
    fetchPrices()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (car) {
      setCancellation(car.cancellation === 0)
      setAmendments(car.amendments === 0)
      setTheftProtection(car.theftProtection === 0)
      setCollisionDamageWaiver(car.collisionDamageWaiver === 0)
      setFullInsurance(car.fullInsurance === 0)
      setAdditionalDriver(car.additionalDriver === 0)
    }
  }, [car])

  // R2-A14 - the option prices failed: error + Retry, not a skeleton.
  if (optionsError) {
    return (
      <div className="checkout-options-container">
        <Error message={strings.OPTIONS_LOAD_ERROR} />
        <Button variant="outlined" onClick={handleRetryOptions}>{commonStrings.RETRY}</Button>
      </div>
    )
  }

  // B-F-30: same-height skeleton instead of an invisible options block
  // while the six option prices resolve.
  if (loading && !optionsError) {
    return (
      <div className="checkout-options-container">
        <Skeleton variant="text" width={180} height={32} />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} variant="rectangular" width="100%" height={40} sx={{ marginBottom: 1 }} />
        ))}
      </div>
    )
  }

  const convertTotal = async (options: bookcarsTypes.CarOptions): Promise<number | null> => {
    try {
      return await PaymentService.convertPrice(bookcarsHelper.calculateTotalPrice(car, from, to, car.supplier.priceChangeRate || 0, options))
    } catch (err) {
      helper.error(err, strings.OPTIONS_PRICE_ERROR)
      return null
    }
  }

  const handleCancellationChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (car && from && to) {
      const _cancellation = e.target.checked
      const options: bookcarsTypes.CarOptions = {
        cancellation: _cancellation,
        amendments,
        theftProtection,
        collisionDamageWaiver,
        fullInsurance,
        additionalDriver,
      }
      const _price = await convertTotal(options)
      if (_price === null) return

      setCancellation(_cancellation)
      onCancellationChange(_cancellation)
      onPriceChange(_price)
    }
  }

  const handleAmendmentsChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (car && from && to) {
      const _amendments = e.target.checked
      const options: bookcarsTypes.CarOptions = {
        cancellation,
        amendments: _amendments,
        theftProtection,
        collisionDamageWaiver,
        fullInsurance,
        additionalDriver,
      }
      const _price = await convertTotal(options)
      if (_price === null) return

      setAmendments(_amendments)
      onAmendmentsChange(_amendments)
      onPriceChange(_price)
    }
  }

  const handleTheftProtectionChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (car && from && to) {
      const _theftProtection = e.target.checked
      const options: bookcarsTypes.CarOptions = {
        cancellation,
        amendments,
        theftProtection: _theftProtection,
        collisionDamageWaiver,
        fullInsurance,
        additionalDriver,
      }
      const _price = await convertTotal(options)
      if (_price === null) return

      setTheftProtection(_theftProtection)
      onTheftProtectionChange(_theftProtection)
      onPriceChange(_price)
    }
  }

  const handleCollisionDamageWaiverChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (car && from && to) {
      const _collisionDamageWaiver = e.target.checked
      const options: bookcarsTypes.CarOptions = {
        cancellation,
        amendments,
        theftProtection,
        collisionDamageWaiver: _collisionDamageWaiver,
        fullInsurance,
        additionalDriver,
      }
      const _price = await convertTotal(options)
      if (_price === null) return

      setCollisionDamageWaiver(_collisionDamageWaiver)
      onCollisionDamageWaiverChange(_collisionDamageWaiver)
      onPriceChange(_price)
    }
  }

  const handleFullInsuranceChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (car && from && to) {
      const _fullInsurance = e.target.checked
      const options: bookcarsTypes.CarOptions = {
        cancellation,
        amendments,
        theftProtection,
        collisionDamageWaiver,
        fullInsurance: _fullInsurance,
        additionalDriver,
      }
      const _price = await convertTotal(options)
      if (_price === null) return

      setFullInsurance(_fullInsurance)
      onFullInsuranceChange(_fullInsurance)
      onPriceChange(_price)
    }
  }

  const handleAdditionalDriverChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (car && from && to) {
      const _additionalDriver = e.target.checked
      const options: bookcarsTypes.CarOptions = {
        cancellation,
        amendments,
        theftProtection,
        collisionDamageWaiver,
        fullInsurance,
        additionalDriver: _additionalDriver,
      }
      const _price = await convertTotal(options)
      if (_price === null) return

      setAdditionalDriver(_additionalDriver)
      onAdditionalDriverChange(_additionalDriver)
      onPriceChange(_price)
      onAdManuallyCheckedChange(_additionalDriver)
    }
  }

  return (
    <div className="checkout-options-container">
      <div className="checkout-info">
        <BookingIcon />
        <span>{strings.BOOKING_OPTIONS}</span>
      </div>
      <div className="checkout-options">
        <FormControl fullWidth margin="dense">
          <FormControlLabel
            disabled={car.cancellation === -1 || car.cancellation === 0 || !!clientSecret || payPalLoaded}
            control={<Switch checked={cancellation} onChange={handleCancellationChange} color="primary" />}
            label={(
              <span>
                <span className="checkout-option-label">{csStrings.CANCELLATION}</span>
                <span className="checkout-option-value">{cancellationOption}</span>
              </span>
            )}
          />
        </FormControl>

        <FormControl fullWidth margin="dense">
          <FormControlLabel
            disabled={car.amendments === -1 || car.amendments === 0 || !!clientSecret || payPalLoaded}
            control={<Switch checked={amendments} onChange={handleAmendmentsChange} color="primary" />}
            label={(
              <span>
                <span className="checkout-option-label">{csStrings.AMENDMENTS}</span>
                <span className="checkout-option-value">{amendmentsOption}</span>
              </span>
            )}
          />
        </FormControl>

        <FormControl fullWidth margin="dense">
          <FormControlLabel
            disabled={car.theftProtection === -1 || car.theftProtection === 0 || !!clientSecret || payPalLoaded}
            control={<Switch checked={theftProtection} onChange={handleTheftProtectionChange} color="primary" />}
            label={(
              <span>
                <span className="checkout-option-label">{csStrings.THEFT_PROTECTION}</span>
                <span className="checkout-option-value">{theftProtectionOption}</span>
              </span>
            )}
          />
        </FormControl>

        <FormControl fullWidth margin="dense">
          <FormControlLabel
            disabled={car.collisionDamageWaiver === -1 || car.collisionDamageWaiver === 0 || !!clientSecret || payPalLoaded}
            control={<Switch checked={collisionDamageWaiver} onChange={handleCollisionDamageWaiverChange} color="primary" />}
            label={(
              <span>
                <span className="checkout-option-label">{csStrings.COLLISION_DAMAGE_WAVER}</span>
                <span className="checkout-option-value">{collisionDamageWaiverOption}</span>
              </span>
            )}
          />
        </FormControl>

        <FormControl fullWidth margin="dense">
          <FormControlLabel
            disabled={car.fullInsurance === -1 || car.fullInsurance === 0 || !!clientSecret || payPalLoaded}
            control={<Switch checked={fullInsurance} onChange={handleFullInsuranceChange} color="primary" />}
            label={(
              <span>
                <span className="checkout-option-label">{csStrings.FULL_INSURANCE}</span>
                <span className="checkout-option-value">{fullInsuranceOption}</span>
              </span>
            )}
          />
        </FormControl>

        <FormControl fullWidth margin="dense">
          <FormControlLabel
            disabled={car.additionalDriver === -1 || car.additionalDriver === 0 || !!clientSecret || payPalLoaded}
            control={<Switch checked={additionalDriver} onChange={handleAdditionalDriverChange} color="primary" />}
            label={(
              <span>
                <span className="checkout-option-label">{csStrings.ADDITIONAL_DRIVER}</span>
                <span className="checkout-option-value">{additionalDriverOption}</span>
              </span>
            )}
          />
        </FormControl>
      </div>
    </div>
  )
}

export default CheckoutOptions