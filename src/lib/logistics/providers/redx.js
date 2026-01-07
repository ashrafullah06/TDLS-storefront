// lib/logistics/providers/redx.js
import { must, http } from "../../logistics/utils";

// REDX uses a merchant access token (Bearer) and OpenAPI endpoints.  :contentReference[oaicite:15]{index=15}
const BASE = () => must("REDX_BASE_URL"); // e.g., https://openapi.redx.com.bd/v1.0.0-beta

function hdr() { return { Authorization: `Bearer ${must("REDX_ACCESS_TOKEN")}`, "Content-Type": "application/json" }; }

export const redx = {
  async createLabel(payload) {
    // Create parcel (Redx wording “parcel”)
    return http(`${BASE()}/parcel`, { method: "POST", headers: hdr(), body: JSON.stringify(payload) });
  },
  async track({ tracking_id }) {
    return http(`${BASE()}/parcel/track/${encodeURIComponent(tracking_id)}`, { headers: hdr() });
  },
  // REDX also exposes area list, store APIs per their SDK features (area, store, order).  :contentReference[oaicite:16]{index=16}
};
