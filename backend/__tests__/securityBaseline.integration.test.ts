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
    // Baseline amended 2026-11-05 (GA-P10-DECISIONS-01, F-SEC-4): the owner
    // decided a CORS denial is a clean 403, not a 500 server error. This
    // expectation was 500 before the amendment.
    expect(response.status).toBe(403)
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN')
  })
})
