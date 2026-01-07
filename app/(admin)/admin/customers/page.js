// FILE: app/(admin)/admin/customers/page.js
export const dynamic = "force-dynamic";
export const revalidate = 0;

import CustomersClient from "./customers-client";

export default function CustomersPage() {
  return <CustomersClient />;
}
