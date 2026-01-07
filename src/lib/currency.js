// PATH: src/lib/currency.js
export const money = (n) =>
  Number(n ?? 0).toLocaleString("en-BD", {
    style: "currency",
    currency: "BDT",
    maximumFractionDigits: 2,
  });
