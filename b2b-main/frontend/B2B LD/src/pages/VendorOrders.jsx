import { useEffect, useState } from "react";
import { apiRequest } from "../lib/api";
import { formatCurrency } from "../lib/format";
import StatusBadge from "../components/StatusBadge";

const card = { background: "#fff", border: "1px solid #D8E6F0", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" };
const inputClass = "w-full px-4 py-2.5 text-sm rounded-xl outline-none transition-all";
const inputStyle = { background: "#F3F8FB", border: "1px solid #D8E6F0", color: "#1e293b" };

const ORDER_STATUSES = ["Draft", "Submitted", "In Progress", "Completed", "Failed", "Cancelled"];

const ORDER_STATUS_MAP = {
  Draft: { label: "Draft", bg: "#E2EBF4", color: "#5B7285", dot: "#94A3B8" },
  Submitted: { label: "Submitted", bg: "#E8F3FB", color: "#1E6091", dot: "#1E6091" },
  "In Progress": { label: "In Progress", bg: "#FEF3C7", color: "#92400E", dot: "#D97706" },
  Completed: { label: "Completed", bg: "#E6F5EA", color: "#3D7A1F", dot: "#16A34A" },
  Failed: { label: "Failed", bg: "#FDECEC", color: "#C0392B", dot: "#C0392B" },
  Cancelled: { label: "Cancelled", bg: "#F1F5F9", color: "#64748B", dot: "#94A3B8" },
};

const formatDate = (value) =>
  value ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "-";

const VendorOrders = () => {
  const [orders, setOrders] = useState([]);
  const [states, setStates] = useState([]);
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [serviceFilter, setServiceFilter] = useState("");

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    if (stateFilter) params.set("state_id", stateFilter);
    if (serviceFilter) params.set("service_name", serviceFilter);
    apiRequest(`/api/vendors/order-assignments?${params.toString()}`)
      .then(setOrders)
      .catch(() => setOrders([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    apiRequest("/api/catalog/states").then(setStates).catch(() => setStates([]));
    // The real service master, same as everywhere else — this filter used
    // to be a hardcoded set of made-up placeholder names (Print & Delivery,
    // Document Verification, ...) unrelated to any real configured service.
    apiRequest("/api/services").then((rows) => setServices(rows.filter((s) => s.status))).catch(() => setServices([]));
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, stateFilter, serviceFilter]);

  const filtered = orders.filter((o) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [o.order_no, o.customer_name, o.partner_name, o.vendor_name].some((f) => f?.toLowerCase().includes(q));
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: "#0f172a" }}>Vendor Orders</h1>
        <p className="text-sm mt-1" style={{ color: "#5B7285" }}>All orders currently assigned to vendors</p>
      </div>

      <div className="rounded-2xl p-4 mb-5 grid grid-cols-1 md:grid-cols-4 gap-3" style={card}>
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5B7285" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" placeholder="Search order, customer, partner, vendor..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 text-sm rounded-xl outline-none" style={inputStyle} />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={inputClass} style={inputStyle}>
          <option value="">All Statuses</option>
          {ORDER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)} className={inputClass} style={inputStyle}>
          <option value="">All States</option>
          {states.map((s) => <option key={s.id} value={s.id}>{s.state_name}</option>)}
        </select>
        <select value={serviceFilter} onChange={(e) => setServiceFilter(e.target.value)} className={inputClass} style={inputStyle}>
          <option value="">All Services</option>
          {services.map((s) => <option key={s.id} value={s.service_name}>{s.service_name}</option>)}
        </select>
      </div>

      <div className="rounded-2xl overflow-hidden" style={{ background: "#fff", border: "1px solid #D8E6F0", boxShadow: "0 8px 24px rgba(30,96,145,0.1)" }}>
        <div className="h-1.5" style={{ background: "linear-gradient(90deg, #1E6091, #176B87, #16A34A)" }}></div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ background: "linear-gradient(180deg, #EAF3FA, #F3F8FB)", borderBottom: "1px solid #D8E6F0" }}>
                {["Order No", "Customer", "Partner", "Vendor", "State", "Service", "Amount", "Assigned Date", "Status"].map((h) => (
                  <th key={h} className="text-left px-5 py-3.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: "#1E6091" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((o, i) => (
                <tr key={o.assignment_id} className="border-t transition-colors hover:bg-[#E8F3FB]/60" style={{ borderColor: "#E2EBF4", background: i % 2 === 1 ? "#F8FBFD" : "#fff" }}>
                  <td className="px-5 py-4 text-sm font-semibold" style={{ color: "#1e293b" }}>{o.order_no}</td>
                  <td className="px-5 py-4 text-sm" style={{ color: "#1e293b" }}>{o.customer_name || "-"}</td>
                  <td className="px-5 py-4 text-sm" style={{ color: "#1e293b" }}>{o.partner_name}</td>
                  <td className="px-5 py-4 text-sm font-semibold" style={{ color: "#1e293b" }}>{o.vendor_name}</td>
                  <td className="px-5 py-4 text-sm" style={{ color: "#1e293b" }}>{o.state_name || "-"}</td>
                  <td className="px-5 py-4 text-sm" style={{ color: "#1e293b" }}>{o.service_name || "-"}</td>
                  <td className="px-5 py-4 text-sm font-semibold" style={{ color: "#0f172a" }}>{formatCurrency(o.amount)}</td>
                  <td className="px-5 py-4 text-sm whitespace-nowrap" style={{ color: "#5B7285" }}>{formatDate(o.assigned_at)}</td>
                  <td className="px-5 py-4"><StatusBadge status={o.current_status} map={ORDER_STATUS_MAP} /></td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan="9" className="text-center py-16">
                    <p className="font-semibold" style={{ color: "#5B7285" }}>No vendor-assigned orders found</p>
                  </td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td colSpan="9" className="text-center py-16 text-sm" style={{ color: "#5B7285" }}>Loading...</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex justify-between items-center px-5 py-4 border-t" style={{ borderColor: "#E2EBF4" }}>
          <p className="text-sm" style={{ color: "#5B7285" }}>Showing <span className="font-semibold" style={{ color: "#1e293b" }}>{filtered.length}</span> of {orders.length} assignments</p>
        </div>
      </div>
    </div>
  );
};

export default VendorOrders;
