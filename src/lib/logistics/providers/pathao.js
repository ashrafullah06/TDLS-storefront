// lib/logistics/providers/pathao.js
import { must, http } from "../../logistics/utils";

const BASE = () => must("PATHAO_BASE_URL"); // e.g. https://hermes-api.p-stageenv.xyz/aladdin/api/v1  :contentReference[oaicite:10]{index=10}

let tokenCache = { access_token: null, exp: 0 };

async function token() {
  const now = Date.now();
  if (tokenCache.access_token && now < tokenCache.exp - 30_000) return tokenCache.access_token;

  const url = `${BASE()}/issue-token`; // standard Pathao “issue-token”
  const body = {
    client_id: must("PATHAO_CLIENT_ID"),
    client_secret: must("PATHAO_CLIENT_SECRET"),
    username: must("PATHAO_USERNAME"),
    password: must("PATHAO_PASSWORD"),
  };
  const data = await http(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const at = data?.access_token || data?.data?.access_token;
  const expiresIn = data?.expires_in ?? 3600;
  if (!at) throw new Error("Pathao token missing in response");
  tokenCache = { access_token: at, exp: Date.now() + expiresIn * 1000 };
  return at;
}

function authHdr(t) { return { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }; }

export const pathao = {
  async createLabel(payload) {
    const t = await token();
    // Pathao create order fields (store_id, merchant_order_id, recipient/addr + city_id/zone_id/area_id etc.)  :contentReference[oaicite:11]{index=11}
    return http(`${BASE()}/orders`, { method: "POST", headers: authHdr(t), body: JSON.stringify(payload) });
  },
  async track({ consignment_id }) {
    const t = await token();
    return http(`${BASE()}/orders/${encodeURIComponent(consignment_id)}`, { headers: authHdr(t) });
  },
  cities: async () => http(`${BASE()}/cities`, { headers: { "Content-Type": "application/json" } }), // get_city_list  :contentReference[oaicite:12]{index=12}
  zones: async (city_id) => http(`${BASE()}/zones?city_id=${encodeURIComponent(city_id)}`, { headers: { "Content-Type": "application/json" } }), // get_zone_list  :contentReference[oaicite:13]{index=13}
  areas: async (zone_id) => http(`${BASE()}/areas?zone_id=${encodeURIComponent(zone_id)}`, { headers: { "Content-Type": "application/json" } }), // get_area_list  :contentReference[oaicite:14]{index=14}
};
