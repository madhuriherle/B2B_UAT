import { useEffect, useState } from "react";
import { apiRequest, downloadFile } from "../../lib/api";
import { formatCurrency } from "../../lib/format";
import TrendChart from "../../components/TrendChart";
import StatCard from "../../components/StatCard";

const shortDate = (value) =>
  new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });

const AdminReportsTab = () => {
  const [financial, setFinancial] = useState(null);
  const [orderStats, setOrderStats] = useState(null);

  useEffect(() => {
    apiRequest("/api/admin/reports/financial").then(setFinancial).catch(() => setFinancial(null));
    apiRequest("/api/admin/reports/orders").then(setOrderStats).catch(() => setOrderStats(null));
  }, []);

  const summary = financial?.summary || {};
  const trendPoints = (orderStats?.daily_trend || []).map((p) => ({
    date: p.date,
    value: p.orders,
    label: shortDate(p.date),
  }));

  const handleExport = () => downloadFile("/api/admin/reports/financial/csv", "legaldesk_financial_report.csv").catch(() => {});

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "#0f172a" }}>B2C Reports</h1>
          <p className="text-sm mt-1" style={{ color: "#5B7285" }}>Financial and order volume reporting</p>
        </div>
        <button onClick={handleExport} className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>
          Export Financial CSV
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Orders" value={summary.total_orders ?? "..."} />
        <StatCard label="Total Revenue" value={summary.total_revenue !== undefined ? formatCurrency(summary.total_revenue) : "..."} />
        <StatCard label="Total GST" value={summary.total_gst !== undefined ? formatCurrency(summary.total_gst) : "..."} />
        <StatCard label="Net Revenue" value={summary.net_revenue !== undefined ? formatCurrency(summary.net_revenue) : "..."} />
      </div>

      <div className="rounded-2xl p-5 mb-6" style={{ background: "#fff", border: "1px solid #D8E6F0", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        <h3 className="font-semibold mb-1" style={{ color: "#0f172a" }}>Order Volume — Last 30 Days</h3>
        <TrendChart points={trendPoints} color="#6B21A8" formatValue={(v) => `${v} order${v === 1 ? "" : "s"}`} emptyLabel="No order data available" height={150} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="rounded-2xl overflow-hidden" style={{ background: "#fff", border: "1px solid #D8E6F0", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div className="px-5 py-3.5 border-b" style={{ borderColor: "#D8E6F0", background: "#F3F8FB" }}>
            <span className="text-sm font-bold" style={{ color: "#0f172a" }}>Revenue by Document Type</span>
          </div>
          <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ background: "#F3F8FB" }}>
                {["Document Type", "Orders", "Revenue"].map((h) => (
                  <th key={h} className="text-left px-5 py-2.5 text-xs font-semibold uppercase tracking-wider" style={{ color: "#5B7285" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(orderStats?.by_doc_type || []).length === 0 ? (
                <tr><td colSpan={3} className="text-center py-8 text-sm" style={{ color: "#5B7285" }}>{orderStats ? "No data." : "Loading..."}</td></tr>
              ) : (
                orderStats.by_doc_type.map((d) => (
                  <tr key={d.doc_type} className="border-t" style={{ borderColor: "#EEF3F8" }}>
                    <td className="px-5 py-2.5 text-sm font-semibold" style={{ color: "#1e293b" }}>{d.doc_type}</td>
                    <td className="px-5 py-2.5 text-sm" style={{ color: "#5B7285" }}>{d.count}</td>
                    <td className="px-5 py-2.5 text-sm font-semibold" style={{ color: "#0f172a" }}>{formatCurrency(d.revenue)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          </div>
        </div>

        <div className="rounded-2xl overflow-hidden" style={{ background: "#fff", border: "1px solid #D8E6F0", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div className="px-5 py-3.5 border-b" style={{ borderColor: "#D8E6F0", background: "#F3F8FB" }}>
            <span className="text-sm font-bold" style={{ color: "#0f172a" }}>Orders by Status</span>
          </div>
          <div className="p-5 space-y-3">
            {Object.entries(orderStats?.by_status || {}).map(([status, count]) => (
              <div key={status} className="flex items-center justify-between">
                <span className="text-sm capitalize" style={{ color: "#5B7285" }}>{status}</span>
                <span className="text-sm font-bold" style={{ color: "#1e293b" }}>{count}</span>
              </div>
            ))}
            {!orderStats && <p className="text-sm" style={{ color: "#5B7285" }}>Loading...</p>}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminReportsTab;
