import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Button,
  Skeleton,
  Tooltip,
} from '@mui/material'
import {
  LocalGasStation as CarTypeIcon,
  AccountTree as GearboxIcon,
  Person as SeatsIcon,
  AcUnit as AirconIcon,
  DirectionsCar as MileageIcon,
  Check as CheckIcon,
  Clear as UncheckIcon,
  Info as InfoIcon,
  LocationOn as LocationIcon,
} from '@mui/icons-material'
import * as bookcarsTypes from ':bookcars-types'
import * as bookcarsHelper from ':bookcars-helper'
import SafeImage from '@/components/SafeImage'
import env from '@/config/env.config'
import * as helper from '@/utils/helper'
import { strings as commonStrings } from '@/lang/common'
import { strings } from '@/lang/cars'
import Badge from '@/components/Badge'
import Error from '@/components/Error'
import * as UserService from '@/services/UserService'
import * as PaymentService from '@/services/PaymentService'

import DoorsIcon from '@/assets/img/car-door.png'
import DistanceIcon from '@/assets/img/distance-icon.png'
import RatingIcon from '@/assets/img/rating-icon.png'
import CO2MinIcon from '@/assets/img/co2-min-icon.png'
import CO2MiddleIcon from '@/assets/img/co2-middle-icon.png'
import CO2MaxIcon from '@/assets/img/co2-max-icon.png'

import '@/assets/css/car.css'

interface CarProps {
  car: bookcarsTypes.Car
  booking?: bookcarsTypes.Booking
  pickupLocation?: string
  dropOffLocation?: string
  from: Date
  to: Date
  pickupLocationName?: string
  distance?: string
  hideSupplier?: boolean
  sizeAuto?: boolean
  hidePrice?: boolean
}

const Car = ({
  car,
  booking,
  pickupLocation,
  dropOffLocation,
  from,
  to,
  pickupLocationName,
  distance,
  hideSupplier,
  sizeAuto,
  hidePrice,
}: CarProps) => {
  const navigate = useNavigate()

  const [language, setLanguage] = useState('')
  const [days, setDays] = useState(0)
  const [totalPrice, setTotalPrice] = useState(0)
  const [deposit, setDeposit] = useState(0)
  const [cancellation, setCancellation] = useState('')
  const [amendments, setAmendments] = useState('')
  const [theftProtection, setTheftProtection] = useState('')
  const [collisionDamageWaiver, setCollisionDamageWaiver] = useState('')
  const [fullInsurance, setFullInsurance] = useState('')
  const [additionalDriver, setAdditionalDriver] = useState('')
  const [loading, setLoading] = useState(true)
  const [conversionFallback, setConversionFallback] = useState(false)
  const [priceError, setPriceError] = useState(false)
  const [retryKey, setRetryKey] = useState(0)

  const handleRetry = () => {
    // R2-A14 - the option/price fetches live in effects; a retryKey bump
    // re-runs init() + fetchPrice() + fetchDeposit().
    setPriceError(false)
    setConversionFallback(false)
    setLoading(true)
    setRetryKey((k) => k + 1)
  }

  useEffect(() => {
    setLanguage(UserService.getLanguage())
  }, [])

  useEffect(() => {
    const fetchPrice = async () => {
      if (from && to) {
        try {
          const _totalPrice = await PaymentService.convertPrice(bookcarsHelper.calculateTotalPrice(car, from as Date, to as Date, car.supplier.priceChangeRate || 0))
          setTotalPrice(_totalPrice)
        } catch {
          // R2-A14 - FX down: show the base-currency price with a notice
          // instead of a skeleton forever. The raw total is in BASE_CURRENCY.
          setTotalPrice(bookcarsHelper.calculateTotalPrice(car, from as Date, to as Date, car.supplier.priceChangeRate || 0))
          setConversionFallback(true)
        }
        setDays(bookcarsHelper.days(from, to))
      }
    }

    fetchPrice()
  }, [from, to, retryKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const fetchDeposit = async () => {
      if (car.deposit > 0) {
        try {
          const _deposit = await PaymentService.convertPrice(car.deposit)
          // R2-A08 - same markup as checkout (Checkout.tsx onLoad): the card
          // must quote the deposit the customer will actually owe at pickup.
          setDeposit(_deposit + _deposit * ((car.supplier.priceChangeRate || 0) / 100))
        } catch {
          // R2-A14 - FX down: raw deposit + the R2-A08 markup, with a notice.
          setDeposit(car.deposit + car.deposit * ((car.supplier.priceChangeRate || 0) / 100))
          setConversionFallback(true)
        }
      } else {
        setDeposit(0)
      }
    }

    fetchDeposit()
  }, [car.deposit, retryKey])

  useEffect(() => {
    const init = async () => {
      const priceChangeRate = car.supplier.priceChangeRate || 0
      try {
        const _cancellation = (car.cancellation > -1 && (await helper.getCancellation(car.cancellation, language, priceChangeRate))) || ''
        const _amendments = (car.amendments > -1 && (await helper.getAmendments(car.amendments, language, priceChangeRate))) || ''
        const _theftProtection = (car.theftProtection > -1 && (await helper.getTheftProtection(car.theftProtection, language, priceChangeRate))) || ''
        const _collisionDamageWaiver = (car.collisionDamageWaiver > -1 && (await helper.getCollisionDamageWaiver(car.collisionDamageWaiver, language, priceChangeRate))) || ''
        const _fullInsurance = (car.fullInsurance > -1 && (await helper.getFullInsurance(car.fullInsurance, language, priceChangeRate))) || ''
        const _additionalDriver = (car.additionalDriver > -1 && (await helper.getAdditionalDriver(car.additionalDriver, language, priceChangeRate))) || ''

        setCancellation(_cancellation)
        setAmendments(_amendments)
        setTheftProtection(_theftProtection)
        setCollisionDamageWaiver(_collisionDamageWaiver)
        setFullInsurance(_fullInsurance)
        setAdditionalDriver(_additionalDriver)
      } catch {
        // R2-A14 - the option strings cannot fall back (the helpers do the
        // conversion internally): show error + Retry instead of a skeleton.
        setPriceError(true)
        setLoading(false)
        return
      }
      setLoading(false)

      if (!hidePrice) {
        let _totalPrice = await PaymentService.convertPrice(bookcarsHelper.calculateTotalPrice(car, from as Date, to as Date, car.supplier.priceChangeRate || 0))
        setTotalPrice(_totalPrice)
      }
    }

    init()
  }, [hidePrice, retryKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const getExtraIcon = (option: string, extra: number) => {
    let available = false
    if (booking) {
      if (option === 'cancellation' && booking.cancellation && extra > 0) {
        available = true
      }
      if (option === 'amendments' && booking.amendments && extra > 0) {
        available = true
      }
      if (option === 'collisionDamageWaiver' && booking.collisionDamageWaiver && extra > 0) {
        available = true
      }
      if (option === 'theftProtection' && booking.theftProtection && extra > 0) {
        available = true
      }
      if (option === 'fullInsurance' && booking.fullInsurance && extra > 0) {
        available = true
      }
      if (option === 'additionalDriver' && booking.additionalDriver && extra > 0) {
        available = true
      }
    }

    return extra === -1
      ? <UncheckIcon className="unavailable" />
      : extra === 0 || available
        ? <CheckIcon className="available" />
        : <InfoIcon className="extra-info" />
  }

  // R2-A14 - the option fetches failed: error + Retry, not a skeleton.
  if (priceError) {
    return (
      <div className="car-container">
        <article>
          <div style={{ width: '100%' }}>
            <Error message={strings.CARS_LOAD_ERROR} />
            <Button variant="outlined" onClick={handleRetry}>{commonStrings.RETRY}</Button>
          </div>
        </article>
      </div>
    )
  }

  // B-F-30: same-height skeleton instead of a blank pop-in while the
  // per-card price/extras fetch resolves.
  if (loading || !language || (!hidePrice && (!days || !totalPrice))) {
    return (
      <div className="car-container">
        <article>
          <div style={{ width: '100%' }}>
            <Skeleton variant="rectangular" width="100%" height={180} />
            <Skeleton variant="text" width="60%" height={32} sx={{ marginTop: 1 }} />
            <Skeleton variant="text" width="90%" />
            <Skeleton variant="text" width="75%" />
          </div>
        </article>
      </div>
    )
  }
  // console.log('car')

  const fr = language === 'fr'

  return (
    <div key={car._id} className="car-container">
      {pickupLocationName && (
        <div className="car-header">
          <div className="location">
            <LocationIcon />
            <span className="location-name">{pickupLocationName}</span>
          </div>
          {distance && (
            <div className="distance">
              <img alt={strings.DISTANCE} src={DistanceIcon} />
              <Badge backgroundColor="#D8EDF9" color="#000" text={`${distance} ${strings.FROM_YOU}`} />
            </div>
          )}
        </div>
      )}
      <article>
        <div className="car">
          <SafeImage src={bookcarsHelper.joinURL(env.CDN_CARS, car.image)} alt={car.name} className="car-img" />
          <div className="car-row">
            {!hideSupplier && (
              <div className="car-supplier" style={sizeAuto ? { bottom: 10 } : {}} title={car.supplier.fullName}>
                <span className="car-supplier-logo">
                  <SafeImage src={bookcarsHelper.joinURL(env.CDN_USERS, car.supplier.avatar)} alt={car.supplier.fullName} />
                </span>
                <span className="car-supplier-info">{car.supplier.fullName}</span>
              </div>
            )}
            <div className="car-footer">
              <div className="rating">
                {car.rating && car.rating >= 1 && (
                  <>
                    <span className="value">{car.rating.toFixed(2)}</span>
                    <img alt={strings.RATING} src={RatingIcon} />
                  </>
                )}
                {car.trips >= 10 && <span className="trips">{`(${car.trips} ${strings.TRIPS})`}</span>}
              </div>
              {car.co2 && (
                <div className="co2">
                  <img
                    alt={strings.CO2}
                    src={
                      car.co2 <= 90
                        ? CO2MinIcon
                        : car.co2 <= 110
                          ? CO2MiddleIcon
                          : CO2MaxIcon
                    }
                  />
                  <span>{strings.CO2}</span>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="car-info">
          <div className="car-info-header">
            <div className="name">{car.name}</div>
            {!hidePrice && (
              <div className="price">
                <span className="price-days">{helper.getDays(days)}</span>
                <span className="price-main">{bookcarsHelper.formatPrice(totalPrice, commonStrings.CURRENCY, language)}</span>
                <span className="price-day">
                  <span>{`${strings.PRICE_PER_DAY} `}</span>
                  <span className="price-day-value">{bookcarsHelper.formatPrice(totalPrice / days, commonStrings.CURRENCY, language)}</span>
                </span>
                {
                  car.comingSoon ? (
                    <span className="coming-soon">{strings.COMING_SOON}</span>
                  ) : car.fullyBooked ? (
                    <span className="fully-booked">{strings.FULLY_BOOKED}</span>
                  ) : null
                }
                  {conversionFallback && (
                    <div className="price-conversion-fallback">{strings.PRICES_IN_BASE_CURRENCY}</div>
                  )}
              </div>
            )}
          </div>

          <ul className="car-info-list">
            {car.type !== bookcarsTypes.CarType.Unknown && (
              <li className="car-type">
                <Tooltip title={helper.getCarTypeTooltip(car.type)} placement="top" enterTouchDelay={0}>
                  <div className="car-info-list-item">
                    <CarTypeIcon />
                    <span className="car-info-list-text">{helper.getCarTypeShort(car.type)}</span>
                  </div>
                </Tooltip>
              </li>
            )}
            <li className="gearbox">
              <Tooltip title={helper.getGearboxTooltip(car.gearbox)} placement="top" enterTouchDelay={0}>
                <div className="car-info-list-item">
                  <GearboxIcon />
                  <span className="car-info-list-text">{helper.getGearboxTypeShort(car.gearbox)}</span>
                </div>
              </Tooltip>
            </li>
            {car.seats > 0 && (
              <li className="seats">
                <Tooltip title={helper.getSeatsTooltip(car.seats)} placement="top" enterTouchDelay={0}>
                  <div className="car-info-list-item">
                    <SeatsIcon />
                    <span className="car-info-list-text">{car.seats}</span>
                  </div>
                </Tooltip>
              </li>
            )}
            {car.doors > 0 && (
              <li className="doors">
                <Tooltip title={helper.getDoorsTooltip(car.doors)} placement="top" enterTouchDelay={0}>
                  <div className="car-info-list-item">
                    <img src={DoorsIcon} alt="" className="car-doors" />
                    <span className="car-info-list-text">{car.doors}</span>
                  </div>
                </Tooltip>
              </li>
            )}
            {car.aircon && (
              <li className="aircon">
                <Tooltip title={strings.AIRCON_TOOLTIP} placement="top" enterTouchDelay={0}>
                  <div className="car-info-list-item" role="img">
                    <AirconIcon />
                    <span className="car-info-list-text">{strings.AIRCON}</span>
                  </div>
                </Tooltip>
              </li>
            )}
          </ul>
          {/* <Accordion className="accordion">
            <AccordionSummary className="accordion-summary" expandIcon={<ExpandMoreIcon />}>{strings.DETAILS}</AccordionSummary>
            <AccordionDetails> */}
          <ul className="extras-list">
            {car.mileage !== 0 && (
              <li className="mileage">
                <Tooltip title={helper.getMileageTooltip(car.mileage, language)} placement="left">
                  <div className="car-info-list-item">
                    <MileageIcon />
                    <span className="car-info-list-text">{`${strings.MILEAGE}${fr ? ' : ' : ': '}${helper.getMileage(car.mileage, language)}`}</span>
                  </div>
                </Tooltip>
              </li>
            )}
            <li className="fuel-policy">
              <Tooltip title={helper.getFuelPolicyTooltip(car.fuelPolicy)} placement="left">
                <div className="car-info-list-item">
                  <CarTypeIcon />
                  <span className="car-info-list-text">{`${strings.FUEL_POLICY}${fr ? ' : ' : ': '}${helper.getFuelPolicy(car.fuelPolicy)}`}</span>
                </div>
              </Tooltip>
            </li>
            {car.cancellation > -1 && (
              <li>
                <Tooltip title={booking ? '' : car.cancellation > -1 ? strings.CANCELLATION_TOOLTIP : cancellation} placement="left">
                  <div className="car-info-list-item">
                    {getExtraIcon('cancellation', car.cancellation)}
                    <span className="car-info-list-text">{cancellation}</span>
                  </div>
                </Tooltip>
              </li>
            )}
            {car.amendments > -1 && (
              <li>
                <Tooltip title={booking ? '' : car.amendments > -1 ? strings.AMENDMENTS_TOOLTIP : amendments} placement="left">
                  <div className="car-info-list-item">
                    {getExtraIcon('amendments', car.amendments)}
                    <span className="car-info-list-text">{amendments}</span>
                  </div>
                </Tooltip>
              </li>
            )}
            {car.theftProtection > -1 && (
              <li>
                <Tooltip title={booking ? '' : car.theftProtection > -1 ? strings.THEFT_PROTECTION_TOOLTIP : theftProtection} placement="left">
                  <div className="car-info-list-item">
                    {getExtraIcon('theftProtection', car.theftProtection)}
                    <span className="car-info-list-text">{theftProtection}</span>
                  </div>
                </Tooltip>
              </li>
            )}
            {car.collisionDamageWaiver > -1 && (
              <li>
                <Tooltip
                  title={booking ? '' : car.collisionDamageWaiver > -1 ? strings.COLLISION_DAMAGE_WAVER_TOOLTIP : collisionDamageWaiver}
                  placement="left"
                >
                  <div className="car-info-list-item">
                    {getExtraIcon('collisionDamageWaiver', car.collisionDamageWaiver)}
                    <span className="car-info-list-text">{collisionDamageWaiver}</span>
                  </div>
                </Tooltip>
              </li>
            )}
            {car.fullInsurance > -1 && (
              <li>
                <Tooltip title={booking ? '' : car.fullInsurance > -1 ? strings.FULL_INSURANCE_TOOLTIP : fullInsurance} placement="left">
                  <div className="car-info-list-item">
                    {getExtraIcon('fullInsurance', car.fullInsurance)}
                    <span className="car-info-list-text">{fullInsurance}</span>
                  </div>
                </Tooltip>
              </li>
            )}
            {car.additionalDriver > -1 && (
              <li>
                <Tooltip title={booking ? '' : additionalDriver} placement="left">
                  <div className="car-info-list-item">
                    {getExtraIcon('additionalDriver', car.additionalDriver)}
                    <span className="car-info-list-text">{additionalDriver}</span>
                  </div>
                </Tooltip>
              </li>
            )}
            {car.deposit > 0 && (
              <li>
                <div className="car-info-list-item">
                  <InfoIcon className="extra-info" />
                  <span className="car-info-list-text">{`${strings.DEPOSIT}: ${bookcarsHelper.formatPrice(deposit, commonStrings.CURRENCY, language)}`}</span>
                </div>
              </li>
            )}
          </ul>
          {/* </AccordionDetails>
          </Accordion> */}

          {!hidePrice && (
            <div className="action">
              {
                car.available && !car.comingSoon && !car.fullyBooked && (
                  <Button
                    variant="contained"
                    className="btn-primary btn-book btn-margin-bottom"
                    onClick={() => {
                      // R2-A03 - tab-scoped backup of the checkout inputs,
                      // so a refresh on /checkout restores the same car/dates.
                      sessionStorage.setItem('bc-checkout-state', JSON.stringify({ carId: car._id, pickupLocationId: pickupLocation, dropOffLocationId: dropOffLocation, from: from.toISOString(), to: to.toISOString() }))
                      navigate('/checkout', {
                        state: {
                          carId: car._id,
                          pickupLocationId: pickupLocation,
                          dropOffLocationId: dropOffLocation,
                          from,
                          to
                        }
                      })
                    }}
                  >
                    {strings.BOOK}
                  </Button>
                )
              }
            </div>
          )}
        </div>

      </article>
    </div>
  )
}

export default Car