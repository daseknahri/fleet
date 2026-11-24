import 'dotenv/config'
import request from 'supertest'
import * as env from '../src/config/env.config'
import app from '../src/app'
import * as databaseHelper from '../src/utils/databaseHelper'
import * as testHelper from './testHelper'
import * as helper from '../src/utils/helper'
import mongoose from 'mongoose'

//
// F-10 — a malformed body on an API route must answer a usable JSON 400
// WITH CORS headers (the audit: a literal JSON null body on the
// customer-cancel endpoint returned 400 "Internal Error" as text/html
// with no CORS headers, so the browser reported "Failed to fetch").
//

// The customer-cancel endpoint (bookingRoutes.config.ts).
const CANCEL_URL = `/api/cancel-booking/${new mongoose.Types.ObjectId().toString()}`
// A whitelisted origin (the admin host) so the CORS middleware reflects it.
const ORIGIN = helper.trimEnd(env.ADMIN_HOST, '/')

beforeAll(async () => {
  testHelper.initializeLogger()

  await databaseHelper.connect(env.DB_URI, false, false)
  await testHelper.initialize()
})

afterAll(async () => {
  await databaseHelper.close()
})

describe('F-10 / malformed request body', () => {
  test('a literal JSON null body gets a JSON 400 with CORS headers', async () => {
    const res = await request(app)
      .post(CANCEL_URL)
      .set('Origin', ORIGIN)
      .set('Content-Type', 'application/json')
      .send('null')
    expect(res.statusCode).toBe(400)
    expect(res.headers['content-type']).toContain('application/json')
    expect(res.body.message).toBe('Invalid request body')
    expect(res.text).not.toContain('Internal Error')
    expect(res.headers['access-control-allow-origin']).toBeTruthy()
  })

  test('malformed JSON gets the same JSON 400 with CORS headers', async () => {
    const res = await request(app)
      .post(CANCEL_URL)
      .set('Origin', ORIGIN)
      .set('Content-Type', 'application/json')
      .send('{bad json')
    expect(res.statusCode).toBe(400)
    expect(res.headers['content-type']).toContain('application/json')
    expect(res.body.message).toBe('Invalid request body')
    expect(res.headers['access-control-allow-origin']).toBeTruthy()
  })

  test('a well-formed empty body still reaches the route (403, no token)', async () => {
    const res = await request(app)
      .post(CANCEL_URL)
      .set('Origin', ORIGIN)
      .set('Content-Type', 'application/json')
      .send('{}')
    // Not a parser 400: the body parsed, the request reached auth
    // (verifyToken refuses a missing token with 403).
    expect(res.statusCode).toBe(403)
    expect(res.headers['access-control-allow-origin']).toBeTruthy()
  })
})
