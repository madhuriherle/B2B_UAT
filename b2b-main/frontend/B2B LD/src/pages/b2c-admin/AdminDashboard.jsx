import { useEffect, useState } from "react";
import { apiRequest } from "../../lib/api";
import { formatCurrency } from "../../lib/format";
import TrendChart from "../../components/TrendChart";
import StatCard from "../../components/StatCard";

const PAYMENT_BADGE = {
  success: { bg: "#E6F5EA", color: "#3D7A1F", label: "Paid" },
  pending: { bg: "#FEF3C7", color: "#92400E", label: "Pending" },
  failed: { bg: "#FDECEC", color: "#C0392B", label: "Failed" },
};

const shortDate = (value) =>
  new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });

const Badge = ({ status }) => {
  const s = PAYMENT_BADGE[status] || { bg: "#E2EBF4", color: "#5B7285", label: status || "-" };
  return (
    <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-semibold" style={{ background: s.bg, color: s.color }}>
      {s.label}
    </span>
  );
};

// Rendered as a section inside pages/Dashboard.jsx (platform_admin only),
// not routed on its own.
const AdminDashboard = () => {
  const [data, setData] = useState(null);

  useEffect(() => {
    apiRequest("/api/admin/dashboard/summary").then(setData).catch(() => setData(null));
  }, []);

  const kpis = data?.kpis || {};
  const points = (data?.revenue_last_7_days || []).map((p) => ({
    date: p.date,
    value: p.revenue,
    label: shortDate(p.date),
  }));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Orders" value={kpis.total_orders ?? "..."} />
        <StatCard label="Total Revenue" value={kpis.total_revenue !== undefined ? formatCurrency(kpis.total_revenue) : "..."} />
        <StatCard label="Pending Orders" value={kpis.pending_orders ?? "..."} />
        <StatCard label="Completed Orders" value={kpis.completed_orders ?? "..."} />
      </div>

      <div className="rounded-2xl p-5" style={{ background: "#fff", border: "1px solid #D8E6F0", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        <h3 className="font-semibold mb-1" style={{ color: "#0f172a" }}>B2C Revenue — Last 7 Days</h3>
        <TrendChart points={points} color="#6B21A8" formatValue={(v) => formatCurrency(v)} emptyLabel="No revenue data available" height={150} />
      </div>

      <div className="rounded-2xl overflow-hidden" style={{ background: "#fff", border: "1px solid #D8E6F0", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        <div className="px-5 py-3.5 border-b" style={{ borderColor: "#D8E6F0", background: "#F3F8FB" }}>
          <span className="text-sm font-bold" style={{ color: "#0f172a" }}>Recent B2C Orders</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ background: "#F3F8FB" }}>
                {["Order ID", "Customer", "Document", "Amount", "Payment", "Date"].map((h) => (
                  <th key={h} className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: "#5B7285" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data?.recent_orders || []).length === 0 ? (
                <tr><td colSpan={6} className="text-center py-10 text-sm" style={{ color: "#5B7285" }}>{data ? "No orders yet." : "Loading..."}</td></tr>
              ) : (
                data.recent_orders.map((o) => (
                  <tr key={o.id} className="border-t" style={{ borderColor: "#EEF3F8" }}>
                    <td className="px-5 py-3 text-sm font-mono font-semibold" style={{ color: "#6B21A8" }}>#{o.id}</td>
                    <td className="px-5 py-3 text-sm" style={{ color: "#1e293b" }}>
                      <p className="font-semibold">{o.user_name}</p>
                      <p className="text-xs" style={{ color: "#94A3B8" }}>{o.user_email}</p>
                    </td>
                    <td className="px-5 py-3 text-sm" style={{ color: "#5B7285" }}>{o.document}</td>
                    <td className="px-5 py-3 text-sm font-semibold" style={{ color: o.amount > 0 ? "#0f172a" : "#cbd5e1" }}>{o.amount > 0 ? formatCurrency(o.amount) : "-"}</td>
                    <td className="px-5 py-3"><Badge status={o.payment_status} /></td>
                    <td className="px-5 py-3 text-sm whitespace-nowrap" style={{ color: "#94A3B8" }}>{o.created_at}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;
