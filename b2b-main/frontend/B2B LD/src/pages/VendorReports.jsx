import { useEffect, useState } from "react";
import { apiRequest } from "../lib/api";
import { formatCurrency } from "../lib/format";
import StatCard from "../components/StatCard";

const card = { background: "#fff", border: "1px solid #D8E6F0", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" };

// No charting library exists in this repo (confirmed via package.json) —
// same hand-rolled convention as TrendChart.jsx, just a simple bar list
// rather than a full SVG line chart since these are ranked counts, not a
// time series.
const BarList = ({ items, labelKey, valueKey, color, emptyLabel }) => {
  if (!items.length) return <p className="text-sm" style={{ color: "#5B7285" }}>{emptyLabel}</p>;
  const max = Math.max(1, ...items.map((i) => Number(i[valueKey]) || 0));
  return (
    <div className="space-y-2.5">
      {items.map((item) => (
        <div key={item[labelKey]} className="flex items-center gap-3">
          <span className="text-sm w-40 truncate shrink-0" style={{ color: "#1e293b" }}>{item[labelKey]}</span>
          <div className="flex-1 h-2.5 rounded-full overflow-hidden" style={{ background: "#E2EBF4" }}>
            <div className="h-full rounded-full" style={{ width: `${(Number(item[valueKey]) / max) * 100}%`, background: color }}></div>
          </div>
          <span className="text-sm font-semibold w-10 text-right shrink-0" style={{ color: "#0f172a" }}>{item[valueKey]}</span>
        </div>
      ))}
    </div>
  );
};

const TableShell = ({ headers, children }) => (
  <div className="rounded-xl overflow-hidden" style={{ border: "1px solid #D8E6F0" }}>
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr style={{ background: "#F3F8FB" }}>
            {headers.map((h) => (
              <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: "#5B7285" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  </div>
);

const VendorReports = () => {
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    apiRequest("/api/vendors/reports/summary").then(setSummary).catch(() => setSummary(null));
  }, []);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: "#0f172a" }}>Vendor Reports</h1>
        <p className="text-sm mt-1" style={{ color: "#5B7285" }}>Cross-vendor performance and fulfillment analytics</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <StatCard label="Total Revenue" value={summary ? formatCurrency(summary.total_revenue) : "..."} />
        <StatCard label="This Month" value={summary ? formatCurrency(summary.this_month_revenue) : "..."} />
        <StatCard label="Today" value={summary ? formatCurrency(summary.today_revenue) : "..."} />
        <StatCard label="Completion Rate" value={summary ? `${summary.completion_rate}%` : "..."} />
        <StatCard label="Avg. Completion Time" value={summary?.avg_completion_hours != null ? `${summary.avg_completion_hours.toFixed(1)}h` : "Not enough data"} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <section className="rounded-2xl p-6" style={card}>
          <h2 className="text-base font-bold mb-4" style={{ color: "#0f172a" }}>Orders by State</h2>
          <BarList items={summary?.orders_by_state || []} labelKey="state_name" valueKey="order_count" color="#1E6091" emptyLabel="No orders assigned yet." />
        </section>
        <section className="rounded-2xl p-6" style={card}>
          <h2 className="text-base font-bold mb-4" style={{ color: "#0f172a" }}>Orders by Service</h2>
          <BarList items={summary?.orders_by_service || []} labelKey="service_name" valueKey="order_count" color="#16A34A" emptyLabel="No orders assigned yet." />
        </section>
      </div>

      <section className="rounded-2xl p-6" style={card}>
        <h2 className="text-base font-bold mb-4" style={{ color: "#0f172a" }}>Vendor Performance</h2>
        <TableShell headers={["Vendor", "Total Assigned", "Completed", "Completion Rate"]}>
          {(summary?.vendor_performance || []).map((v) => (
            <tr key={v.vendor_id} className="border-t" style={{ borderColor: "#E2EBF4" }}>
              <td className="px-4 py-3 text-sm font-semibold" style={{ color: "#1e293b" }}>{v.vendor_name}</td>
              <td className="px-4 py-3 text-sm" style={{ color: "#1e293b" }}>{v.total_assigned}</td>
              <td className="px-4 py-3 text-sm" style={{ color: "#1e293b" }}>{v.completed}</td>
              <td className="px-4 py-3 text-sm font-semibold" style={{ color: "#3D7A1F" }}>{v.completion_rate}%</td>
            </tr>
          ))}
          {(!summary || summary.vendor_performance.length === 0) && (
            <tr>
              <td colSpan="4" className="text-center py-12 text-sm" style={{ color: "#5B7285" }}>No vendors onboarded yet.</td>
            </tr>
          )}
        </TableShell>
      </section>
    </div>
  );
};

export default VendorReports;
