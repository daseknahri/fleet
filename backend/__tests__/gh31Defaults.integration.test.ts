import 'dotenv/config'
import mongoose from 'mongoose'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../src/config/env.config'
import * as databaseHelper from '../src/utils/databaseHelper'
import User from '../src/models/User'

// GH-31 — Morocco defaults: a user created with no `language` stores
// the DEFAULT_LANGUAGE (code default 'fr' when BC_DEFAULT_LANGUAGE is
// unset — the test harness loads backend/.env.docker, which sets it to
// 'en' locally; the Coolify value is a deploy-side step, pending #16).
// The same shape holds for TIMEZONE (code default Africa/Casablanca).

const rand = () => Math.random().toString(36).slice(2)

describe('GH-31 Morocco defaults', () => {
  test('a user created with no language stores the default language', async () => {
    await databaseHelper.connect(env.DB_URI, false, false)
    const user = await User.create({
      fullName: 'GH-31 User',
      email: `gh31-user-${rand()}@test.bookcars.ma`,
      type: bookcarsTypes.UserType.User,
    })
    expect(user.language).toBe(process.env.BC_DEFAULT_LANGUAGE || 'fr')
    await User.deleteOne({ _id: user._id })
    await databaseHelper.close()
  })

  test('backend timezone default is Africa/Casablanca when BC_TIMEZONE is unset', () => {
    expect(env.TIMEZONE).toBe(process.env.BC_TIMEZONE || 'Africa/Casablanca')
  })

  test('backend language default is fr when BC_DEFAULT_LANGUAGE is unset', () => {
    expect(env.DEFAULT_LANGUAGE).toBe(process.env.BC_DEFAULT_LANGUAGE || 'fr')
  })
})
