import * as bookcarsTypes from ':bookcars-types'
import axiosInstance from './axiosInstance'

/**
 * Validate Supplier name.
 *
 * @param {bookcarsTypes.ValidateSupplierPayload} data
 * @returns {Promise<number>}
 */
export const validate = (data: bookcarsTypes.ValidateSupplierPayload): Promise<number> =>
  axiosInstance
    .post(
      '/api/validate-supplier',
      data,
      { withCredentials: true }
    )
    .then((res) => res.status)

/**
 * Update a Supplier.
 *
 * @param {bookcarsTypes.UpdateSupplierPayload} data
 * @returns {Promise<number>}
 */
export const update = (data: bookcarsTypes.UpdateSupplierPayload): Promise<bookcarsTypes.Response<bookcarsTypes.User>> =>
  axiosInstance
    .put(
      '/api/update-supplier',
      data,
      { withCredentials: true }
    )
    .then((res) => ({ status: res.status, data: res.data }))

/**
 * Upload the agency stamp image (GA-PAR-14).
 *
 * @param {string} supplierId
 * @param {Blob} file
 * @returns {Promise<string>} stored filename
 */
export const uploadStamp = (supplierId: string, file: Blob): Promise<string> => {
  const formData = new FormData()
  formData.append('file', file)

  return axiosInstance
    .post(
      `/api/supplier-stamp/${encodeURIComponent(supplierId)}`,
      formData,
      {
        withCredentials: true,
        headers: { 'Content-Type': 'multipart/form-data' }
      },
    )
    .then((res) => res.data)
}

/**
 * Delete the agency stamp image (GA-PAR-14).
 *
 * @param {string} supplierId
 * @returns {Promise<number>}
 */
export const deleteStamp = (supplierId: string): Promise<number> =>
  axiosInstance
    .post(
      `/api/delete-supplier-stamp/${encodeURIComponent(supplierId)}`,
      null,
      { withCredentials: true }
    )
    .then((res) => res.status)

/**
 * Fetch the agency stamp image through the authenticated axios instance
 * and return a blob URL (GA-PAR-14).
 *
 * @param {string} supplierId
 * @returns {Promise<string>}
 */
export const fetchStampUrl = async (supplierId: string): Promise<string> => {
  const res = await axiosInstance.get(`/api/supplier-stamp/${encodeURIComponent(supplierId)}`, { withCredentials: true, responseType: 'blob' })
  return URL.createObjectURL(res.data as Blob)
}

/**
 * Delete a Supplier.
 *
 * @param {string} id
 * @returns {Promise<number>}
 */
export const deleteSupplier = (id: string): Promise<number> =>
  axiosInstance
    .delete(
      `/api/delete-supplier/${encodeURIComponent(id)}`,
      { withCredentials: true }
    )
    .then((res) => res.status)

/**
 * Get a Supplier by ID.
 *
 * @param {string} id
 * @returns {Promise<bookcarsTypes.User>}
 */
export const getSupplier = (id: string): Promise<bookcarsTypes.User> =>
  axiosInstance
    .get(
      `/api/supplier/${encodeURIComponent(id)}`,
      { withCredentials: true }
    )
    .then((res) => res.data)

/**
 * Get Suppliers.
 *
 * @param {string} keyword
 * @param {number} page
 * @param {number} size
 * @returns {Promise<bookcarsTypes.Result<bookcarsTypes.User>>}
 */
export const getSuppliers = (keyword: string, page: number, size: number): Promise<bookcarsTypes.Result<bookcarsTypes.User>> =>
  axiosInstance
    .get(
      `/api/suppliers/${page}/${size}/?s=${encodeURIComponent(keyword)}`,
      { withCredentials: true }
    )
    .then((res) => res.data)

/**
 * Get all Suppliers.
 *
 * @returns {Promise<bookcarsTypes.User[]>}
 */
export const getAllSuppliers = (): Promise<bookcarsTypes.User[]> =>
  axiosInstance
    .get(
      '/api/all-suppliers',
      { withCredentials: true }
    )
    .then((res) => res.data)

/**
* Get admin suppliers.
*
* @param {bookcarsTypes.GetCarsPayload} data
* @returns {Promise<bookcarsTypes.User[]>}
*/
export const getAdminSuppliers = (data: bookcarsTypes.GetCarsPayload): Promise<bookcarsTypes.User[]> =>
  axiosInstance
    .post(
      '/api/admin-suppliers',
      data,
      { withCredentials: true }
    ).then((res) => res.data)

/**
* Create temporary contract.
*
* @param {string} language
* @param {Blob} file
* @returns {Promise<string>}
*/
export const createContract = (language: string, file: Blob): Promise<string> => {
  const formData = new FormData()
  formData.append('file', file)

  return axiosInstance
    .post(
      `/api/create-contract/${language}`,
      formData,
      {
        withCredentials: true,
        headers: { 'Content-Type': 'multipart/form-data' }
      },
    )
    .then((res) => res.data)
}

/**
 * Update contract.
 *
 * @param {string} supplierId
 * @param {string} language
 * @param {Blob} file
 * @returns {Promise<bookcarsTypes.Response<string>>}
 */
export const updateContract = (supplierId: string, language: string, file: Blob): Promise<bookcarsTypes.Response<string>> => {
  const formData = new FormData()
  formData.append('file', file)

  return axiosInstance
    .post(
      `/api/update-contract/${supplierId}/${language}`,
      formData,
      {
        withCredentials: true,
        headers: { 'Content-Type': 'multipart/form-data' }
      },
    )
    .then((res) => ({ status: res.status, data: res.data }))
}

/**
 * Delete contract.
 *
 * @param {string} supplierId
 * @param {string} language
 * @returns {Promise<number>}
 */
export const deleteContract = (supplierId: string, language: string): Promise<number> =>
  axiosInstance
    .post(
      `/api/delete-contract/${supplierId}/${language}`,
      null,
      { withCredentials: true }
    )
    .then((res) => res.status)

/**
* Delete a temporary contract file.
*
* @param {string} file
* @returns {Promise<number>}
*/
export const deleteTempContract = (file: string): Promise<number> =>
  axiosInstance
    .post(
      `/api/delete-temp-contract/${encodeURIComponent(file)}`,
      null,
      { withCredentials: true }
    )
    .then((res) => res.status)
