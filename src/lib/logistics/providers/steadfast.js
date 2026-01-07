// lib/logistics/providers/steadfast.js
import { must, http } from "../../logistics/utils";

// Official package documents base & credentials.  :contentReference[oaicite:17]{index=17}
const BASE = () => must("STEADFAST_BASE_URL");

function hdr() {
  return {
    "Api-Key": must("STEADFAST_API_KEY"),
    "Secret-Key": must("STEADFAST_SECRET_KEY"),
    "Content-Type": "application/json",
  };
}

export const steadfast = {
  async createLabel(payload) {
    // “place order” — the Laravel package wraps this; HTTP is POST /create-order   :contentReference[oaicite:18]{index=18}
    return http(`${BASE()}/create-order`, { method: "POST", headers: hdr(), body: JSON.stringify(payload) });
  },
  async track({ tracking_code }) {
    // Check status by tracking code (per package docs)   :contentReference[oaicite:19]{index=19}
    return http(`${BASE()}/status-by-tracking-code/${encodeURIComponent(tracking_code)}`, { headers: hdr() });
  },
};
