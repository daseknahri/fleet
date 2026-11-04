import 'dotenv/config'
// globalSetup is loaded by Jest as a compiled Node module, outside the test transform.
import * as env from '../src/config/env.config.js'
import * as logger from '../src/utils/logger.js'
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
