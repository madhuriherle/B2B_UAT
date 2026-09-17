import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest } from "../lib/api";
import { formatCurrency } from "../lib/format";
import { useAuth } from "../lib/AuthContext";
import { portalBase } from "../lib/roleHome";
import { STATUS_STYLES } from "./partner/orders/orderShared";
import CancelOrderModal from "../components/CancelOrderModal";

const card = { background: "#fff", border: "1px solid #D8E6F0", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" };
const inputStyle = { background: "#F3F8FB", border: "1px solid #D8E6F0", color: "#1e293b" };

const formatDate = (value) =>
  value ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "-";

const formatFilenameDate = (value) => {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  return day && month && year ? `${day}-${month}-${year}` : value;
};

const orderReportFilename = (dateFrom, dateTo) => {
  if (dateFrom && dateTo) return `Order_Report_${formatFilenameDate(dateFrom)}_to_${formatFilenameDate(dateTo)}.csv`;
  if (dateFrom) return `Order_Report_from_${formatFilenameDate(dateFrom)}.csv`;
  if (dateTo) return `Order_Report_to_${formatFilenameDate(dateTo)}.csv`;
  return `Order_Report_${new Date().toISOString().slice(0, 10)}.csv`;
};

// organization_type also holds legacy legal-entity values (e.g. "LLP") from
// before onboarding was standardized to just Dealer/Retailer — only show the
// current, meaningful ones.
const partnerTypeSuffix = (type) => (type === "Dealer" || type === "Retailer" ? type : null);

const csvEscape = (value) => {
  const str = String(value ?? "");
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
};

const downloadCsv = (filename, headers, rows) => {
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) lines.push(row.map(csvEscape).join(","));
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const OrderReports = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const base = portalBase(user);
  const [orders, setOrders] = useState([]);
  const [organizations, setOrganizations] = useState([]);
  const [partnerFilter, setPartnerFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [cancelTarget, setCancelTarget] = useState(null);

  useEffect(() => {
    apiRequest("/api/organizations").then(setOrganizations).catch(() => setOrganizations([]));
  }, []);

  const loadOrders = () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (partnerFilter) params.set("organization_id", partnerFilter);
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);
    const query = params.toString() ? `?${params.toString()}` : "";
    apiRequest(`/api/reports/orders${query}`)
      .then(setOrders)
      .catch(() => setOrders([]))
      .finally(() => setLoading(false));
  };

  useEffect(loadOrders, [partnerFilter, dateFrom, dateTo]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return orders;
    return orders.filter((o) =>
      [o.order_no, o.partner_name, o.partner_type, o.user_name, o.customer_name, o.service_name]
        .some((v) => v?.toLowerCase().includes(q))
    );
  }, [orders, search]);

  const handleExport = () => {
    downloadCsv(
      orderReportFilename(dateFrom, dateTo),
      ["Order ID", "Partner", "User", "Customer", "Service", "Amount", "Date"],
      filtered.map((o) => {
        const type = partnerTypeSuffix(o.partner_type);
        return [o.order_no, type ? `${o.partner_name} (${type})` : o.partner_name, o.user_name || "", o.customer_name || "", o.service_name || "", o.amount, formatDate(o.created_at)];
      })
    );
  };

  return (
    <div>
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "#0f172a" }}>Order Reports</h1>
          <p className="text-sm mt-1" style={{ color: "#5B7285" }}>All orders placed across partners</p>
        </div>
        <button onClick={handleExport} disabled={filtered.length === 0} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>
          Export CSV
        </button>
      </div>

      <div className="rounded-2xl p-4 mb-5 flex flex-wrap gap-3 items-center" style={card}>
        <div className="relative flex-1 min-w-48">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5B7285" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" placeholder="Search order, partner, user, customer..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 text-sm rounded-xl outline-none" style={inputStyle} />
        </div>
        <select value={partnerFilter} onChange={(e) => setPartnerFilter(e.target.value)} className="px-4 py-2.5 text-sm rounded-xl outline-none max-w-56" style={inputStyle}>
          <option value="">All Partners</option>
          {organizations.map((o) => <option key={o.id} value={o.id}>{o.organization_name}</option>)}
        </select>
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="px-4 py-2.5 text-sm rounded-xl outline-none" style={inputStyle} />
        <span className="text-xs" style={{ color: "#5B7285" }}>to</span>
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="px-4 py-2.5 text-sm rounded-xl outline-none" style={inputStyle} />
      </div>

      <div className="rounded-2xl overflow-hidden" style={card}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ background: "#F3F8FB", borderBottom: "1px solid #D8E6F0" }}>
                {["Order ID", "Partner", "Service", "Amount", "Date", "Status", "Actions"].map((h) => (
                  <th key={h} className="text-left px-5 py-3.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: "#5B7285" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => (
                <tr key={o.id} className="border-t transition-colors hover:bg-slate-50/50" style={{ borderColor: "#E2EBF4" }}>
                  <td className="px-5 py-4 text-sm font-mono font-medium" style={{ color: "#1E6091" }}>{o.order_no || "-"}</td>
                  <td className="px-5 py-4 text-sm" style={{ color: "#1e293b" }}>
                    {o.partner_name}
                    {partnerTypeSuffix(o.partner_type) && <span style={{ color: "#5B7285" }}> ({partnerTypeSuffix(o.partner_type)})</span>}
                  </td>
                  <td className="px-5 py-4 text-sm" style={{ color: "#1e293b" }}>{o.service_name || "-"}</td>
                  <td className="px-5 py-4 text-sm font-semibold" style={{ color: "#0f172a" }}>{formatCurrency(o.amount)}</td>
                  <td className="px-5 py-4 text-sm whitespace-nowrap" style={{ color: "#5B7285" }}>{formatDate(o.created_at)}</td>
                  <td className="px-5 py-4">
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold" style={STATUS_STYLES[o.status] || { background: "#E2EBF4", color: "#5B7285" }}>
                      {o.status}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    {/* One generic Order Detail page for every service type
                        (see OrderDetail.jsx) — ONE ORDER = ONE ORDER, so
                        there is exactly one "View" destination regardless of
                        which service(s) the order contains, instead of
                        branching to a service-specific page/modal that only
                        understands one service. */}
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => navigate(`${base}/reports/orders/${o.id}`)}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                        style={{ background: "#E8F3FB", color: "#1E6091" }}
                      >
                        View
                      </button>
                      {o.status !== "Cancelled" && (
                        <button
                          onClick={() => setCancelTarget(o)}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                          style={{ background: "#FDECEC", color: "#C0392B" }}
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan="7" className="text-center py-16">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: "#E2EBF4" }}>
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
                      </div>
                      <p className="font-semibold" style={{ color: "#5B7285" }}>No orders found</p>
                      <p className="text-sm" style={{ color: "#cbd5e1" }}>Orders will appear here once partners start placing them</p>
                    </div>
                  </td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td colSpan="7" className="text-center py-16 text-sm" style={{ color: "#5B7285" }}>Loading orders...</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex justify-between items-center px-5 py-4 border-t" style={{ borderColor: "#E2EBF4" }}>
          <p className="text-sm" style={{ color: "#5B7285" }}>Showing <span className="font-semibold" style={{ color: "#1e293b" }}>{filtered.length}</span> of {orders.length} orders</p>
        </div>
      </div>

      {cancelTarget && (
        <CancelOrderModal
          order={cancelTarget}
          onClose={() => setCancelTarget(null)}
          onCancelled={() => {
            setCancelTarget(null);
            loadOrders();
          }}
        />
      )}
    </div>
  );
};

export default OrderReports;
