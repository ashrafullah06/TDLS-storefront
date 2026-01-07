// FILE: src/lib/stripe.js
import Stripe from "stripe";

let _stripe;

export default function stripe() {
  if (_stripe) return _stripe;

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("Missing STRIPE_SECRET_KEY");
  }

  _stripe = new Stripe(secretKey);
  return _stripe;
}
