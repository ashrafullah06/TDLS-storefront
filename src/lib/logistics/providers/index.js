// lib/logistics/providers/index.js
import { ecourier } from "./ecourier";
import { pathao } from "./pathao";
import { redx } from "./redx";
import { steadfast } from "./steadfast";
import { paperfly } from "./paperfly";

export const providers = { ecourier, pathao, redx, steadfast, paperfly };
export const supported = Object.keys(providers);
