// FILE: my-project/src/components/common/stocknotify.jsx
"use client";
import { useState } from "react";

export default function StockNotify({ productId }) {
  const [email, setEmail] = useState("");
  const [subscribed, setSubscribed] = useState(false);
  const [error, setError] = useState("");

  async function handleSubscribe(e) {
    e.preventDefault();
    setError("");
    if (!email.match(/^[^@\s]+@[^@\s]+\.[^@\s]+$/)) {
      setError("Please enter a valid email.");
      return;
    }
    // Replace this with your real API call!
    await new Promise((res) => setTimeout(res, 1000));
    setSubscribed(true);
  }

  if (subscribed) {
    return (
      <div className="bg-green-100 border border-green-300 rounded-lg px-6 py-4 text-green-800 font-semibold text-center">
        You&apos;ll be notified as soon as this item is back in stock!
      </div>
    );
  }

  return (
    <form onSubmit={handleSubscribe} className="bg-yellow-50 border border-yellow-200 rounded-lg px-6 py-6">
      <div className="font-semibold text-yellow-900 mb-2">
        Out of stock? Get notified when it’s available.
      </div>
      <div className="flex items-center gap-4">
        <input
          type="email"
          value={email}
          required
          onChange={e => setEmail(e.target.value)}
          className="border border-yellow-300 rounded-md px-4 py-2 text-base"
          placeholder="Your email address"
        />
        <button className="btn btn-primary px-5 py-2" type="submit">
          Notify Me
        </button>
      </div>
      {error && <div className="text-red-600 mt-2">{error}</div>}
    </form>
  );
}
