import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest } from "../../lib/api";
import { formatCurrency, formatWholeRupees } from "../../lib/format";
import { STATUS_STYLES, formatDate } from "../partner/orders/orderShared";
import { theme, serif, card } from "../../lib/userPortalTheme";

const inputClass = "w-full px-4 py-2.5 text-sm rounded outline-none transition-all";
const inputStyle = { background: "#fff", border: `1px solid ${theme.border}`, color: theme.ink };

const statusBadge = (status) => (
  <span className="inline-flex items-center px-2.5 py-1 rounded text-xs font-semibold" style={STATUS_STYLES[status] || { background: theme.bg, color: theme.slate }}>
    {status}
  </span>
);

// esign_status_label is only ever set (non-null) for orders that actually
// started an eSign workflow — eSign orders always, eStamp/Manual eStamp
// orders only when a follow-on eSign was requested (see
// partner.list_partner_orders) — everything else shows the plain total.
const AmountCell = ({ order }) => {
  if (order.esign_status_label == null) return <span className="text-sm font-semibold" style={{ color: theme.ink }}>{formatCurrency(order.amount)}</span>;
  return (
    <span className="text-sm font-semibold whitespace-nowrap" style={{ color: theme.ink }}>
      {formatWholeRupees(order.charged_amount)} / {formatWholeRupees(order.amount)}
    </span>
  );
};

const SIGNER_ICONS = { signed: "✅", pending: "⏳", sent: "⏳", rejected: "❌", expired: "⌛", failed: "⚠️", cancelled: "🚫" };
const SIGNER_LABELS = { signed: "Signed", pending: "Pending", sent: "Pending", rejected: "Rejected", expired: "Expired", failed: "Failed", cancelled: "Cancelled" };

// Each signer as its own chip, stacked one per row — with a hard pixel
// width on the wrapper (below) rather than a Tailwind max-width utility,
// table cells with auto layout otherwise let a wide, unbreakable run of
// nowrap text report an oversized "preferred width" that bleeds visually
// into the next column instead of actually wrapping.
const EsignTimelineCell = ({ signers }) => {
  if (!signers || signers.length === 0) return <span className="text-xs" style={{ color: theme.slate }}>—</span>;
  return (
    <div className="flex flex-col items-start gap-1">
      {signers.map((s, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs whitespace-nowrap"
          style={{ background: theme.bg, color: theme.slate, border: `1px solid ${theme.border}` }}
        >
          {s.name || `Signer ${s.sequence ?? i + 1}`} {SIGNER_ICONS[s.status] || "•"} {SIGNER_LABELS[s.status] || s.status}
        </span>
      ))}
    </div>
  );
};

const PartnerUserOrders = () => {
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");

  useEffect(() => {
    apiRequest("/api/partner-user/orders")
      .then(setOrders)
      .catch(() => setOrders([]))
      .finally(() => setLoading(false));
  }, []);

  // The badge each row actually shows (eSign's own workflow label when it
  // has one, otherwise the order's plain status) — filtering/searching goes
  // against this same effective value, never the raw order.status alone,
  // so "Signed" filters correctly find eSign orders even though their
  // underlying order.status is something else entirely.
  const effectiveStatus = (order) => order.esign_status_label || order.status;
  const statusOptions = useMemo(
    () => ["All", ...new Set(orders.map(effectiveStatus).filter(Boolean))],
    [orders]
  );

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((order) => {
      if (statusFilter !== "All" && effectiveStatus(order) !== statusFilter) return false;
      if (!q) return true;
      return [order.order_no, order.customer_name, order.customer_email, order.service_name]
        .some((v) => v?.toLowerCase().includes(q));
    });
  }, [orders, search, statusFilter]);

  return (
    <div>
      <div className="mb-6 pb-4 border-b" style={{ borderColor: theme.border }}>
        <h1 className="text-2xl font-bold" style={{ color: theme.ink, fontFamily: serif }}>My Orders</h1>
        <p className="text-sm mt-1" style={{ color: theme.slate }}>Orders you've created</p>
      </div>

      <div className="rounded-lg p-4 mb-4 flex flex-wrap gap-3 items-center" style={card}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by order ID, customer, or service..."
          className={`flex-1 min-w-48 ${inputClass}`}
          style={inputStyle}
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className={inputClass}
          style={{ ...inputStyle, width: 180 }}
        >
          {statusOptions.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <div className="rounded-lg overflow-hidden" style={card}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ background: theme.bg, borderBottom: `1px solid ${theme.border}` }}>
                {["Order ID", "Customer", "Service", "eSign Timeline", "Created Date", "Amount", "Status", "Actions"].map((h) => (
                  <th
                    key={h}
                    className="text-left px-5 py-3.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap"
                    style={{ color: theme.slate, ...(h === "eSign Timeline" ? { width: 260, maxWidth: 260 } : {}) }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map((order) => {
                const isManualEstamp = order.service_name === "Manual eStamp";
                const isEstampBulk = order.service_name === "eStamp Bulk";
                return (
                <tr key={order.id} className="border-t transition-colors hover:bg-slate-50/50" style={{ borderColor: theme.border }}>
                  <td className="px-5 py-4"><p className="text-sm font-semibold" style={{ color: theme.ink }}>{order.order_no}</p></td>
                  <td className="px-5 py-4">
                    <p className="text-sm font-medium" style={{ color: theme.ink }}>{order.customer_name}</p>
                    <p className="text-xs" style={{ color: theme.slate }}>{order.customer_email}</p>
                  </td>
                  <td className="px-5 py-4 text-sm" style={{ color: theme.ink }}>{order.service_name}</td>
                  <td className="px-5 py-4" style={{ width: 260, maxWidth: 260 }}><EsignTimelineCell signers={order.esign_signers} /></td>
                  <td className="px-5 py-4 text-sm whitespace-nowrap" style={{ color: theme.slate }}>{formatDate(order.created_at)}</td>
                  <td className="px-5 py-4"><AmountCell order={order} /></td>
                  <td className="px-5 py-4">{statusBadge(order.esign_status_label || order.status)}</td>
                  <td className="px-5 py-4">
                    <button
                      onClick={() =>
                        navigate(
                          isManualEstamp
                            ? `/user/orders/manual-estamp/${order.id}`
                            : isEstampBulk
                            ? `/user/orders/estamp-bulk/${order.id}`
                            : `/user/orders/${order.id}`
                        )
                      }
                      className="px-3 py-1.5 rounded text-xs font-semibold"
                      style={{ background: theme.goldSoft, color: theme.navy }}
                    >
                      View
                    </button>
                  </td>
                </tr>
                );
              })}
              {!loading && filteredOrders.length === 0 && (
                <tr>
                  <td colSpan="8" className="text-center py-16">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: theme.bg }}>
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
                      </div>
                      <p className="font-semibold" style={{ color: theme.slate }}>
                        {orders.length === 0 ? "No orders yet" : "No orders match this search/filter"}
                      </p>
                    </div>
                  </td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td colSpan="8" className="text-center py-16 text-sm" style={{ color: theme.slate }}>Loading orders...</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex justify-between items-center px-5 py-4 border-t" style={{ borderColor: theme.border }}>
          <p className="text-sm" style={{ color: theme.slate }}>Showing <span className="font-semibold" style={{ color: theme.ink }}>{filteredOrders.length}</span> of {orders.length} orders</p>
        </div>
      </div>
    </div>
  );
};

export default PartnerUserOrders;
