import 'dotenv/config'
import request from 'supertest'
import app from '../src/app'

describe('security baseline', () => {
  test('rejects TRACE and unauthenticated protected reports', async () => {
    const trace = await request(app).trace('/api/reports/summary')
    expect(trace.status).toBe(405)
    const reports = await request(app).get('/api/reports/summary')
    expect(reports.status).toBe(403)
  })

  test('returns security headers and rejects an untrusted CORS origin', async () => {
    const response = await request(app).get('/api/reports/summary').set('Origin', 'https://untrusted.example')
    expect(response.status).toBe(500)
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN')
  })
})
