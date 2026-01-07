// FILE: app/layout.js
import "@/styles/globals.css";
import OptionsProvider from "@/providers/optionsprovider";
import Providers from "./providers";
import CartProvider from "@/components/common/cart_context";
import AutoSignoutGuard from "@/components/auth/auto_signout_guard";
import SwrProvider from "@/providers/swrprovider";
import RouteFlagger from "@/components/route-flagger";
import Promobar from "@/components/common/promobar";

// Global cart panel
import CartPanel from "@/components/cart/cart_panel";

import AdminRouteGate from "@/components/admin/admin_route_gate"; // ✅ new tiny client gate

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ||
  "https://www.thednalabstore.com";

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "TDLC", template: "%s | TDLC" },
  description: "Premium ecommerce",
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AdminRouteGate
          adminTree={<main role="main">{children}</main>}
          siteTree={
            <>
              <AutoSignoutGuard />

              <Providers>
                <CartProvider>
                  <OptionsProvider>
                    <SwrProvider>
                      <Promobar />

                      {/* Global mirror slider, reading from real cart */}
                      <CartPanel />

                      <main role="main">
                        <RouteFlagger>{children}</RouteFlagger>
                      </main>
                    </SwrProvider>
                  </OptionsProvider>
                </CartProvider>
              </Providers>
            </>
          }
        />
      </body>
    </html>
  );
}
