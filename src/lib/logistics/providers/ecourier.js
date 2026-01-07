// lib/logistics/providers/ecourier.js
import { must, http } from "../../logistics/utils";

function hdr() {
  return {
    "API-KEY": must("ECOURIER_API_KEY"),
    "API-SECRET": must("ECOURIER_API_SECRET"),
    "USER-ID": must("ECOURIER_USER_ID"),
    "Content-Type": "application/json",
  };
}

const BASE = () => must("ECOURIER_BASE_URL"); // e.g., https://staging.ecourier.com.bd/api

export const ecourier = {
  async createLabel(payload) {
    // maps 1:1 to eCourier "order-place" spec
    // ref. Place Order: POST /order-place  :contentReference[oaicite:5]{index=5}
    const url = `${BASE()}/order-place`;
    return http(url, { method: "POST", headers: hdr(), body: JSON.stringify(payload) });
  },
  async track({ product_id, ecr }) {
    // POST /track  :contentReference[oaicite:6]{index=6}
    const url = `${BASE()}/track`;
    return http(url, { method: "POST", headers: hdr(), body: JSON.stringify({ product_id, ecr }) });
  },
  // meta endpoints
  cities: async () => http(`${BASE()}/city-list`, { method: "POST", headers: hdr(), body: "{}" }), // :contentReference[oaicite:7]{index=7}
  thanas: async (city) => http(`${BASE()}/thana-list`, { method: "POST", headers: hdr(), body: JSON.stringify({ city }) }), // :contentReference[oaicite:8]{index=8}
  areas: async (city, thana) => http(`${BASE()}/area-list`, { method: "POST", headers: hdr(), body: JSON.stringify({ city, thana }) }), // :contentReference[oaicite:9]{index=9}
};
