import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest } from "../../lib/api";
import { formatCurrency } from "../../lib/format";
import TrendChart from "../../components/TrendChart";
import { formatDate, STATUS_STYLES } from "./orders/orderShared";

const card = { background: "#fff", border: "1px solid #D8E6F0", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" };

const ICON_PATHS = {
  user: (
    <>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </>
  ),
  wallet: (
    <>
      <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
      <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
      <path d="M18 12a2 2 0 0 0 0 4h4v-4z" />
    </>
  ),
  orders: (
    <>
      <path d="M20.5 7.3 12 12l-8.5-4.7" />
      <path d="M12 12v9" />
      <path d="M20.5 7.3v9.4L12 21l-8.5-4.3V7.3L12 3z" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </>
  ),
  check: (
    <>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <path d="M22 4 12 14.01l-3-3" />
    </>
  ),
  draft: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </>
  ),
  plus: (
    <>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </>
  ),
  eye: (
    <>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  users: (
    <>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
};

const IconGlyph = ({ name, size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {ICON_PATHS[name]}
  </svg>
);

const StatCard = ({ label, value, icon, tint, color }) => (
  <div className="rounded-2xl p-5 transition-shadow duration-150 hover:shadow-md" style={card}>
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium truncate" style={{ color: "#5B7285" }}>{label}</p>
        <p className="text-3xl font-bold mt-2" style={{ color: "#0f172a" }}>{value}</p>
      </div>
      <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ background: tint, color }}>
        <IconGlyph name={icon} />
      </div>
    </div>
  </div>
);

// Fixed lifecycle order + validated CVD-safe hues (never reused for anything else).
// Failed and Cancelled share one slice — the rest of the portal already groups
// them together (see PartnerMyOrders / the old "Failed / Rejected" view).
const STATUS_SLICES = [
  { key: "Draft", label: "Draft", color: "#7C3AED" },
  { key: "Submitted", label: "Submitted", color: "#1E6091" },
  { key: "In Progress", label: "In Progress", color: "#D97706" },
  { key: "Completed", label: "Completed", color: "#059669" },
  { key: "Failed", label: "Failed / Cancelled", color: "#DC2626" },
];

const RADIUS = 52;
const STROKE = 20;
const CIRC = 2 * Math.PI * RADIUS;

const OrderStatusDonut = ({ counts, total }) => {
  const segments = useMemo(
    () =>
      STATUS_SLICES.reduce((acc, slice) => {
        const value = counts[slice.key] || 0;
        const pct = total ? value / total : 0;
        const dash = Math.max(pct * CIRC - (pct > 0 ? 2 : 0), 0);
        const offset = acc.length ? acc[acc.length - 1].offset + acc[acc.length - 1].pct * CIRC : 0;
        return [...acc, { ...slice, dash, offset, pct }];
      }, []),
    [counts, total]
  );

  return (
    <div className="flex flex-col sm:flex-row items-center gap-6">
      <svg viewBox="0 0 140 140" width={160} height={160} role="img" aria-label="Order status breakdown">
        <circle cx="70" cy="70" r={RADIUS} fill="none" stroke="#EDF3F8" strokeWidth={STROKE} />
        {segments.filter((segment) => segment.dash > 0).map((segment) => (
          <circle
            key={segment.key}
            cx="70"
            cy="70"
            r={RADIUS}
            fill="none"
            stroke={segment.color}
            strokeWidth={STROKE}
            strokeDasharray={`${segment.dash} ${CIRC - segment.dash}`}
            strokeDashoffset={-segment.offset}
            strokeLinecap="round"
            transform="rotate(-90 70 70)"
          />
        ))}
        <text x="70" y="66" textAnchor="middle" fontSize="22" fontWeight="800" fill="#0f172a">{total}</text>
        <text x="70" y="84" textAnchor="middle" fontSize="10" fill="#94A3B8">total orders</text>
      </svg>

      <div className="grid gap-2.5 w-full">
        {STATUS_SLICES.map((slice) => {
          const value = counts[slice.key] || 0;
          const pct = total ? Math.round((value / total) * 100) : 0;
          return (
            <div key={slice.key} className="flex items-center justify-between gap-3 text-sm">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: slice.color }} />
                <span className="truncate" style={{ color: "#334155" }}>{slice.label}</span>
              </div>
              <span className="font-semibold shrink-0" style={{ color: "#0f172a" }}>{value} <span className="font-normal" style={{ color: "#94A3B8" }}>({pct}%)</span></span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const dayKey = (value) => {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const shortDate = (key) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
};

const last30DayKeys = () => {
  const keys = [];
  const today = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  }
  return keys;
};

const QUICK_ACTIONS = [
  { label: "Create User", icon: "plus", href: "/partner/users/create", bg: "#1E6091" },
  { label: "Create Order", icon: "orders", href: "/partner/orders/create", bg: "#16A34A" },
  { label: "Manage Users", icon: "users", href: "/partner/users", bg: "#176B87" },
  { label: "View Orders", icon: "eye", href: "/partner/orders", bg: "#1E6091" },
];

const statusBadge = (status) => (
  <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold" style={STATUS_STYLES[status] || { background: "#E2EBF4", color: "#334155" }}>
    {status}
  </span>
);

const PartnerDashboard = () => {
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [wallet, setWallet] = useState(null);
  const [users, setUsers] = useState(null);
  const [orders, setOrders] = useState(null);

  useEffect(() => {
    apiRequest("/api/partner/profile").then(setProfile).catch(() => setProfile(null));
    apiRequest("/api/partner/users").then(setUsers).catch(() => setUsers([]));
    apiRequest("/api/partner/orders").then(setOrders).catch(() => setOrders([]));
  }, []);

  const showWallet = profile?.payment_mode !== "PPS";

  useEffect(() => {
    if (!showWallet) return;
    apiRequest("/api/partner/wallet").then(setWallet).catch(() => setWallet(null));
  }, [showWallet]);

  const stats = useMemo(() => {
    const list = orders || [];
    return {
      total: list.length,
      pending: list.filter((o) => o.status === "Submitted" || o.status === "In Progress").length,
      completed: list.filter((o) => o.status === "Completed").length,
      draft: list.filter((o) => o.status === "Draft").length,
    };
  }, [orders]);

  const statusCounts = useMemo(() => {
    const list = orders || [];
    return list.reduce((acc, o) => {
      const key = o.status === "Cancelled" ? "Failed" : o.status;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
  }, [orders]);

  const trendPoints = useMemo(() => {
    const buckets = Object.fromEntries(last30DayKeys().map((k) => [k, 0]));
    (orders || []).forEach((o) => {
      const key = dayKey(o.created_at);
      if (key in buckets) buckets[key] += 1;
    });
    return Object.entries(buckets).map(([key, value]) => ({ date: key, value, label: shortDate(key) }));
  }, [orders]);

  const recentOrders = useMemo(() => (orders || []).slice(0, 5), [orders]);

  const loading = orders === null;

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-bold" style={{ color: "#0f172a" }}>Dashboard</h1>
        <p className="text-sm mt-1" style={{ color: "#5B7285" }}>{profile?.organization_name || "Welcome back"}</p>
      </div>

      <div className={`grid grid-cols-1 sm:grid-cols-2 ${showWallet ? "lg:grid-cols-7" : "lg:grid-cols-5"} gap-4 mb-5`}>
        <StatCard label="Total Users" value={users ? users.length : "..."} icon="user" tint="#E8F3FB" color="#1E6091" />
        {showWallet && (
          <>
            <StatCard label="Wallet Balance" value={wallet ? formatCurrency(wallet.balance) : "..."} icon="wallet" tint="#E6F5EA" color="#3D7A1F" />
            <StatCard label="Available Balance" value={wallet ? formatCurrency(wallet.available_balance) : "..."} icon="wallet" tint="#F0FBF4" color="#16A34A" />
          </>
        )}
        <StatCard label="Total Orders" value={loading ? "..." : stats.total} icon="orders" tint="#E3F1F4" color="#176B87" />
        <StatCard label="Pending Orders" value={loading ? "..." : stats.pending} icon="clock" tint="#FEF3C7" color="#92400E" />
        <StatCard label="Completed Orders" value={loading ? "..." : stats.completed} icon="check" tint="#E6F5EA" color="#3D7A1F" />
        <StatCard label="Draft Orders" value={loading ? "..." : stats.draft} icon="draft" tint="#E2EBF4" color="#334155" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
        <div className="rounded-2xl p-5" style={card}>
          <h2 className="font-semibold mb-1" style={{ color: "#0f172a" }}>Orders Trend</h2>
          <p className="text-xs mb-2" style={{ color: "#5B7285" }}>Last 30 days</p>
          <TrendChart points={trendPoints} color="#1E6091" formatValue={(v) => `${v} order${v === 1 ? "" : "s"}`} emptyLabel="No orders in the last 30 days" height={170} />
        </div>
        <div className="rounded-2xl p-5" style={card}>
          <h2 className="font-semibold mb-4" style={{ color: "#0f172a" }}>Order Status</h2>
          {loading ? (
            <p className="text-sm" style={{ color: "#5B7285" }}>Loading...</p>
          ) : (
            <OrderStatusDonut counts={statusCounts} total={stats.total} />
          )}
        </div>
      </div>

      <div className="rounded-2xl p-6 mb-5" style={card}>
        <h2 className="font-semibold mb-4" style={{ color: "#0f172a" }}>Quick Actions</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {QUICK_ACTIONS.map((action) => (
            <a key={action.href} href={action.href} className="flex items-center gap-3 p-4 rounded-xl transition-all duration-150 hover:scale-[1.03] hover:shadow-md text-white" style={{ background: action.bg, textDecoration: "none" }}>
              <IconGlyph name={action.icon} size={18} />
              <span className="text-sm font-semibold">{action.label}</span>
            </a>
          ))}
        </div>
      </div>

      <div className="rounded-2xl overflow-hidden" style={card}>
        <div className="flex justify-between items-center px-6 py-4 border-b" style={{ borderColor: "#E2EBF4" }}>
          <h2 className="font-semibold" style={{ color: "#0f172a" }}>Recent Orders</h2>
          <button onClick={() => navigate("/partner/orders")} className="text-xs font-semibold" style={{ color: "#1E6091" }}>View All</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ background: "#F3F8FB", borderBottom: "1px solid #D8E6F0" }}>
                {["Order ID", "Customer", "Service", "Created Date", "Amount", "Status"].map((h) => (
                  <th key={h} className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: "#5B7285" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentOrders.map((order) => (
                <tr key={order.id} className="border-t transition-colors hover:bg-slate-50/50 cursor-pointer" style={{ borderColor: "#E2EBF4" }} onClick={() => navigate(`/partner/orders/${order.id}`)}>
                  <td className="px-5 py-3.5"><p className="text-sm font-semibold" style={{ color: "#1e293b" }}>{order.order_no}</p></td>
                  <td className="px-5 py-3.5 text-sm" style={{ color: "#1e293b" }}>{order.customer_name}</td>
                  <td className="px-5 py-3.5 text-sm" style={{ color: "#1e293b" }}>{order.service_name}</td>
                  <td className="px-5 py-3.5 text-sm whitespace-nowrap" style={{ color: "#5B7285" }}>{formatDate(order.created_at)}</td>
                  <td className="px-5 py-3.5 text-sm font-semibold" style={{ color: "#0f172a" }}>{formatCurrency(order.amount)}</td>
                  <td className="px-5 py-3.5">{statusBadge(order.status)}</td>
                </tr>
              ))}
              {!loading && recentOrders.length === 0 && (
                <tr>
                  <td colSpan="6" className="text-center py-14 text-sm font-medium" style={{ color: "#5B7285" }}>No orders yet</td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td colSpan="6" className="text-center py-14 text-sm" style={{ color: "#5B7285" }}>Loading orders...</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default PartnerDashboard;
