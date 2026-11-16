import 'dotenv/config'
// globalSetup is loaded by Jest as a compiled Node module, outside the test transform.
import * as env from '../src/config/env.config.js'
import * as logger from '../src/utils/logger.js'
import mongoose from 'mongoose'
import * as databaseHelper from '../src/utils/databaseHelper.js'
import User from '../src/models/User.js'
import * as authHelper from '../src/utils/authHelper.js'

export default async function globalSetup() {
  try {
    //
    // create admin from env if not found
    //
    if (env.ADMIN_EMAIL) {
      await databaseHelper.connect(env.DB_URI, false, false)
      // F8 / D-QA-1 — test isolation: the Admin aggregate assertions
      // (dashboardF8) are exact only on a clean test DB, and every suite
      // cleans only its own fixtures by exact ID in afterAll, so residue
      // from earlier runs polluted the aggregates (contractAmount
      // 1500 -> 3745, overdue 1000 -> 10599, fleet total 4 -> 15).
      // Drop the test database once per Jest run, before the admin user
      // is (re)created. Refused under NODE_ENV=production so a test run
      // can never wipe a live database; a drop failure is logged and the
      // run continues (admin creation must not be skipped because of it).
      if (process.env.NODE_ENV === 'production') {
        logger.error('globalSetup: refusing to drop the database under NODE_ENV=production')
      } else {
        try {
          await mongoose.connection.dropDatabase()
          logger.info(`globalSetup: dropped test database ${mongoose.connection.name}`)
        } catch (dropErr) {
          logger.error('globalSetup: failed to drop the test database, continuing with existing data', dropErr)
        }
      }
      const adminFromEnv = await User.findOne({ email: env.ADMIN_EMAIL })
      if (!adminFromEnv) {
        const passwordHash = await authHelper.hashPassword('Un1tTest5')
        const admin = new User({
          fullName: 'admin',
          email: env.ADMIN_EMAIL,
          language: 'en',
          password: passwordHash,
          type: 'admin',
        })
        await admin.save()
        logger.info('globalSetup: Admin user created:', admin._id.toString())
      }
      await databaseHelper.close()
    }
  } catch (err) {
    logger.error('Error while running global setup', err)
  }
}
