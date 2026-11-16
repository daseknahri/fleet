import React, { useCallback, useEffect, useState } from 'react'
import { useMediaQuery, Typography } from '@mui/material'
import { useNavigate } from 'react-router-dom'
import { fr, enUS, es, arMA } from 'date-fns/locale'
import { Scheduler } from '@/components/scheduler/index'
import {
  ProcessedEvent,
  RemoteQuery,
  SchedulerRef,
} from '@/components/scheduler/types'
import * as bookcarsTypes from ':bookcars-types'
import * as helper from '@/utils/helper'
import * as BookingService from '@/services/BookingService'
import * as CarService from '@/services/CarService'
import * as MaintenanceScheduleService from '@/services/MaintenanceScheduleService'
import { strings as bookingsStrings } from '@/lang/bookings'

interface VehicleSchedulerProps {
  suppliers: string[]
  statuses: string[]
  filter?: bookcarsTypes.Filter
  user?: bookcarsTypes.User
  language: string
  // F8 / W5 C2 — create-from-slot is offered only when the viewer may
  // manage bookings (Scheduler.tsx passes its canManageBookings).
  canCreate?: boolean
  // F8 / W5 C3 — vehicle-by-day grid: one month table per vehicle.
  grid?: boolean
}

// Maintenance blocks render as one-day, non-bookable events in a
// colour no booking status uses (F8 / W5 C1).
const MAINTENANCE_COLOR = '#7b1fa2'
const MAINTENANCE_TEXT_COLOR = '#ffffff'

const carLabelOf = (car: bookcarsTypes.Car | string | undefined) => {
  if (!car) return ''
  if (typeof car === 'string') return car
  return car.licensePlate ? `${car.name} (${car.licensePlate})` : car.name
}

const dayStart = (value: Date | string) => {
  const d = new Date(value)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

const VehicleScheduler = (
  {
    suppliers,
    statuses,
    filter: filterFromProps,
    user,
    language,
    canCreate,
    grid,
  }: VehicleSchedulerProps
) => {
  const navigate = useNavigate()
  const [filter, setFilter] = useState<bookcarsTypes.Filter>()
  const [init, setInit] = useState(true)
  // F8 / W5 C6 — the bookings fetch is capped at 10,000 rows (and the
  // grid's car fetch at 1,000): when the cap binds, the calendar shows
  // a partial-data banner instead of silently omitting rows.
  const [partial, setPartial] = useState(false)
  const [carsPartial, setCarsPartial] = useState(false)
  // F8 / W5 C1 — open maintenance schedules for the visible agencies,
  // rendered as non-bookable blocks (F7's merged due status is already
  // on the list payload: a schedule is a block until Completed).
  const [schedules, setSchedules] = useState<bookcarsTypes.MaintenanceSchedule[]>([])
  // F8 / W5 C3 — grid resources (one per vehicle). The vendored
  // scheduler store takes resources as initial-only state, so the
  // <Scheduler> below is keyed by grid mode and remounts on toggle.
  const [resources, setResources] = useState<{ carId: string, text: string, subtext?: string }[]>([])

  const schedulerRef = React.useRef<SchedulerRef>(null)

  // B-A-18: phones open on the single-day view — the month grid is only
  // horizontal scroll at 360px. The view prop is initial-only in the
  // vendored scheduler, so this is the mount-time default.
  const isMobileView = useMediaQuery('(max-width:767px)')

  useEffect(() => {
    setFilter(filterFromProps)
  }, [filterFromProps])

  useEffect(() => {
    let cancelled = false
    MaintenanceScheduleService.list()
      .then((rows) => { if (!cancelled) setSchedules(rows || []) })
      .catch(() => { if (!cancelled) setSchedules([]) })
    return () => { cancelled = true }
  }, [suppliers])

  useEffect(() => {
    if (!grid) {
      setResources([])
      setCarsPartial(false)
      return undefined
    }
    let cancelled = false
    CarService.getCars('', {
      suppliers,
      includeAlreadyBookedCars: true,
      includeComingSoonCars: true,
    }, 1, 1000)
      .then((result) => {
        if (cancelled) return
        const rows = result?.[0]?.resultData || []
        setCarsPartial(rows.length >= 1000)
        setResources(rows.filter((car) => car._id).map((car) => ({
          carId: car._id as string,
          text: carLabelOf(car),
          subtext: car.licensePlate || undefined,
        })))
      })
      .catch(() => { if (!cancelled) setResources([]) })
    return () => { cancelled = true }
  }, [grid, suppliers])

  const fetchBookings = useCallback(async (query: RemoteQuery): Promise<ProcessedEvent[]> => {
    const emptyEvents: ProcessedEvent[] = [
      {
        event_id: '1',
        title: 'Dummy Event',
        start: new Date(1970, 0, 1),
        end: new Date(1970, 0, 2),
      }
    ]

    const dateBetween = new Date(query.end.getTime() - Math.ceil(query.end.getTime() - query.start.getTime()) / 2)
    dateBetween.setHours(10, 0, 0, 0)

    const payload: bookcarsTypes.GetBookingsPayload = {
      suppliers,
      statuses,
      filter: {
        from: query.view !== 'day' ? new Date(query.start.getFullYear(), query.start.getMonth() - 1, 1) : undefined,
        dateBetween: query.view === 'day' ? dateBetween : undefined,
        to: query.view === 'month' ? new Date(query.end.getFullYear(), query.end.getMonth() + 1, 0) : new Date(query.end.getFullYear(), query.end.getMonth() + 2, 0),
        pickupLocation: filter?.pickupLocation,
        dropOffLocation: filter?.dropOffLocation,
        keyword: filter?.keyword,
      },
      user: (user && user._id) || undefined,
    }

    const data = await BookingService.getBookings(payload, 1, 10000)
    const _data = data && data.length > 0 ? data[0] : { pageInfo: { totalRecord: 0 }, resultData: [] }
    if (!_data) {
      helper.error()
      setPartial(false)
      return emptyEvents
    }
    const bookings = _data.resultData
    // F8 / W5 C6 — the fetch is capped at 10,000 rows; a full page
    // means the calendar may be missing bookings.
    setPartial(bookings.length >= 10000)

    const events = bookings.map((booking): ProcessedEvent => ({
      event_id: booking._id as string,
      title: `${(booking.car as bookcarsTypes.Car).name} / ${(booking.supplier as bookcarsTypes.User).fullName} / ${helper.getBookingStatus(booking.status)}`,
      start: new Date(booking.from),
      end: new Date(booking.to),
      color: helper.getBookingStatusBackgroundColor(booking.status),
      textColor: helper.getBookingStatusTextColor(booking.status),
      // F8 / W5 C3 — the grid matches events to their vehicle row.
      carId: typeof booking.car === 'string' ? booking.car : (booking.car as bookcarsTypes.Car | undefined)?._id,
    }))

    // F8 / W5 C1 — maintenance blocks: one-day, non-bookable events on
    // the schedule's due date (F7 merged status: date leg + mileage
    // leg; Completed schedules are not blocks). A block is identified
    // by its `maintenance-` event id; clicking it opens /maintenance.
    for (const schedule of schedules) {
      if (schedule.status === bookcarsTypes.MaintenanceScheduleStatus.Completed) continue
      const start = dayStart(schedule.nextDueDate)
      const end = new Date(start)
      end.setDate(end.getDate() + 1)
      const carId = typeof schedule.car === 'string' ? schedule.car : (schedule.car as bookcarsTypes.Car | undefined)?._id
      events.push({
        event_id: `maintenance-${schedule._id}`,
        title: `Maintenance — ${schedule.title} (${carLabelOf(schedule.car as bookcarsTypes.Car | string | undefined) || '?'})`,
        start,
        end,
        color: MAINTENANCE_COLOR,
        textColor: MAINTENANCE_TEXT_COLOR,
        carId,
        maintenance: true,
      })
    }

    setInit(false)

    if (events.length === 0) {
      return emptyEvents
    }
    return events
  }, [filter, statuses, suppliers, user, schedules])

  useEffect(() => {
    const fetchEvents = async () => {
      schedulerRef.current?.scheduler?.handleState(fetchBookings, 'getRemoteEvents')
    }

    if (!init && statuses.length > 0 && suppliers.length > 0) {
      fetchEvents()
    }
  }, [statuses, suppliers, filter, schedules]) // eslint-disable-line react-hooks/exhaustive-deps

  // F8 / W5 C2 — create-from-slot: a free cell navigates to the booking
  // form prefilled with the slot (and the vehicle in grid mode). The
  // form itself still validates availability; an overlapping slot is
  // refused there with the usual 409, including the F7 overdue-
  // maintenance block. No drag/resize editing is enabled.
  const handleCellClick = useCallback((start: Date, end: Date, resourceKey?: string, resourceVal?: string | number) => {
    if (!canCreate) return
    const params = new URLSearchParams()
    if (resourceKey === 'carId' && resourceVal) {
      params.set('car', String(resourceVal))
    }
    params.set('from', start.toISOString())
    params.set('to', end.toISOString())
    navigate(`/create-booking?${params.toString()}`)
  }, [canCreate, navigate])

  const getTranslations = (_language: string) => {
    if (_language === 'fr') {
      return {
        navigation: {
          month: 'Mois',
          week: 'Semaine',
          day: 'Jour',
          today: "Aujourd'hui",
          agenda: 'Agenda',
        },
        navigationAria: {
          prevDay: 'Jour précédent',
          nextDay: 'Jour suivant',
          selectedDay: 'Date sélectionnée',
          prevWeek: 'Semaine précédente',
          nextWeek: 'Semaine suivante',
          selectedWeek: 'Semaine sélectionnée',
          prevMonth: 'Mois précédent',
          nextMonth: 'Mois suivant',
          selectedMonth: 'Mois sélectionné',
        },
        form: {
          addTitle: 'Ajouter un événement',
          editTitle: 'Modifier un événement',
          confirm: 'Confirmer',
          delete: 'Supprimer',
          cancel: 'Annuler',
        },
        event: {
          title: 'Titre',
          subtitle: 'Sous-titre',
          start: 'Début',
          end: 'Fin',
          allDay: 'Toute la journée',
        },
        validation: {
          required: 'Obligatoire',
          invalidEmail: 'E-mail non valide',
          onlyNumbers: 'Seuls les chiffres sont autorisés',
          min: (min: number) => `Minimum de ${min} lettres`,
          max: (max: number) => `Maximum de ${max} lettres`,
        },
        moreEvents: 'Plus...',
        noDataToDisplay: 'Aucune donnée à afficher',
        loading: 'Chargement...',
        close: 'Fermer',
      }
    }

    if (_language === 'es') {
      return {
        navigation: {
          month: 'Mes',
          week: 'Semana',
          day: 'Día',
          today: 'Hoy',
          agenda: 'Agenda'
        },
        navigationAria: {
          prevDay: 'Día anterior',
          nextDay: 'Día siguiente',
          selectedDay: 'Fecha seleccionada',
          prevWeek: 'Semana anterior',
          nextWeek: 'Semana siguiente',
          selectedWeek: 'Semana seleccionada',
          prevMonth: 'Mes anterior',
          nextMonth: 'Mes siguiente',
          selectedMonth: 'Mes seleccionado',
        },
        form: {
          addTitle: 'Agregar evento',
          editTitle: 'Editar evento',
          confirm: 'Confirmar',
          delete: 'Eliminar',
          cancel: 'Cancelar'
        },
        event: {
          title: 'Título',
          subtitle: 'Subtítulo',
          start: 'Inicio',
          end: 'Fin',
          allDay: 'Todo el día'
        },
        validation: {
          required: 'Obligatorio',
          invalidEmail: 'Correo electrónico no válido',
          onlyNumbers: 'Solo se permiten números',
          min: (min: number) => `Mínimo ${min} letras`,
          max: (max: number) => `Máximo ${max} letras`
        },
        moreEvents: 'Más...',
        noDataToDisplay: 'Sin datos para mostrar',
        loading: 'Cargando...',
        close: 'Cerrar',
      }
    }

    if (_language === 'ar') {
      return {
        navigation: {
          month: 'شهر',
          week: 'أسبوع',
          day: 'يوم',
          today: 'اليوم',
          agenda: 'الأجندة',
        },
        navigationAria: {
          prevDay: 'اليوم السابق',
          nextDay: 'اليوم التالي',
          selectedDay: 'التاريخ المحدد',
          prevWeek: 'الأسبوع السابق',
          nextWeek: 'الأسبوع التالي',
          selectedWeek: 'الأسبوع المحدد',
          prevMonth: 'الشهر السابق',
          nextMonth: 'الشهر التالي',
          selectedMonth: 'الشهر المحدد',
        },
        form: {
          addTitle: 'إضافة حدث',
          editTitle: 'تعديل الحدث',
          confirm: 'تأكيد',
          delete: 'حذف',
          cancel: 'إلغاء',
        },
        event: {
          title: 'العنوان',
          subtitle: 'العنوان الفرعي',
          start: 'البداية',
          end: 'النهاية',
          allDay: 'طوال اليوم',
        },
        validation: {
          required: 'مطلوب',
          invalidEmail: 'بريد إلكتروني غير صالح',
          onlyNumbers: 'يسمح بالأرقام فقط',
          min: (min: number) => `الحد الأدنى ${min} حرف`,
          max: (max: number) => `الحد الأقصى ${max} حرف`,
        },
        moreEvents: 'المزيد...',
        noDataToDisplay: 'لا توجد بيانات لعرضها',
        loading: 'جار التحميل...',
        close: 'إغلاق',
      }
    }

    // default to english
    return {
      navigation: {
        month: 'Month',
        week: 'Week',
        day: 'Day',
        today: 'Today',
        agenda: 'Agenda',
      },
      navigationAria: {
        prevDay: 'previous day',
        nextDay: 'next day',
        selectedDay: 'selected date',
        prevWeek: 'previous week',
        nextWeek: 'next week',
        selectedWeek: 'selected week',
        prevMonth: 'previous month',
        nextMonth: 'next month',
        selectedMonth: 'selected month',
      },
      form: {
        addTitle: 'Add Event',
        editTitle: 'Edit Event',
        confirm: 'Confirm',
        delete: 'Delete',
        cancel: 'Cancel',
      },
      event: {
        title: 'Title',
        subtitle: 'Subtitle',
        start: 'Start',
        end: 'End',
        allDay: 'All Day',
      },
      validation: {
        required: 'Required',
        invalidEmail: 'Invalid Email',
        onlyNumbers: 'Only Numbers Allowed',
        min: (min: number) => `Minimum ${min} letters`,
        max: (max: number) => `Maximum ${max} letters`,
      },
      moreEvents: 'More...',
      noDataToDisplay: 'No data to display',
      loading: 'Loading...',
      close: 'Close',
    }
  }

  return (
    <>
      {(partial || carsPartial) && (
        <Typography sx={{ p: 1 }} color="warning.main">{bookingsStrings.PARTIAL_DATA}</Typography>
      )}
      <Scheduler
      key={grid ? 'grid' : 'month'}
      ref={schedulerRef}
      view={isMobileView ? 'day' : 'month'}
      locale={language === 'fr' ? fr : language === 'es' ? es : language === 'ar' ? arMA : enUS}
      direction={language === 'ar' ? 'rtl' : 'ltr'}
      disableViewer
      editable={false}
      draggable={false}
      agenda={false}
      resources={resources}
      resourceFields={{ idField: 'carId', textField: 'text', subTextField: 'subtext' }}
      resourceViewMode="default"
      onCellClick={canCreate ? handleCellClick : undefined}
      onEventClick={(event: ProcessedEvent) => {
        if (typeof event.event_id === 'string' && event.event_id.startsWith('maintenance-')) {
          window.open('/maintenance', '_blank')!.focus()
          return
        }
        const url = `/update-booking?b=${event.event_id}`
        window.open(url, '_blank')!.focus()
      }}
      getRemoteEvents={fetchBookings}
      translations={getTranslations(language)}
      height={window.innerHeight - (64 + 41 + 33 + 10)}
      onClickMore={(date: Date, goToDay: (d: Date) => void) => {
        goToDay(date)
      }}
    />
    </>
  )
}

export default VehicleScheduler
