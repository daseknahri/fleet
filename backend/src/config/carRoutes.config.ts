const routes = {
  create: '/api/create-car',
  update: '/api/update-car',
  delete: '/api/delete-car/:id',
  // GA-PAR-22: trash / restore + the trash view's read path. Purge
  // reuses the existing delete route (trash precondition, §4.1).
  trash: '/api/trash-car/:id',
  restore: '/api/restore-car/:id',
  getTrashed: '/api/trashed-cars/:page/:size',
  trashWarning: '/api/cars/:id/trash-warning',
  validateLicensePlate: '/api/validate-license-plate/:licensePlate',
  validateCarLicensePlate: '/api/validate-license-plate/:id/:licensePlate',
  createImage: '/api/create-car-image',
  updateImage: '/api/update-car-image/:id',
  deleteImage: '/api/delete-car-image/:id',
  deleteTempImage: '/api/delete-temp-car-image/:image',
  // F5b (W2-14): gallery + car documents. The gallery lives in the
  // public cars store (like the cover); the documents live in the
  // private car-documents store (download via documentController).
  uploadCarImage: '/api/upload-car-image/:id',
  deleteCarImage: '/api/delete-car-gallery-image/:id/:file',
  uploadCarDocument: '/api/upload-car-document/:id',
  deleteCarDocument: '/api/delete-car-document/:id/:file',
  getCar: '/api/car/:id/:language',
  getCars: '/api/cars/:page/:size',
  getBookingCars: '/api/booking-cars/:page/:size',
  getFrontendCars: '/api/frontend-cars/:page/:size',
  checkCar: '/api/check-car/:id',
}

export default routes
