import * as bookcarsTypes from ':bookcars-types'
import axiosInstance from './axiosInstance'
import * as UserService from './UserService'

/**
 * Create a Car.
 *
 * @param {bookcarsTypes.CreateCarPayload} data
 * @returns {Promise<bookcarsTypes.Car>}
 */
export const create = (data: bookcarsTypes.CreateCarPayload): Promise<bookcarsTypes.Car> =>
  axiosInstance
    .post(
      '/api/create-car',
      data,
      { withCredentials: true }
    )
    .then((res) => res.data)

/**
 * Update a Car.
 *
 * @param {bookcarsTypes.UpdateCarPayload} data
 * @returns {Promise<number>}
 */
export const update = (data: bookcarsTypes.UpdateCarPayload): Promise<number> =>
  axiosInstance
    .put(
      '/api/update-car',
      data,
      { withCredentials: true }
    )
    .then((res) => res.status)

/**
 * Check if a Car is related to a booking.
 *
 * @param {string} id
 * @returns {Promise<number>}
 */
export const check = (id: string): Promise<number> =>
  axiosInstance
    .get(
      `/api/check-car/${encodeURIComponent(id)}`,
      { withCredentials: true }
    )
    .then((res) => res.status)

/**
 * Validate a Car license plate.
 *
 * @param {string} id
 * @returns {Promise<number>}
 */
export const validateLicensePlate = (licensePlate: string): Promise<number> =>
  axiosInstance
    .get(
      `/api/validate-license-plate/${encodeURIComponent(licensePlate)}`,
      { withCredentials: true }
    )
    .then((res) => res.status)

/**
 * Validate a Car license plate for update.
 *
 * @param {string} id
 * @returns {Promise<number>}
 */
export const validateCarLicensePlate = (carId: string, licensePlate: string): Promise<number> =>
  axiosInstance
    .get(
      `/api/validate-license-plate/${carId}/${encodeURIComponent(licensePlate)}`,
      { withCredentials: true }
    )
    .then((res) => res.status)

/**
 * Delete a Car (purge-from-trash only, GA-PAR-22).
 *
 * The route refuses live cars (409 NOT_TRASHED) and cars with any
 * booking history (409, unchanged). Called only from the Trash view;
 * the reason is required (3–1000).
 *
 * @param {string} id
 * @param {string} reason
 * @returns {Promise<number>}
 */
export const deleteCar = (id: string, reason?: string): Promise<number> =>
  axiosInstance
    .delete(
      `/api/delete-car/${encodeURIComponent(id)}`,
      { withCredentials: true, data: { reason } }
    )
    .then((res) => res.status)

/**
 * Trash a Car (GA-PAR-22).
 *
 * @param {string} id
 * @param {string} reason
 * @returns {Promise<number>}
 */
export const trashCar = (id: string, reason: string): Promise<number> =>
  axiosInstance
    .post(
      `/api/trash-car/${encodeURIComponent(id)}`,
      { reason },
      { withCredentials: true }
    )
    .then((res) => res.status)

/**
 * Restore a Car (GA-PAR-22).
 *
 * @param {string} id
 * @param {string} [reason]
 * @returns {Promise<number>}
 */
export const restoreCar = (id: string, reason?: string): Promise<number> =>
  axiosInstance
    .post(
      `/api/restore-car/${encodeURIComponent(id)}`,
      { reason },
      { withCredentials: true }
    )
    .then((res) => res.status)

/**
 * Get Trashed Cars (GA-PAR-22).
 *
 * @param {string[]} suppliers
 * @param {string} keyword
 * @param {number} page
 * @param {number} size
 * @returns {Promise<bookcarsTypes.Result<bookcarsTypes.Car>>}
 */
export const getTrashedCars = (suppliers: string[], keyword: string, page: number, size: number): Promise<bookcarsTypes.Result<bookcarsTypes.Car>> =>
  axiosInstance
    .post(
      `/api/trashed-cars/${page}/${size}/?s=${encodeURIComponent(keyword)}`,
      { suppliers },
      { withCredentials: true }
    )
    .then((res) => res.data)

/**
 * Get the trash-warning figures for one Car (GA-PAR-22, §5.7).
 *
 * @param {string} id
 * @returns {Promise<bookcarsTypes.TrashWarning>}
 */
export const getCarTrashWarning = (id: string): Promise<bookcarsTypes.TrashWarning> =>
  axiosInstance
    .get(
      `/api/cars/${encodeURIComponent(id)}/trash-warning`,
      { withCredentials: true }
    )
    .then((res) => res.data)

/**
 * Create a temporary Car image.
 *
 * @param {Blob} file
 * @returns {Promise<string>}
 */
export const createImage = (file: Blob): Promise<string> => {
  const formData = new FormData()
  formData.append('image', file)

  return axiosInstance
    .post(
      '/api/create-car-image',
      formData,
      {
        withCredentials: true,
        headers: { 'Content-Type': 'multipart/form-data' }
      },
    )
    .then((res) => res.data)
}

/**
 * Update a Car image.
 *
 * @param {string} id
 * @param {Blob} file
 * @returns {Promise<number>}
 */
export const updateImage = (id: string, file: Blob): Promise<number> => {
  const formData = new FormData()
  formData.append('image', file)

  return axiosInstance
    .post(
      `/api/update-car-image/${encodeURIComponent(id)}`,
      formData,
      {
        withCredentials: true,
        headers: { 'Content-Type': 'multipart/form-data' }
      },
    )
    .then((res) => res.status)
}

/**
 * Delete a Car image.
 *
 * @param {string} id
 * @returns {Promise<number>}
 */
export const deleteImage = (id: string): Promise<number> =>
  axiosInstance
    .post(
      `/api/delete-car-image/${encodeURIComponent(id)}`,
      null,
      { withCredentials: true }
    )
    .then((res) => res.status)

/**
 * Delete a temporary Car image.
 *
 * @param {string} image
 * @returns {Promise<number>}
 */
export const deleteTempImage = (image: string): Promise<number> =>
  axiosInstance
    .post(
      `/api/delete-temp-car-image/${encodeURIComponent(image)}`,
      null,
      { withCredentials: true }
    )
    .then((res) => res.status)

/**
 * Get a Car by ID.
 *
 * @param {string} id
 * @returns {Promise<bookcarsTypes.Car>}
 */
export const getCar = (id: string): Promise<bookcarsTypes.Car> =>
  axiosInstance
    .get(
      `/api/car/${encodeURIComponent(id)}/${UserService.getLanguage()}`,
      { withCredentials: true }
    )
    .then((res) => res.data)

/**
 * Get Cars.
 *
 * @param {string} keyword
 * @param {bookcarsTypes.GetCarsPayload} data
 * @param {number} page
 * @param {number} size
 * @returns {Promise<bookcarsTypes.Result<bookcarsTypes.Car>>}
 */
export const getCars = (keyword: string, data: bookcarsTypes.GetCarsPayload, page: number, size: number): Promise<bookcarsTypes.Result<bookcarsTypes.Car>> =>
  axiosInstance
    .post(
      `/api/cars/${page}/${size}/?s=${encodeURIComponent(keyword)}`,
      data,
      { withCredentials: true }
    )
    .then((res) => res.data)

/**
 * Get Cars by supplier and location.
 *
 * @param {string} keyword
 * @param {bookcarsTypes.GetBookingCarsPayload} data
 * @param {number} page
 * @param {number} size
 * @returns {Promise<bookcarsTypes.Car[]>}
 */
export const getBookingCars = (keyword: string, data: bookcarsTypes.GetBookingCarsPayload, page: number, size: number): Promise<bookcarsTypes.Car[]> =>
  axiosInstance
    .post(
      `/api/booking-cars/${page}/${size}/?s=${encodeURIComponent(keyword)}`,
      data,
      { withCredentials: true }
    )
    .then((res) => res.data)
