// PATH: app/customer/orders/[id]/receipt/page.jsx
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Reuse the canonical public receipt page via relative export.
export { default } from "../../../../orders/[id]/receipt/page";
