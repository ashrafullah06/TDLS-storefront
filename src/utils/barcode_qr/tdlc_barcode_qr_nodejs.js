// src/utils/barcode_qr/tdlc_barcode_qr_nodejs.js
// Node.js: Barcode & QR Code Generator for TDLC (ESM imports)

import QRCode from "qrcode";
import BWIPJS from "bwip-js";
import fs from "fs";

/** Generate a QR PNG file from data */
export async function generateQrToFile(filename, data) {
  await QRCode.toFile(filename, data);
}

/** Generate a Code128 barcode PNG file from text */
export async function generateBarcodeToFile(filename, text) {
  return new Promise((resolve, reject) => {
    BWIPJS.toBuffer(
      {
        bcid: "code128",
        text,
        scale: 3,
        height: 10,
        includetext: true,
      },
      (err, png) => {
        if (err) return reject(err);
        fs.writeFileSync(filename, png);
        resolve();
      }
    );
  });
}

/** Demo (opt-in via env var; avoids side effects on build) */
if (process.env.RUN_TDLC_BARCODE_DEMO === "1") {
  (async () => {
    await generateQrToFile("qr.png", "https://www.thednalabstore.com/order/ORD-2025-001");
    await generateBarcodeToFile("barcode.png", "ORD-2025-001|TS-001");
    console.log("Demo QR and barcode generated.");
  })().catch((e) => {
    console.error("Barcode/QR demo failed:", e);
  });
}
