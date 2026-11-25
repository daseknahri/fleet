import 'dotenv/config'
import { jest } from '@jest/globals'
import request from 'supertest'
import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../src/config/env.config'
import * as databaseHelper from '../src/utils/databaseHelper'
import * as authHelper from '../src/utils/authHelper'
import User from '../src/models/User'
import PushToken from '../src/models/PushToken'

// GH-23 - dead push tokens are never cleaned up: prune after N = 3
// consecutive failures, at once on DeviceNotRegistered, and
// re-registration upserts (heals) instead of 400ing.
//
// Expo is mocked with jest.unstable_mockModule (the same mechanism
// the Wave 3.2 reminder tests use - not a new library): booking.test.ts
// lets the Expo send hit the live network and only tolerates the
// outcome, which cannot prove a DeviceNotRegistered prune
// deterministically. The malformed-token half never reaches the
// network at all.

const expoSendMock: any = jest.fn(async () => [{ status: 'ok', id: 'mock-ticket-1' }])

jest.unstable_mockModule('expo-server-sdk', () => ({
  Expo: class MockExpo {
    static isExpoPushToken(token: string) {
      return typeof token === 'string' && token.startsWith('ExponentPushToken[') && token.endsWith(']')
    }

    chunkPushNotifications(messages: any[]) {
      return [messages]
    }

    async sendPushNotificationsAsync(chunk: any[]) {
      return expoSendMock(chunk)
    }
  },
}))

let app: any
let sendPush: (user: any, message: string, reminderId: any) => Promise<boolean>

const rand = () => Math.random().toString(36).slice(2)

const fixtureUserIds: mongoose.Types.ObjectId[] = []

let adminId: string
let adminToken: string
let user: any

beforeAll(async () => {
  ;({ default: app } = await import('../src/app'))
  ;({ sendPush } = await import('../src/utils/reminderNotify'))
  await databaseHelper.connect(env.DB_URI, false, false)
  const passwordHash = await authHelper.hashPassword('Un1tTest5')
  const admin = await User.create({
    fullName: 'gh23-admin', email: `gh23-admin-${rand()}@test.bookcars.ma`, language: 'en',
    password: passwordHash, type: bookcarsTypes.UserType.Admin, active: true, verified: true, blacklisted: false,
  })
  adminId = admin._id.toString()
  adminToken = await authHelper.encryptJWT({ id: adminId })

  user = await User.create({
    email: `gh23-user-${rand()}@test.bookcars.ma`, fullName: 'GH-23 User',
    language: 'en', type: bookcarsTypes.UserType.User,
    active: true, verified: true, blacklisted: false,
  })
  fixtureUserIds.push(user._id)
})

afterEach(async () => {
  await PushToken.deleteMany({ user: user._id })
  jest.resetAllMocks()
  expoSendMock.mockResolvedValue([{ status: 'ok', id: 'mock-ticket-1' }])
})

afterAll(async () => {
  await PushToken.deleteMany({ user: user._id })
  await User.deleteMany({ _id: { $in: fixtureUserIds } })
  await User.deleteOne({ _id: adminId })
  await databaseHelper.close()
})

describe('GH-23 dead push token cleanup', () => {
  it('prunes a malformed token after 3 consecutive failures, not after 1', async () => {
    await PushToken.create({ user: user._id, token: '0' } as any)

    expect(await sendPush(user, 'test', undefined)).toBe(false)
    let row = await PushToken.findOne({ user: user._id }).lean()
    expect(row).toBeTruthy()
    expect(row?.consecutiveFailures).toBe(1)
    expect(row?.lastFailureReason).toBe('Not a valid Expo push token.')

    expect(await sendPush(user, 'test', undefined)).toBe(false)
    row = await PushToken.findOne({ user: user._id }).lean()
    expect(row?.consecutiveFailures).toBe(2)

    expect(await sendPush(user, 'test', undefined)).toBe(false)
    expect(await PushToken.findOne({ user: user._id }).lean()).toBeNull()
  })

  it('prunes on the first DeviceNotRegistered ticket', async () => {
    expoSendMock.mockResolvedValue([{ status: 'error', message: 'DeviceNotRegistered', details: { error: 'DeviceNotRegistered' } }])
    await PushToken.create({ user: user._id, token: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]' } as any)

    expect(await sendPush(user, 'test', undefined)).toBe(false)
    expect(await PushToken.findOne({ user: user._id }).lean()).toBeNull()
  })

  it('a successful send resets the failure counter', async () => {
    await PushToken.create({ user: user._id, token: 'ExponentPushToken[yyyyyyyyyyyyyyyyyyyyyy]', consecutiveFailures: 2 } as any)

    expect(await sendPush(user, 'test', undefined)).toBe(true)
    const row = await PushToken.findOne({ user: user._id }).lean()
    expect(row).toBeTruthy()
    expect(row?.consecutiveFailures).toBe(0)
  })

  it('re-registration upserts and resets the counter', async () => {
    const tokenA = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]'
    const tokenB = 'ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]'
    let res = await request(app)
      .post(`/api/create-push-token/${user._id}/${encodeURIComponent(tokenA)}`)
      .set(env.X_ACCESS_TOKEN, adminToken)
    expect(res.statusCode).toBe(200)
    let row = await PushToken.findOne({ user: user._id }).lean()
    expect(row?.token).toBe(tokenA)

    await PushToken.updateOne({ user: user._id }, { $set: { consecutiveFailures: 2 } })
    res = await request(app)
      .post(`/api/create-push-token/${user._id}/${encodeURIComponent(tokenB)}`)
      .set(env.X_ACCESS_TOKEN, adminToken)
    expect(res.statusCode).toBe(200)
    row = await PushToken.findOne({ user: user._id }).lean()
    expect(row?.token).toBe(tokenB)
    expect(row?.consecutiveFailures || 0).toBe(0)
  })
})
