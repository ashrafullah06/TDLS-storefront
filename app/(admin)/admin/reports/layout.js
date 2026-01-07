// FILE: app/(admin)/admin/reports/layout.js
import ReportsSidebar from "@/components/admin/reports_sidebar";

export default function ReportsLayout({ children }) {
  return (
    <div className="flex flex-col md:flex-row min-h-[70vh]">
      <ReportsSidebar />
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
