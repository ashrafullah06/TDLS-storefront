//app/login/otp/page.jsx
"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";

const OtpForm = dynamic(() => import("@/components/auth/otpform.jsx"), { ssr: false });

export default function OtpPage() {
  const searchParams = useSearchParams();

  // Purpose of the OTP flow: login, signup, admin_login, cod_confirm, etc.
  const purpose = searchParams.get("purpose") || "login";

  // Where to send the user after successful verification
  const redirect = searchParams.get("redirect") || null;

  // Optional identifier passed via URL (email/phone) so the form can prefill
  const identifier = searchParams.get("identifier") || "";

  return (
    <main
      className="min-h-screen flex items-center justify-center px-4 md:px-8 bg-transparent"
      style={{ paddingTop: "192px", paddingBottom: "288px" }}
    >
      <div className="w-full max-w-[960px]">
        <OtpForm
          purpose={purpose}
          redirect={redirect}
          identifier={identifier}
        />
      </div>
    </main>
  );
}
