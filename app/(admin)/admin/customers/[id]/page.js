// FILE: app/(admin)/admin/customers/[id]/page.js
import CustomersClient from "../customers-client";

export const dynamic = "force-dynamic";

export default function CustomerDetailPage({ params }) {
  const id = params?.id ? String(params.id) : "";
  return <CustomersClient initialSelectedId={id} />;
}
