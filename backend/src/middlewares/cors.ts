import cors from 'cors'
import * as helper from '../utils/helper'
import * as env from '../config/env.config'

const whitelist = [
  helper.trimEnd(env.ADMIN_HOST, '/'),
  helper.trimEnd(env.FRONTEND_HOST, '/'),
]

/**
 * CORS configuration.
 *
 * @type {cors.CorsOptions}
 */
const CORS_CONFIG: cors.CorsOptions = {
  origin(origin, callback) {
    if (!origin || whitelist.indexOf(helper.trimEnd(origin, '/')) !== -1) {
      callback(null, true)
    } else {
      // Unreachable in practice: the guard below denies foreign origins
      // first. Never raise here - an exception becomes a 500.
      callback(null, false)
    }
  },
  credentials: true,
  optionsSuccessStatus: 200, // some legacy browsers (IE11, various SmartTVs) choke on 204
}

/**
 * CORS middleware.
 *
 * @export
 * @returns {*}
 */
export default () => {
  const corsMiddleware = cors(CORS_CONFIG)
  return (req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => {
    // Owner decision F-SEC-4 (GA-P10-DECISIONS-01): a request from a
    // non-whitelisted origin is a clean 403 denial, not a 500 server
    // error (the previous origin-callback exception both produced the
    // 500 and polluted error monitoring). Requests without an Origin
    // header (API clients, tests) are unaffected.
    const origin = req.headers.origin
    if (origin && whitelist.indexOf(helper.trimEnd(origin, '/')) === -1) {
      res.sendStatus(403)
      return
    }
    corsMiddleware(req, res, next)
  }
}
