import React, { useEffect, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { Button } from '@mui/material'
import { Tune as FiltersIcon } from '@mui/icons-material'
import * as bookcarsTypes from ':bookcars-types'
import * as bookcarsHelper from ':bookcars-helper'
import { strings } from '@/lang/search'
import { visuallyHidden } from '@mui/utils'
import * as helper from '@/utils/helper'
import env from '@/config/env.config'
import * as LocationService from '@/services/LocationService'
import * as SupplierService from '@/services/SupplierService'
// import * as UserService from '@/services/UserService'
import Layout from '@/components/Layout'
import NoMatch from './NoMatch'
import CarFilter from '@/components/CarFilter'
import CarSpecsFilter from '@/components/CarSpecsFilter'
import SupplierFilter from '@/components/SupplierFilter'
import CarType from '@/components/CarTypeFilter'
import GearboxFilter from '@/components/GearboxFilter'
import MileageFilter from '@/components/MileageFilter'
import FuelPolicyFilter from '@/components/FuelPolicyFilter'
import DepositFilter from '@/components/DepositFilter'
import CarList from '@/components/CarList'
import CarRatingFilter from '@/components/CarRatingFilter'
import CarRangeFilter from '@/components/CarRangeFilter'
import CarMultimediaFilter from '@/components/CarMultimediaFilter'
import CarSeatsFilter from '@/components/CarSeatsFilter'
import Map from '@/components/Map'
import Progress from '@/components/Progress'
import Error from '@/components/Error'
import { strings as commonStrings } from '@/lang/common'
import ViewOnMapButton from '@/components/ViewOnMapButton'
import MapDialog from '@/components/MapDialog'

import '@/assets/css/search.css'

const Search = () => {
  const location = useLocation()
  const [searchParams] = useSearchParams()

  // R2-A03 - resolve the search inputs in order: URL query (shareable,
  // refresh-proof) -> router state (normal navigation) -> sessionStorage
  // (tab-scoped backup, carries the filter ranges). Dates are parsed
  // back from ISO strings; invalid dates count as missing.
  const resolveSearchParams = (): {
    pickupLocationId: string, dropOffLocationId: string, from: Date, to: Date, ranges?: bookcarsTypes.CarRange[],
  } | null => {
    const qPickup = searchParams.get('pickupLocationId')
    const qDropOff = searchParams.get('dropOffLocationId')
    const qFrom = searchParams.get('from')
    const qTo = searchParams.get('to')
    if (qPickup && qDropOff && qFrom && qTo) {
      const from = new Date(qFrom)
      const to = new Date(qTo)
      if (!Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime())) {
        return { pickupLocationId: qPickup, dropOffLocationId: qDropOff, from, to }
      }
    }
    const { state } = location
    if (state?.pickupLocationId && state?.dropOffLocationId && state?.from && state?.to) {
      return {
        pickupLocationId: state.pickupLocationId,
        dropOffLocationId: state.dropOffLocationId,
        from: state.from instanceof Date ? state.from : new Date(state.from),
        to: state.to instanceof Date ? state.to : new Date(state.to),
        ranges: state.ranges,
      }
    }
    try {
      const stored = sessionStorage.getItem('bc-search-state')
      if (stored) {
        const parsed = JSON.parse(stored)
        if (parsed?.pickupLocationId && parsed?.dropOffLocationId && parsed?.from && parsed?.to) {
          const from = new Date(parsed.from)
          const to = new Date(parsed.to)
          if (!Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime())) {
            return { pickupLocationId: parsed.pickupLocationId, dropOffLocationId: parsed.dropOffLocationId, from, to, ranges: parsed.ranges }
          }
        }
      }
    } catch {
      // Corrupted storage counts as missing - the NoMatch branch below.
    }
    return null
  }

  const [visible, setVisible] = useState(false)
  const [noMatch, setNoMatch] = useState(false)
  const [pickupLocation, setPickupLocation] = useState<bookcarsTypes.Location>()
  const [dropOffLocation, setDropOffLocation] = useState<bookcarsTypes.Location>()
  const [from, setFrom] = useState<Date>()
  const [to, setTo] = useState<Date>()
  const [allSuppliers, setAllSuppliers] = useState<bookcarsTypes.User[]>([])
  const [allSuppliersIds, setAllSuppliersIds] = useState<string[]>([])
  const [suppliers, setSuppliers] = useState<bookcarsTypes.User[]>([])
  const [supplierIds, setSupplierIds] = useState<string[]>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [suppliersError, setSuppliersError] = useState(false)
  const [carSpecs, setCarSpecs] = useState<bookcarsTypes.CarSpecs>({})
  const [carType, setCarType] = useState(bookcarsHelper.getAllCarTypes())
  const [gearbox, setGearbox] = useState([bookcarsTypes.GearboxType.Automatic, bookcarsTypes.GearboxType.Manual])
  const [mileage, setMileage] = useState([bookcarsTypes.Mileage.Limited, bookcarsTypes.Mileage.Unlimited])
  const [fuelPolicy, setFuelPolicy] = useState(bookcarsHelper.getAllFuelPolicies())
  const [deposit, setDeposit] = useState(-1)
  const [ranges, setRanges] = useState(bookcarsHelper.getAllRanges())
  const [multimedia, setMultimedia] = useState<bookcarsTypes.CarMultimedia[]>([])
  const [rating, setRating] = useState(-1)
  const [seats, setSeats] = useState(-1)
  const [openMapDialog, setOpenMapDialog] = useState(false)
  // const [distance, setDistance] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  // const [loadingPage, setLoadingPage] = useState(true)

  useEffect(() => {
    const fetchSuppliers = async () => {
      try {
        const fetchedSuppliers = await SupplierService.getAllSuppliers()
        setAllSuppliers(fetchedSuppliers)
        setAllSuppliersIds(bookcarsHelper.flattenSuppliers(fetchedSuppliers))
      } catch (err) {
        helper.error(err, strings.FETCH_SUPPLIERS_ERROR)
      }
    }

    fetchSuppliers()
  }, [])

  const updateSuppliers = async () => {
    if (!pickupLocation) return
    try {
      const payload: bookcarsTypes.GetCarsPayload = {
        pickupLocation: pickupLocation._id,
        carSpecs,
        carType,
        gearbox,
        mileage,
        fuelPolicy,
        deposit,
        ranges,
        multimedia,
        rating,
        seats,
        from,
        to,
      }
      const _suppliers = await SupplierService.getFrontendSuppliers(payload)
      setSuppliers(_suppliers)
      setSuppliersError(false)
    } catch (err) {
      // R2-A11 - never leave the previous suppliers on screen after a
      // filter change failed: the list would show cars that don't match
      // the filters. Clear + inline error + Retry.
      setSuppliers([])
      setSuppliersError(true)
      helper.error(err, strings.FETCH_SUPPLIERS_ERROR)
    }
  }

  useEffect(() => {
    if (from && to) {
      updateSuppliers()
    }
  }, [pickupLocation, carSpecs, carType, gearbox, mileage, fuelPolicy, deposit, ranges, multimedia, rating, seats, from, to]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleCarFilterSubmit = async (filter: bookcarsTypes.CarFilter) => {
    if (suppliers.length < allSuppliers.length) {
      const _supplierIds = bookcarsHelper.clone(allSuppliersIds)
      setSupplierIds(_supplierIds)
    }

    setPickupLocation(filter.pickupLocation)
    setDropOffLocation(filter.dropOffLocation)
    setFrom(filter.from)
    setTo(filter.to)
  }

  const handleSupplierFilterChange = (newSuppliers: string[]) => {
    setSupplierIds(newSuppliers)
  }

  const handleRatingFilterChange = (value: number) => {
    setRating(value)
  }

  const handleRangeFilterChange = (value: bookcarsTypes.CarRange[]) => {
    setRanges(value)
  }

  const handleMultimediaFilterChange = (value: bookcarsTypes.CarMultimedia[]) => {
    setMultimedia(value)
  }

  const handleSeatsFilterChange = (value: number) => {
    setSeats(value)
  }

  const handleCarSpecsFilterChange = (value: bookcarsTypes.CarSpecs) => {
    setCarSpecs(value)
  }

  const handleCarTypeFilterChange = (values: bookcarsTypes.CarType[]) => {
    setCarType(values)
  }

  const handleGearboxFilterChange = (values: bookcarsTypes.GearboxType[]) => {
    setGearbox(values)
  }

  const handleMileageFilterChange = (values: bookcarsTypes.Mileage[]) => {
    setMileage(values)
  }

  const handleFuelPolicyFilterChange = (values: bookcarsTypes.FuelPolicy[]) => {
    setFuelPolicy(values)
  }

  const handleDepositFilterChange = (value: number) => {
    setDeposit(value)
  }

  const onLoad = async (user?: bookcarsTypes.User) => {
    const resolved = resolveSearchParams()
    if (!resolved) {
      setLoading(false)
      setNoMatch(true)
      return
    }

    const { pickupLocationId, dropOffLocationId, from: _from, to: _to } = resolved

    let _pickupLocation
    let _dropOffLocation
    try {
      _pickupLocation = await LocationService.getLocation(pickupLocationId)

      if (!_pickupLocation) {
        setLoading(false)
        setNoMatch(true)
        return
      }

      if (dropOffLocationId !== pickupLocationId) {
        _dropOffLocation = await LocationService.getLocation(dropOffLocationId)
      } else {
        _dropOffLocation = _pickupLocation
      }

      if (!_dropOffLocation) {
        setLoading(false)
        setNoMatch(true)
        return
      }

      const payload: bookcarsTypes.GetCarsPayload = {
        pickupLocation: _pickupLocation._id,
        carSpecs,
        carType,
        gearbox,
        mileage,
        fuelPolicy,
        deposit,
        ranges,
        multimedia,
        rating,
        seats,
        from: _from,
        to: _to,
      }
      const _suppliers = await SupplierService.getFrontendSuppliers(payload)
      const _supplierIds = bookcarsHelper.flattenSuppliers(_suppliers)

      setPickupLocation(_pickupLocation)
      setDropOffLocation(_dropOffLocation)
      setFrom(_from)
      setTo(_to)
      setSuppliers(_suppliers)
      setSupplierIds(_supplierIds)

      if (resolved.ranges) {
        setRanges(resolved.ranges)
      }

      // if (_pickupLocation.latitude && _pickupLocation.longitude) {
      //   const l = await helper.getLocation()
      //   if (l) {
      //     const d = bookcarsHelper.distance(_pickupLocation.latitude, _pickupLocation.longitude, l[0], l[1], 'K')
      //     setDistance(bookcarsHelper.formatDistance(d, UserService.getLanguage()))
      //   }
      // }

      setLoading(false)
      if (!user || (user && user.verified)) {
        setVisible(true)
      }
    } catch (err) {
      helper.error(err)
      setLoading(false)
      setError(true)
    }
  }

  return (
    <>
      <Layout onLoad={onLoad} strict={false}>
        {visible && supplierIds && pickupLocation && dropOffLocation && from && to && (
          <div className="search">
            <h1 style={visuallyHidden}>{strings.SEARCH_HEADING}</h1>
            <div className="col-1">
              {!loading && (
                <>
                  {((pickupLocation.latitude && pickupLocation.longitude)
                    || (pickupLocation.parkingSpots && pickupLocation.parkingSpots.length > 0)) && (
                      <Map
                        position={[pickupLocation.latitude || Number(pickupLocation.parkingSpots![0].latitude), pickupLocation.longitude || Number(pickupLocation.parkingSpots![0].longitude)]}
                        initialZoom={10}
                        locations={[pickupLocation]}
                        parkingSpots={pickupLocation.parkingSpots}
                        className="map"
                      >
                        <ViewOnMapButton onClick={() => setOpenMapDialog(true)} />
                      </Map>
                    )}

                  <CarFilter
                    className="filter"
                    pickupLocation={pickupLocation}
                    dropOffLocation={dropOffLocation}
                    from={from}
                    to={to}
                    collapse
                    onSubmit={handleCarFilterSubmit}
                  />

                  <Button
                    variant="outlined"
                    color="primary"
                    startIcon={<FiltersIcon />}
                    disableElevation
                    fullWidth
                    className="btn btn-filters"
                    onClick={() => setShowFilters((prev) => !prev)}
                  >
                    {showFilters ? strings.HILE_FILTERS : strings.SHOW_FILTERS}
                  </Button>

                  {
                    showFilters && (
                      <>
                        {!env.HIDE_SUPPLIERS && <SupplierFilter className="filter" suppliers={suppliers} onChange={handleSupplierFilterChange} />}
                        <CarRatingFilter className="filter" onChange={handleRatingFilterChange} />
                        <CarRangeFilter className="filter" onChange={handleRangeFilterChange} />
                        <CarMultimediaFilter className="filter" onChange={handleMultimediaFilterChange} />
                        <CarSeatsFilter className="filter" onChange={handleSeatsFilterChange} />
                        <CarSpecsFilter className="filter" onChange={handleCarSpecsFilterChange} />
                        <CarType className="filter" onChange={handleCarTypeFilterChange} />
                        <GearboxFilter className="filter" onChange={handleGearboxFilterChange} />
                        <MileageFilter className="filter" onChange={handleMileageFilterChange} />
                        <FuelPolicyFilter className="filter" onChange={handleFuelPolicyFilterChange} />
                        <DepositFilter className="filter" onChange={handleDepositFilterChange} />
                      </>
                    )
                  }
                </>
              )}
            </div>
            <div className="col-2">
              {suppliersError && (
                <div className="search-error">
                  <Error message={strings.FETCH_SUPPLIERS_ERROR} />
                  <Button variant="outlined" onClick={() => updateSuppliers()}>{commonStrings.RETRY}</Button>
                </div>
              )}
              <CarList
                carSpecs={carSpecs}
                suppliers={supplierIds}
                carType={carType}
                gearbox={gearbox}
                mileage={mileage}
                fuelPolicy={fuelPolicy}
                deposit={deposit}
                pickupLocation={pickupLocation._id}
                dropOffLocation={dropOffLocation._id}
                // pickupLocationName={pickupLocation.name}
                loading={loading}
                from={from}
                to={to}
                ranges={ranges}
                multimedia={multimedia}
                rating={rating}
                seats={seats}
                // distance={distance}
                // onLoad={() => setLoadingPage(false)}
                hideSupplier={env.HIDE_SUPPLIERS}
                // includeAlreadyBookedCars
                includeComingSoonCars
              />
            </div>
          </div>
        )}

        <MapDialog
          pickupLocation={pickupLocation}
          openMapDialog={openMapDialog}
          onClose={() => setOpenMapDialog(false)}
        />

        {noMatch && <NoMatch hideHeader variant="lost-search" />}

        {error && <Error message={commonStrings.GENERIC_ERROR} />}
      </Layout>

      {loading && !noMatch && <Progress />}
    </>
  )
}

export default Search