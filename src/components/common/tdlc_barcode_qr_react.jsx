
// React: Barcode & QR display for invoices/labels/etc.

// npm install react-qr-code @cheprasov/react-barcode
import QRCode from "react-qr-code";
import Barcode from "react-barcode";

export default function BarcodeQR({ order, sku }) {
  const qrUrl = `https://www.thednalabstore.com/order/${order}`;
  const codeText = `${order}|${sku}`;
  return (
    <div>
      <QRCode value={qrUrl} size={80} />
      <Barcode value={codeText} type="code128" width={2} height={40} />
    </div>
  );
}
