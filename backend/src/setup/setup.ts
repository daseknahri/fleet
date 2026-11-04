import 'dotenv/config'
import fs from 'node:fs'
import asyncFs from 'node:fs/promises'
import path from 'node:path'
import url from 'node:url'
import * as bookcarsTypes from ':bookcars-types'
import * as env from '../config/env.config'
import * as databaseHelper from '../utils/databaseHelper'
import * as helper from '../utils/helper'
import User from '../models/User'
import * as logger from '../utils/logger'
import * as authHelper from '../utils/authHelper'

const DEFAULT_USER_AVATARS = ['avatar.jpg', 'customer.png', 'supplier.png']

const resolveSeedImage = (filename: string): string | null => {
  const currentDir = path.dirname(url.fileURLToPath(import.meta.url))
  const candidates = [
    path.resolve(currentDir, '../../scripts/img', filename),
    path.resolve(currentDir, '../../../scripts/img', filename),
    path.resolve(process.cwd(), 'scripts/img', filename),
    path.resolve(process.cwd(), 'backend/scripts/img', filename),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }
  return null
}

//
// The CDN users directory is a Docker volume and starts empty, so the default supplier.png,
// customer.png and avatar.jpg images referenced by seeded accounts would otherwise return 404
// and be blocked by browsers. Install the shared defaults once, without overwriting uploads.
//
const ensureDefaultUserAvatars = async () => {
  await helper.mkdir(env.CDN_USERS)
  for (const filename of DEFAULT_USER_AVATARS) {
    const target = path.join(env.CDN_USERS, filename)
    if (await helper.pathExists(target)) {
      continue
    }
    const source = resolveSeedImage(filename)
    if (!source) {
      logger.warn(`Default user avatar ${filename} source not found.`)
      continue
    }
    await asyncFs.copyFile(source, target)
    logger.info(`Installed default user avatar: ${filename}`)
  }
}

try {
  await ensureDefaultUserAvatars()

  const connected = await databaseHelper.connect(env.DB_URI, env.DB_SSL, env.DB_DEBUG)

  if (!connected) {
    logger.error('Failed to connect to the database')
    process.exit(1)
  }

  // create admin user if it doesn't exist
  const adminUser = await User.findOne({ email: env.ADMIN_EMAIL })

  if (!adminUser) {
    const password = 'B00kC4r5'
    const passwordHash = await authHelper.hashPassword(password)

    const newAdmin = new User({
      fullName: 'admin',
      email: env.ADMIN_EMAIL,
      password: passwordHash,
      language: env.DEFAULT_LANGUAGE,
      type: bookcarsTypes.UserType.Admin,
      active: true,
      verified: true,
    })
    await newAdmin.save()
    logger.info('Admin user created successfully')
  } else {
    logger.info('Admin user already exists')
  }
  process.exit(0)
} catch (err) {
  logger.error('Error during setup:', err)
  process.exit(1)
}
