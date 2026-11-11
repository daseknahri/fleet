import type { Request, Response, NextFunction } from 'express'
import redis from '../config/redis'
import * as env from '../config/env.config'

const TOKEN_BUCKET_LUA = `
  local key = KEYS[1]
  local capacity = tonumber(ARGV[1])
  local refillRateMs = tonumber(ARGV[2])
  local now = tonumber(ARGV[3])

  local data = redis.call('HMGET', key, 'tokens', 'lastTime')
  local tokens = tonumber(data[1])
  local lastTime = tonumber(data[2])

  if not tokens then
    tokens = capacity
    lastTime = now
  else
    local timePassed = now - lastTime
    local tokensToAdd = math.floor(timePassed / refillRateMs)
    if tokensToAdd > 0 then
      tokens = math.min(capacity, tokens + tokensToAdd)
      lastTime = lastTime + (tokensToAdd * refillRateMs)
    end
  end

  if tokens > 0 then
    tokens = tokens - 1
    redis.call('HMSET', key, 'tokens', tokens, 'lastTime', lastTime)
    redis.call('EXPIRE', key, 3600) 
    return {1, tokens}
  else
    redis.call('HMSET', key, 'tokens', tokens, 'lastTime', lastTime)
    redis.call('EXPIRE', key, 3600)
    return {0, tokens}
  end
`

const isTest = env.CI

const createRateLimiter = (
  scope: string,
  capacity: number = env.RATE_LIMIT_CAPACITY,
  refillRateMs: number = env.RATE_LIMIT_REFILL_RATE_MS,
) => async (req: Request, res: Response, next: NextFunction) => {
  if (isTest && !req.headers['x-test-rate-limit']) {
    return next()
  }

  const ip = req.ip || req.socket.remoteAddress || '127.0.0.1'
  const redisKey = `ratelimit:${scope}:${ip}`
  const now = Date.now()

  try {
    const result = (await redis.eval(
      TOKEN_BUCKET_LUA,
      1,
      redisKey,
      capacity,
      refillRateMs,
      now
    )) as [number, number]

    const allowed = result[0] === 1
    const remainingTokens = result[1]

    res.setHeader('RateLimit-Limit', capacity)
    res.setHeader('RateLimit-Remaining', remainingTokens)

    if (allowed) {
      return next()
    }

    return res.status(429).json({
      message: 'Too many requests, please try again later.',
    })
  } catch {
    return next()
  }
}

// Default scope guards the authentication endpoints; its Redis key layout
// (ratelimit:auth:<ip>) and behaviour are unchanged.
export const rateLimiter = createRateLimiter('auth')

// Separate bucket for the public contact-form mail endpoint, so mail abuse
// cannot drain the sign-in bucket of the same IP (and vice versa).
export const mailRateLimiter = createRateLimiter('mail')

// GA-PAR-12: the public online-signing surface is unauthenticated by
// design (the capability token is the credential), so it gets its OWN
// stricter buckets — separate Redis scopes, so signing traffic can
// never drain the auth/mail buckets of the same IP (and vice versa),
// and no staff route is throttled by these limiters. Token-bucket
// mapping of the shipped budgets: GET summary = burst 30, then one
// token per 30 s (a sustained 30 per 15 min per IP); POST sign =
// burst 10, then one token per 90 s (a sustained 10 per 15 min per IP).
export const signGetRateLimiter = createRateLimiter('sign-get', 30, 30000)
export const signPostRateLimiter = createRateLimiter('sign-post', 10, 90000)

export default rateLimiter
