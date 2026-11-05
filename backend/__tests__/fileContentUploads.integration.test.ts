import 'dotenv/config'
import request from 'supertest'
import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import app from '../src/app'
import * as databaseHelper from '../src/utils/databaseHelper'
import * as authHelper from '../src/utils/authHelper'
import * as env from '../src/config/env.config'
import User from '../src/models/User'

// GA-P2-SEC-FIX-01 (finding F-SEC-2): live HTTP proof that every raw-upload
// endpoint now validates file content against the extension, not just the
// extension itself. The maintenance receipt endpoint is covered by the P0
// suite (maintenanceReceiptSchedule.integration.test.ts); this standalone
// suite covers avatar, license, supplier contract, car image and location
// image. It is intentionally NOT part of the P0 gate list.
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const userIds: mongoose.Types.ObjectId[] = []
let token = ''

const text = Buffer.from('GA-P2-SEC-FIX-01 plain text spoof payload')
const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52])
const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01])
const pdfBytes = Buffer.from('%PDF-1.4 GA-P2-SEC-FIX-01 synthetic document')

beforeAll(async () => {
  await databaseHelper.connect(env.DB_URI, false, false)
  const supplier = await new User({ email: `ga-q5-uploads-${suffix}@test.bookcars.ma`, fullName: 'GA Q5 Uploads', language: 'en', type: bookcarsTypes.UserType.Supplier, active: true, verified: true, blacklisted: false, payLater: true }).save()
  userIds.push(supplier._id)
  token = await authHelper.encryptJWT({ id: supplier._id.toString() })
})

afterAll(async () => {
  await User.deleteMany({ _id: { $in: userIds } })
  await databaseHelper.close()
})

describe('F-SEC-2 content validation on raw-upload endpoints', () => {
  it('avatar: spoofed text .png rejected, real PNG accepted and cleaned up', async () => {
    const spoof = await request(app).post('/api/create-avatar').set(env.X_ACCESS_TOKEN, token)
      .attach('image', text, { filename: 'avatar.png', contentType: 'image/png' })
    expect(spoof.status).toBe(400)
    const ok = await request(app).post('/api/create-avatar').set(env.X_ACCESS_TOKEN, token)
      .attach('image', pngBytes, { filename: 'avatar.png', contentType: 'image/png' })
    expect(ok.status).toBe(200)
    const removed = await request(app).post(`/api/delete-temp-avatar/${ok.body}`).set(env.X_ACCESS_TOKEN, token)
    expect(removed.status).toBe(200)
  })

  it('license: spoofed text .pdf rejected, real PDF and real PNG accepted and cleaned up', async () => {
    const spoof = await request(app).post('/api/create-license')
      .attach('file', text, { filename: 'license.pdf', contentType: 'application/pdf' })
    expect(spoof.status).toBe(400)
    const okPdf = await request(app).post('/api/create-license')
      .attach('file', pdfBytes, { filename: 'license.pdf', contentType: 'application/pdf' })
    expect(okPdf.status).toBe(200)
    const removedPdf = await request(app).post(`/api/delete-temp-license/${okPdf.body}`)
    expect(removedPdf.status).toBe(200)
    const okPng = await request(app).post('/api/create-license')
      .attach('file', pngBytes, { filename: 'license.png', contentType: 'image/png' })
    expect(okPng.status).toBe(200)
    const removedPng = await request(app).post(`/api/delete-temp-license/${okPng.body}`)
    expect(removedPng.status).toBe(200)
  })

  it('supplier contract: spoofed text .pdf rejected, real PDF accepted and cleaned up', async () => {
    const spoof = await request(app).post('/api/create-contract/en').set(env.X_ACCESS_TOKEN, token)
      .attach('file', text, { filename: 'contract.pdf', contentType: 'application/pdf' })
    expect(spoof.status).toBe(400)
    const ok = await request(app).post('/api/create-contract/en').set(env.X_ACCESS_TOKEN, token)
      .attach('file', pdfBytes, { filename: 'contract.pdf', contentType: 'application/pdf' })
    expect(ok.status).toBe(200)
    const removed = await request(app).post(`/api/delete-temp-contract/${ok.body}`).set(env.X_ACCESS_TOKEN, token)
    expect(removed.status).toBe(200)
  })

  it('car image: spoofed text .png rejected, real JPEG accepted and cleaned up', async () => {
    const spoof = await request(app).post('/api/create-car-image').set(env.X_ACCESS_TOKEN, token)
      .attach('image', text, { filename: 'car.png', contentType: 'image/png' })
    expect(spoof.status).toBe(400)
    const ok = await request(app).post('/api/create-car-image').set(env.X_ACCESS_TOKEN, token)
      .attach('image', jpegBytes, { filename: 'car.jpg', contentType: 'image/jpeg' })
    expect(ok.status).toBe(200)
    const removed = await request(app).post(`/api/delete-temp-car-image/${ok.body}`).set(env.X_ACCESS_TOKEN, token)
    expect(removed.status).toBe(200)
  })

  it('location image: spoofed text .png rejected, real PNG accepted and cleaned up', async () => {
    const spoof = await request(app).post('/api/create-location-image').set(env.X_ACCESS_TOKEN, token)
      .attach('image', text, { filename: 'location.png', contentType: 'image/png' })
    expect(spoof.status).toBe(400)
    const ok = await request(app).post('/api/create-location-image').set(env.X_ACCESS_TOKEN, token)
      .attach('image', pngBytes, { filename: 'location.png', contentType: 'image/png' })
    expect(ok.status).toBe(200)
    const removed = await request(app).post(`/api/delete-temp-location-image/${ok.body}`).set(env.X_ACCESS_TOKEN, token)
    expect(removed.status).toBe(200)
  })
})
