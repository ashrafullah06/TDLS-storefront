import React from "react";
import { fetchComplianceBanner } from "../../utils/api-utils";

export default function ComplianceAnnouncement() {
  const [banner, setBanner] = React.useState(null);
  const [visible, setVisible] = React.useState(true);

  React.useEffect(() => {
    (async () => {
      try {
        const data = await fetchComplianceBanner();
        setBanner(data);
        if (data && data.mustRead) setVisible(true);
        else {
          // check if user dismissed already (persisted)
          const dismissed = window.localStorage.getItem("complianceBannerDismissed");
          if (dismissed === "true") setVisible(false);
        }
      } catch (err) {
        setBanner({
          message: "We use cookies and analytics to enhance your experience.",
          lastUpdated: null,
          mustRead: false,
          policyLinks: [
            { label: "Privacy Policy", href: "/privacy-policy" },
            { label: "Refund Policy", href: "/refund-policy" }
          ]
        });
      }
    })();
  }, []);

  if (!banner || !visible) return null;

  const handleDismiss = () => {
    setVisible(false);
    window.localStorage.setItem("complianceBannerDismissed", "true");
  };

  return (
    <div
      className="
        w-full fixed top-0 left-0 z-[9999]
        bg-[#FFFBEA] border-b border-yellow-300 text-[#694502]
        py-2 px-3 sm:py-2 sm:px-6
        flex flex-col sm:flex-row items-center justify-between
        shadow-md
      "
      style={{
        fontSize: "1em",
        fontWeight: 500,
        letterSpacing: ".01em",
        minHeight: 44,
      }}
    >
      <div className="flex-1 min-w-0 text-center sm:text-left leading-snug">
        <span className="font-bold">Compliance Notice:</span>{" "}
        {banner.message}
        {banner.lastUpdated && (
          <span className="ml-2 block sm:inline text-xs text-[#a88900]">
            Last updated: {new Date(banner.lastUpdated).toLocaleString("en-BD")}
          </span>
        )}
        {banner.policyLinks && banner.policyLinks.length > 0 && (
          <span className="ml-2 block sm:inline">
            {banner.policyLinks.map((link, idx) => (
              <a
                key={idx}
                href={link.href}
                className="underline text-[#4860b5] mx-1 whitespace-nowrap hover:text-[#294389] transition"
                target="_blank"
                rel="noopener noreferrer"
              >
                {link.label}
              </a>
            ))}
          </span>
        )}
      </div>
      {!banner.mustRead && (
        <button
          onClick={handleDismiss}
          className="mt-2 sm:mt-0 sm:ml-5 bg-[#F9E1A8] rounded px-3 py-1 text-xs font-medium hover:bg-yellow-300 hover:text-[#322100] transition shadow-sm"
          aria-label="Dismiss Compliance Announcement"
        >
          Dismiss
        </button>
      )}
    </div>
  );
}
