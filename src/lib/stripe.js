// FILE: src/lib/stripe.js
import Stripe from "stripe";

let _stripe = null;

export default function getStripe() {
  if (_stripe) return _stripe;

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return null; // Stripe disabled / not configured

  _stripe = new Stripe(secretKey);
  return _stripe;
}
