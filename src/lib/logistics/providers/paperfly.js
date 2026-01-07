// lib/logistics/providers/paperfly.js
import { must, http } from "../../logistics/utils";

// Paperfly PHP SDK shows username/password/key configuration and order fields.  :contentReference[oaicite:20]{index=20}
const BASE = () => must("PAPERFLY_BASE_URL");

function hdr() {
  return {
    "Content-Type": "application/json",
    "pf-username": must("PAPERFLY_USERNAME"),
    "pf-password": must("PAPERFLY_PASSWORD"),
    "pf-key": must("PAPERFLY_KEY"),
  };
}

export const paperfly = {
  async createLabel(payload) {
    // SDK’s create fields (merOrderRef, pickMerchantName, ..., custname, custPhone, etc.)  :contentReference[oaicite:21]{index=21}
    return http(`${BASE()}/order`, { method: "POST", headers: hdr(), body: JSON.stringify(payload) });
  },
  async track({ tracking_number }) {
    return http(`${BASE()}/order/track/${encodeURIComponent(tracking_number)}`, { headers: hdr() });
  },
};
