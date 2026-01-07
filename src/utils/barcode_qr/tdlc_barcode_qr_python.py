
# Python: Barcode & QR Generator for TDLC

# pip install qrcode[pil] python-barcode
import qrcode
import barcode
from barcode.writer import ImageWriter

# QR code for order
img = qrcode.make('https://www.thednalabstore.com/order/ORD-2025-001')
img.save('qr.png')

# Barcode for order+SKU
Code128 = barcode.get_barcode_class('code128')
code = Code128('ORD-2025-001|TS-001', writer=ImageWriter())
code.save('barcode')
