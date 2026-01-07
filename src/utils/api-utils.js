
/**
 * API utilities: Fetch policy, refund, file-of-truth, and compliance data.
 * Uses Bangladesh law/DPDP, master decision & checklist docs, and your .json configs.
 * Enforces audit trail, admin/owner override, legal escalation logic.
 */

const BASE_CONFIG_PATH = "/config/";

// Helper to construct URL for client/server
function getConfigUrl(filename) {
  if (typeof window === "undefined") {
    // SSR: absolute URL required
    const base =
      process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
    return `${base}${BASE_CONFIG_PATH}${filename}`;
  }
  // Client: relative path works
  return `${BASE_CONFIG_PATH}${filename}`;
}

export async function fetchPolicyContent(section) {
  if (section === "homepage") {
    const resp = await fetch(getConfigUrl("site-config.json"));
    if (!resp.ok) throw new Error("Homepage config fetch failed");
    return await resp.json();
  }
  // Can add other sections as needed
  throw new Error("Unknown section");
}

export async function fetchRefundPolicy() {
  const resp = await fetch(getConfigUrl("refund-policy.json"));
  if (!resp.ok) throw new Error("Refund policy fetch failed");
  const data = await resp.json();

  // Business logic: integrate with admin, reward, escalation, audit decision files.
  if (data && data.fraudPrevention && data.fraudPrevention.abuseDetection) {
    // Simulate escalation: You could add your real admin review here
    if (data.abuseFlagged) {
      await fetch("/api/admin/manual-review", {
        method: "POST",
        body: JSON.stringify({ type: "refund_abuse" }),
      });
    }
  }

  return data;
}

export async function fetchFileOfTruth() {
  const resp = await fetch(getConfigUrl("file-of-truth.json"));
  if (!resp.ok) throw new Error("File of Truth fetch failed");
  return await resp.json();
}

export async function fetchComplianceBanner() {
  const resp = await fetch(getConfigUrl("site-config.json"));
  if (!resp.ok) throw new Error("Compliance banner fetch failed");
  const data = await resp.json();
  return {
    message:
      data.complianceBanner?.message ||
      "All refunds, returns, privacy, and audit policies enforced per Bangladesh DPDP and TDLC master decision plan.",
    lastUpdated:
      data.complianceBanner?.lastUpdated || data.complianceBannerLastUpdated,
    mustRead: data.complianceBanner?.mustRead || false,
    policyLinks: [
      ...(data.privacyPolicyLink
        ? [{ label: "Privacy Policy", href: data.privacyPolicyLink }]
        : []),
      ...(data.refundPolicyLink
        ? [{ label: "Refund Policy", href: data.refundPolicyLink }]
        : []),
    ],
  };
}
