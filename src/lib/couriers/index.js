import { redxCreateShipment } from "./redx";
import { pathaoCreateShipment } from "./pathao";
import { paperflyCreateShipment } from "./paperfly";

export async function createShipment(courierCode, args) {
  switch (courierCode) {
    case "REDX":
      return redxCreateShipment(args);
    case "PATHAO":
      return pathaoCreateShipment(args);
    case "PAPERFLY":
      return paperflyCreateShipment(args);
    default:
      throw new Error("unsupported_courier");
  }
}
