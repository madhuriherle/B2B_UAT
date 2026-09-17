import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest } from "../../lib/api";
import { formatCurrency } from "../../lib/format";
import TrendChart from "../../components/TrendChart";
import { formatDate, STATUS_STYLES } from "../partner/orders/orderShared";
import { theme, serif, card } from "../../lib/userPortalTheme";

const ICON_PATHS = {
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
};

const IconGlyph = ({ name, size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {ICON_PATHS[name]}
  </svg>
);

const StatCard = ({ label, value, icon, color }) => (
  <div className="rounded-lg p-5" style={card}>
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide truncate" style={{ color: theme.slate }}>{label}</p>
        <p className="text-3xl font-bold mt-2" style={{ color: theme.ink, fontFamily: serif }}>{value}</p>
      </div>
      <div className="w-10 h-10 rounded border flex items-center justify-center shrink-0" style={{ borderColor: color, color }}>
        <IconGlyph name={icon} size={18} />
      </div>
    </div>
  </div>
);

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

const statusBadge = (status) => (
  <span className="inline-flex items-center px-2.5 py-1 rounded text-xs font-semibold" style={STATUS_STYLES[status] || { background: theme.bg, color: theme.slate }}>
    {status}
  </span>
);

const PartnerUserDashboard = () => {
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [orders, setOrders] = useState(null);

  useEffect(() => {
    apiRequest("/api/partner-user/profile").then(setProfile).catch(() => setProfile(null));
    apiRequest("/api/partner-user/orders").then(setOrders).catch(() => setOrders([]));
  }, []);

  const stats = useMemo(() => {
    const list = orders || [];
    return {
      total: list.length,
      completed: list.filter((o) => o.status === "Completed").length,
      draft: list.filter((o) => o.status === "Draft").length,
    };
  }, [orders]);

  const ordersByService = useMemo(() => {
    const counts = {};
    (orders || []).forEach((o) => {
      counts[o.service_name] = (counts[o.service_name] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([service_name, order_count]) => ({ service_name, order_count }))
      .sort((a, b) => b.order_count - a.order_count);
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
      <div className="mb-6 pb-4 border-b" style={{ borderColor: theme.border }}>
        <h1 className="text-2xl font-bold" style={{ color: theme.ink, fontFamily: serif }}>Dashboard</h1>
        <p className="text-sm mt-1" style={{ color: theme.slate }}>{profile?.organization_name || "Welcome back"}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
        <StatCard label="Total Orders" value={loading ? "..." : stats.total} icon="orders" color={theme.navy} />
        <StatCard label="Completed Orders" value={loading ? "..." : stats.completed} icon="check" color={theme.success} />
        <StatCard label="Draft Orders" value={loading ? "..." : stats.draft} icon="draft" color={theme.slate} />
      </div>

      <h2 className="font-semibold mb-3" style={{ color: theme.ink, fontFamily: serif }}>Orders by Service</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 mb-5">
        {ordersByService.length === 0 ? (
          <div className="col-span-full rounded-lg p-5 text-sm" style={{ ...card, color: theme.slate }}>
            {loading ? "Loading..." : "No orders placed yet."}
          </div>
        ) : (
          ordersByService.map((s) => (
            <div key={s.service_name} className="rounded-lg p-4" style={card}>
              <p className="text-xs font-semibold uppercase tracking-wide truncate" style={{ color: theme.slate }}>{s.service_name}</p>
              <p className="text-2xl font-bold mt-1.5" style={{ color: theme.ink, fontFamily: serif }}>{s.order_count}</p>
            </div>
          ))
        )}
      </div>

      <div className="rounded-lg p-5 mb-5" style={card}>
        <h2 className="font-semibold mb-1" style={{ color: theme.ink, fontFamily: serif }}>Orders Trend</h2>
        <p className="text-xs mb-2" style={{ color: theme.slate }}>Last 30 days</p>
        <TrendChart points={trendPoints} color={theme.navy} formatValue={(v) => `${v} order${v === 1 ? "" : "s"}`} emptyLabel="No orders in the last 30 days" height={170} />
      </div>

      <div className="rounded-lg overflow-hidden" style={card}>
        <div className="flex justify-between items-center px-6 py-4 border-b" style={{ borderColor: theme.border }}>
          <h2 className="font-semibold" style={{ color: theme.ink, fontFamily: serif }}>Recent Orders</h2>
          <button onClick={() => navigate("/user/orders")} className="text-xs font-semibold" style={{ color: theme.navy }}>View All</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ background: theme.bg, borderBottom: `1px solid ${theme.border}` }}>
                {["Order ID", "Customer", "Service", "Created Date", "Amount", "Status"].map((h) => (
                  <th key={h} className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: theme.slate }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentOrders.map((order) => (
                <tr key={order.id} className="border-t transition-colors hover:bg-slate-50/50" style={{ borderColor: theme.border }}>
                  <td className="px-5 py-3.5"><p className="text-sm font-semibold" style={{ color: theme.ink }}>{order.order_no}</p></td>
                  <td className="px-5 py-3.5 text-sm" style={{ color: theme.ink }}>{order.customer_name}</td>
                  <td className="px-5 py-3.5 text-sm" style={{ color: theme.ink }}>{order.service_name}</td>
                  <td className="px-5 py-3.5 text-sm whitespace-nowrap" style={{ color: theme.slate }}>{formatDate(order.created_at)}</td>
                  <td className="px-5 py-3.5 text-sm font-semibold" style={{ color: theme.ink }}>{formatCurrency(order.amount)}</td>
                  <td className="px-5 py-3.5">{statusBadge(order.status)}</td>
                </tr>
              ))}
              {!loading && recentOrders.length === 0 && (
                <tr>
                  <td colSpan="6" className="text-center py-14 text-sm font-medium" style={{ color: theme.slate }}>No orders yet</td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td colSpan="6" className="text-center py-14 text-sm" style={{ color: theme.slate }}>Loading orders...</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default PartnerUserDashboard;
