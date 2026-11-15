const routes = {
  createCheckoutSession: '/api/create-checkout-session',
  checkCheckoutSession: '/api/check-checkout-session/:sessionId',
  createPaymentIntent: '/api/create-payment-intent',
  // F2 / W4 GAP-04: Stripe webhook endpoint. Mounted in app.ts (not in
  // stripeRoutes) because signature verification needs the raw request
  // body, before the global JSON parser consumes the stream.
  webhook: '/api/stripe/webhook',
}

export default routes
