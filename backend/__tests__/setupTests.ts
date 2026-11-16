import { afterAll } from '@jest/globals'

// Cleanly close the Redis TCP socket after all tests finish
afterAll(async () => {
  // NOTE (L4d / F4 W1 #8): redis is imported LAZILY here, not at the
  // top of this file. A static import would load the real client
  // before any test file evaluates, and a later
  // jest.unstable_mockModule('../src/config/redis.js') (f4Lifecycle's
  // in-memory token bucket) cannot replace an already-loaded ESM
  // module - the limiter would keep the real client, fail open
  // against the unreachable host-side Redis, and the burst tests
  // would see 0x429. Lazy import keeps this teardown identical for
  // every suite (real client elsewhere, mock in f4) while letting
  // the mock win where it is registered.
  const { default: redis } = await import('../src/config/redis.js')
  try {
    await redis.quit()
  } catch {
    redis.disconnect()
  }
})
