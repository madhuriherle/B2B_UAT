import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiRequest, downloadFile } from "../../lib/api";
import { formatCurrency } from "../../lib/format";
import { useAuth } from "../../lib/AuthContext";
import { portalBase } from "../../lib/roleHome";

const inputClass = "px-3 py-2 text-sm rounded-xl outline-none";
const inputStyle = { background: "#F3F8FB", border: "1px solid #D8E6F0", color: "#1e293b" };

const PAYMENT_BADGE = {
  success: { bg: "#E6F5EA", color: "#3D7A1F", label: "Paid" },
  pending: { bg: "#FEF3C7", color: "#92400E", label: "Awaiting Payment" },
  failed: { bg: "#FDECEC", color: "#C0392B", label: "Failed" },
};

const DOC_STATUS_BADGE = {
  processing: { bg: "#E8F3FB", color: "#1E6091", label: "Processing" },
  completed: { bg: "#E6F5EA", color: "#3D7A1F", label: "Completed" },
  delivered: { bg: "#EFE8FB", color: "#6B21A8", label: "Delivered" },
  draft: { bg: "#E2EBF4", color: "#5B7285", label: "Draft" },
};

const Badge = ({ map, value }) => {
  const s = map[value] || { bg: "#E2EBF4", color: "#5B7285", label: value || "-" };
  return <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap" style={{ background: s.bg, color: s.color }}>{s.label}</span>;
};

const STATUS_OPTIONS = ["all", "paid", "unpaid", "completed", "in_progress"];

const AdminOrdersTab = () => {
  const { user } = useAuth();
  const base = portalBase(user);
  const [orders, setOrders] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [limit] = useState(20);

  const loadOrders = (overrides = {}) => {
    setLoading(true);
    const pageValue = overrides.page ?? page;
    const statusValue = overrides.status ?? status;
    const searchValue = overrides.search ?? search;
    const params = new URLSearchParams({ page: String(pageValue), limit: String(limit) });
    if (statusValue !== "all") params.set("status", statusValue);
    if (searchValue.trim()) params.set("search", searchValue.trim());
    apiRequest(`/api/admin/orders?${params.toString()}`)
      .then((data) => {
        setOrders(data.orders || []);
        setTotal(data.total || 0);
      })
      .catch(() => {
        setOrders([]);
        setTotal(0);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, status]);

  const handleSearch = (e) => {
    e.preventDefault();
    setPage(1);
    loadOrders({ page: 1 });
  };

  const handleSearchChange = (e) => {
    const value = e.target.value;
    setSearch(value);
    // Clearing the box should behave like re-running the search with no
    // term, not silently keep showing the last search's results until the
    // user clicks Search again.
    if (value.trim() === "" && search.trim() !== "") {
      setPage(1);
      loadOrders({ search: "", page: 1 });
    }
  };

  const handleExport = () => downloadFile("/api/admin/orders/report/csv", "legaldesk_orders.csv").catch(() => {});

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "#0f172a" }}>B2C Orders</h1>
          <p className="text-sm mt-1" style={{ color: "#5B7285" }}>{total} total orders</p>
        </div>
        <button onClick={handleExport} className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>
          Export CSV
        </button>
      </div>

      <form onSubmit={handleSearch} className="rounded-2xl p-4 mb-5 flex flex-wrap gap-3 items-center" style={{ background: "#fff", border: "1px solid #D8E6F0" }}>
        <input value={search} onChange={handleSearchChange} placeholder="Search by name, email, or order ID..." className={`flex-1 min-w-48 ${inputClass}`} style={inputStyle} />
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className={inputClass} style={inputStyle}>
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s === "all" ? "All Statuses" : s.replace("_", " ")}</option>)}
        </select>
        <button type="submit" className="px-5 py-2 rounded-xl text-sm font-semibold text-white" style={{ background: "#1E6091" }}>Search</button>
      </form>

      <div className="rounded-2xl overflow-hidden" style={{ background: "#fff", border: "1px solid #D8E6F0", boxShadow: "0 8px 24px rgba(30,96,145,0.1)" }}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ background: "#F3F8FB" }}>
                {["Order ID", "Customer", "Document", "Amount", "Payment", "Status", "Date", "Actions"].map((h) => (
                  <th key={h} className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: "#5B7285" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="text-center py-12 text-sm" style={{ color: "#5B7285" }}>Loading...</td></tr>
              ) : orders.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-12 text-sm" style={{ color: "#5B7285" }}>No orders found.</td></tr>
              ) : (
                orders.map((o) => (
                  <tr key={o.user_doc_id} className="border-t" style={{ borderColor: "#EEF3F8" }}>
                    <td className="px-5 py-3 text-sm font-mono font-semibold" style={{ color: "#6B21A8" }}>#{o.user_doc_id}</td>
                    <td className="px-5 py-3 text-sm" style={{ color: "#1e293b" }}>
                      <p className="font-semibold">{o.customer_name}</p>
                      <p className="text-xs" style={{ color: "#94A3B8" }}>{o.email}</p>
                    </td>
                    <td className="px-5 py-3 text-sm" style={{ color: "#5B7285" }}>{o.document_name}</td>
                    <td className="px-5 py-3 text-sm font-semibold" style={{ color: o.total > 0 ? "#0f172a" : "#cbd5e1" }}>{o.total > 0 ? formatCurrency(o.total) : "-"}</td>
                    <td className="px-5 py-3"><Badge map={PAYMENT_BADGE} value={o.payment_status} /></td>
                    <td className="px-5 py-3"><Badge map={DOC_STATUS_BADGE} value={o.doc_status} /></td>
                    <td className="px-5 py-3 text-sm whitespace-nowrap" style={{ color: "#94A3B8" }}>{o.created_date || "-"}</td>
                    <td className="px-5 py-3">
                      <Link
                        to={`${base}/b2c-admin/orders/${o.user_doc_id}`}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold inline-block"
                        style={{ background: "#E8F3FB", color: "#1E6091" }}
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="flex justify-between items-center px-5 py-4 border-t" style={{ borderColor: "#E2EBF4" }}>
          <p className="text-sm" style={{ color: "#5B7285" }}>Page <span className="font-semibold" style={{ color: "#1e293b" }}>{page}</span> of {totalPages}</p>
          <div className="flex gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40" style={{ background: "#E2EBF4", color: "#334155" }}>Previous</button>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40" style={{ background: "#E2EBF4", color: "#334155" }}>Next</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminOrdersTab;
