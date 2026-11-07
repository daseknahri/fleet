import React, { ReactNode, useEffect, useMemo, useRef } from 'react'
import ReactSlick from 'react-slick'
import { Button } from '@mui/material'
import {
  ArrowRight,
  ArrowLeft,
  LocationOn as LocationIcon,
} from '@mui/icons-material'
import * as bookcarsHelper from ':bookcars-helper'
import SafeImage from '@/components/SafeImage'
import * as bookcarsTypes from ':bookcars-types'
import env from '@/config/env.config'
import { strings } from '@/lang/location-carrousel'
import { strings as commonStrings } from '@/lang/common'
import Badge from '@/components/Badge'
import Slick from '@/components/Slick'

import '@/assets/css/location-carrousel.css'

interface LocationCarrouselProps {
  locations: bookcarsTypes.Location[]
  onSelect?: (location: bookcarsTypes.Location) => void
}

const LocationCarrousel = ({
  locations,
  onSelect,
}: LocationCarrouselProps) => {
  const slider = useRef<ReactSlick>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  // Owner decision 3.3 (GA-P10-DECISIONS-01): non-active slick slides are
  // aria-hidden but contain focusable controls, so keyboard focus could
  // land on invisible content. Manage focus: focusables inside
  // aria-hidden slides get tabindex=-1 (restored when the slide becomes
  // active). Original tabindex values are kept in a data attribute.
  useEffect(() => {
    const root = rootRef.current
    if (!root) {
      return undefined
    }
    const syncTabIndexes = () => {
      root.querySelectorAll('.slick-slide').forEach((slide) => {
        const hidden = slide.getAttribute('aria-hidden') === 'true'
        slide.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]').forEach((el) => {
          if (hidden) {
            if (!el.dataset.gaPrevTabindex) {
              el.dataset.gaPrevTabindex = el.getAttribute('tabindex') ?? ''
            }
            el.setAttribute('tabindex', '-1')
          } else if (el.dataset.gaPrevTabindex !== undefined) {
            const prev = el.dataset.gaPrevTabindex
            if (prev) {
              el.setAttribute('tabindex', prev)
            } else {
              el.removeAttribute('tabindex')
            }
            delete el.dataset.gaPrevTabindex
          }
        })
      })
    }
    syncTabIndexes()
    const observer = new MutationObserver(syncTabIndexes)
    observer.observe(root, { attributes: true, attributeFilter: ['aria-hidden'], subtree: true })
    return () => observer.disconnect()
  }, [locations])

  const sliderSettings = useMemo(() => ({
    arrows: false,
    dots: true,

    appendDots: (dots: ReactNode) => (
      <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'center' }}>
        <Button variant="text" className="btn-slider btn-slider-prev" onClick={() => slider?.current?.slickPrev()}>
          <ArrowLeft />
          {commonStrings.BACK}
        </Button>
        <ul style={{ margin: '0px', padding: '0px' }}>
          {dots}
        </ul>
        <Button variant="text" className="btn-slider btn-slider-next" onClick={() => slider?.current?.slickNext()}>
          {commonStrings.NEXT}
          <ArrowRight />
        </Button>
      </div>
    ),

    infinite: true,
    speed: 500,
    swipeToSlide: true,
    slidesToShow: env.isMobile ? 1 : 3,
    slidesToScroll: 1,
    variableWidth: !env.isMobile,
    centerMode: false,
  }), [])

  return (
    <div className="location-caroussel" ref={rootRef}>
      <Slick ref={slider} {...sliderSettings}>
        {locations.map((location) => (
          <div key={location._id} className="box">
            <div className="location-image">
              {
                location.image ? (
                  <SafeImage alt="" src={bookcarsHelper.joinURL(env.CDN_LOCATIONS, location.image)} />
                )
                  : <LocationIcon className="location-icon" />
              }
            </div>
            <div className="title">
              <h2>{location.name}</h2>
              <Badge backgroundColor="#B3E5FC" color="#044f71" text="New" className="title-badge" />
              {/* <Badge backgroundColor="#B3E5FC" color="#2D7AB3" text="New" /> */}
              {/* <Badge backgroundColor="#FFE0B2" color="#EF8743" text="200 m from you" />
              <Badge backgroundColor="#FEEBEE" color="#F37977" text="-20% sale" /> */}
            </div>
            <p>{`${location.name}${location.parkingSpots && location.parkingSpots?.length > 0 ? ` · ${location.parkingSpots?.length} ${location.parkingSpots?.length === 1 ? strings.AVALIABLE_LOCATION : strings.AVALIABLE_LOCATIONS}` : ''}`}</p>
            <Button
              variant="text"
              color="inherit"
              className="btn-location"
              onClick={() => {
                if (onSelect) {
                  onSelect(location)
                }
              }}
            >
              {strings.SELECT_LOCATION}
            </Button>
          </div>
        ))}
      </Slick>
    </div>
  )
}

export default LocationCarrousel
