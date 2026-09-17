import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "../lib/api";
import { formatCurrency } from "../lib/format";
import { useAuth } from "../lib/AuthContext";
import { portalBase } from "../lib/roleHome";
import TrendChart from "../components/TrendChart";
import B2COverview from "./b2c-admin/AdminDashboard";

const card = { background: "#fff", border: "1px solid #D8E6F0", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" };

const GRADIENTS = {
  "#1E6091": "linear-gradient(135deg, #1E6091, #2C86C4)",
  "#3D7A1F": "linear-gradient(135deg, #3D7A1F, #16A34A)",
  "#176B87": "linear-gradient(135deg, #176B87, #22A6B3)",
  "#B45309": "linear-gradient(135deg, #B45309, #D97706)",
};

const DASHBOARD_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

const ICON_PATHS = {
  partners: (
    <>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  user: (
    <>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
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
      <polyline points="12 6 12 12 16 14" />
    </>
  ),
  revenue: (
    <>
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5.5c0-1.93-2.24-3.5-5-3.5S7 3.57 7 5.5 9.24 9 12 9s5 1.57 5 3.5-2.24 3.5-5 3.5-5-1.57-5-3.5" />
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
  wallet: (
    <>
      <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
      <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
      <path d="M18 12a2 2 0 0 0 0 4h4v-4z" />
    </>
  ),
  stamp: (
    <>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <line x1="6" y1="9" x2="18" y2="9" />
      <line x1="6" y1="13" x2="14" y2="13" />
      <line x1="6" y1="17" x2="10" y2="17" />
    </>
  ),
  tag: (
    <>
      <path d="M20.59 13.41 11 3.83A2 2 0 0 0 9.59 3.24L3 3v6.59a2 2 0 0 0 .59 1.41l9.58 9.58a2 2 0 0 0 2.82 0l4.6-4.6a2 2 0 0 0 0-2.82z" />
      <circle cx="7.5" cy="7.5" r="1.25" fill="currentColor" stroke="none" />
    </>
  ),
};

const IconGlyph = ({ name, size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {ICON_PATHS[name]}
  </svg>
);

const StatCard = ({ label, value, icon, tint, color }) => (
  <div className="rounded-2xl overflow-hidden transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5" style={card}>
    <div className="h-1" style={{ background: GRADIENTS[color] || color }} />
    <div className="p-5 flex items-start justify-between gap-3">
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

const quickActionsFor = (base) => [
  { label: "Add Partner", icon: "plus", href: `${base}/customer-onboard`, bg: "linear-gradient(135deg, #1E6091, #2C86C4)" },
  { label: "View Partners", icon: "eye", href: `${base}/customer-list`, bg: "linear-gradient(135deg, #3D7A1F, #16A34A)" },
  { label: "Manage Wallet", icon: "wallet", href: `${base}/wallet`, bg: "linear-gradient(135deg, #176B87, #22A6B3)" },
  { label: "Stamp Config", icon: "stamp", href: `${base}/stamp-denomination`, bg: "linear-gradient(135deg, #1E6091, #6B21A8)" },
  { label: "Article Codes", icon: "tag", href: `${base}/article-codes`, bg: "linear-gradient(135deg, #B45309, #D97706)" },
];

const shortDate = (isoDate) =>
  new Date(`${isoDate}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });

const Dashboard = () => {
  const { user } = useAuth();
  const base = portalBase(user);
  const quickActions = useMemo(() => quickActionsFor(base), [base]);
  const [dashboardData, setDashboardData] = useState(null);
  const [trendsData, setTrendsData] = useState(null);

  useEffect(() => {
    const loadSummary = () => apiRequest("/api/dashboard/summary").then(setDashboardData).catch(() => setDashboardData(null));
    loadSummary();
    const interval = setInterval(loadSummary, DASHBOARD_REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const loadTrends = () => apiRequest("/api/dashboard/trends?range_days=7").then(setTrendsData).catch(() => setTrendsData(null));
    loadTrends();
    const interval = setInterval(loadTrends, DASHBOARD_REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  const summary = dashboardData?.summary || {};
  const points = useMemo(() => trendsData?.points || [], [trendsData]);

  const revenuePoints = useMemo(
    () => points.map((p) => ({ date: p.date, value: p.revenue, label: shortDate(p.date) })),
    [points]
  );
  const orderPoints = useMemo(
    () => points.map((p) => ({ date: p.date, value: p.orders, label: shortDate(p.date) })),
    [points]
  );
  const ordersByService = dashboardData?.orders_by_service || [];
  const partnerGrowthPoints = useMemo(
    () =>
      points.reduce((acc, p) => {
        const cumulative = (acc[acc.length - 1]?.value || 0) + p.new_partners;
        return [...acc, { date: p.date, value: cumulative, label: shortDate(p.date) }];
      }, []),
    [points]
  );

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-bold" style={{ color: "#0f172a" }}>Dashboard</h1>
        <p className="text-sm mt-1" style={{ color: "#5B7285" }}>Here's what's happening across your platform</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-5 mb-5">
        <StatCard label="Total Partners" value={summary.total_partners ?? "..."} icon="partners" tint="#E8F3FB" color="#1E6091" />
        <StatCard label="Total Users" value={summary.total_users ?? "..."} icon="user" tint="#E6F5EA" color="#3D7A1F" />
        <StatCard label="Total Orders" value={summary.total_orders ?? "..."} icon="orders" tint="#E3F1F4" color="#176B87" />
        <StatCard label="Pending Orders" value={summary.pending_orders ?? "..."} icon="clock" tint="#FEF3C7" color="#B45309" />
        <StatCard label="Revenue" value={summary.revenue !== undefined ? formatCurrency(summary.revenue) : "..."} icon="revenue" tint="#E6F5EA" color="#3D7A1F" />
      </div>

      <h2 className="font-semibold mb-3" style={{ color: "#0f172a" }}>Trends</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 mb-5">
        <div className="rounded-2xl overflow-hidden" style={card}>
          <div className="h-1" style={{ background: GRADIENTS["#1E6091"] }} />
          <div className="p-5">
            <h2 className="font-semibold mb-1" style={{ color: "#0f172a" }}>Orders Trend</h2>
            <TrendChart points={orderPoints} color="#1E6091" formatValue={(v) => `${v} order${v === 1 ? "" : "s"}`} emptyLabel="No orders in this range" height={150} />
          </div>
        </div>
        <div className="rounded-2xl overflow-hidden" style={card}>
          <div className="h-1" style={{ background: GRADIENTS["#3D7A1F"] }} />
          <div className="p-5">
            <h2 className="font-semibold mb-1" style={{ color: "#0f172a" }}>Revenue Trend</h2>
            <TrendChart points={revenuePoints} color="#16A34A" formatValue={(v) => formatCurrency(v)} emptyLabel="No revenue data available" height={150} />
          </div>
        </div>
        <div className="rounded-2xl overflow-hidden" style={card}>
          <div className="h-1" style={{ background: GRADIENTS["#176B87"] }} />
          <div className="p-5">
            <h2 className="font-semibold mb-1" style={{ color: "#0f172a" }}>Partner Growth Trend</h2>
            <TrendChart points={partnerGrowthPoints} color="#176B87" formatValue={(v) => `${v} partner${v === 1 ? "" : "s"}`} emptyLabel="No partner growth data available" height={150} />
          </div>
        </div>
      </div>

      <h2 className="font-semibold mb-3" style={{ color: "#0f172a" }}>Orders by Service</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 mb-5">
        {ordersByService.length === 0 ? (
          <div className="col-span-full rounded-2xl p-5 text-sm" style={{ ...card, color: "#5B7285" }}>
            {dashboardData ? "No orders placed yet." : "Loading..."}
          </div>
        ) : (
          ordersByService.map((s) => (
            <div key={s.service_name} className="rounded-2xl overflow-hidden" style={card}>
              <div className="h-1" style={{ background: GRADIENTS["#1E6091"] }} />
              <div className="p-4">
                <p className="text-xs font-medium truncate" style={{ color: "#5B7285" }}>{s.service_name}</p>
                <p className="text-2xl font-bold mt-1.5" style={{ color: "#0f172a" }}>{s.order_count}</p>
              </div>
            </div>
          ))
        )}
      </div>

      {user?.role === "platform_admin" && (
        <div className="rounded-2xl p-6" style={card}>
          <h2 className="font-semibold mb-4" style={{ color: "#0f172a" }}>Quick Actions</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {quickActions.map((action) => (
              <a key={action.href} href={action.href} className="flex items-center gap-3 p-4 rounded-xl transition-all duration-150 hover:scale-[1.03] hover:shadow-lg text-white" style={{ background: action.bg, textDecoration: "none", boxShadow: "0 2px 8px rgba(15,23,42,0.08)" }}>
                <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: "rgba(255,255,255,0.2)" }}>
                  <IconGlyph name={action.icon} size={16} />
                </span>
                <span className="text-sm font-semibold">{action.label}</span>
              </a>
            ))}
          </div>
        </div>
      )}

      {user?.role === "platform_admin" && (
        <div className="mt-8">
          <div className="flex items-center gap-3 mb-5">
            <h2 className="text-lg font-bold shrink-0" style={{ color: "#0f172a" }}>B2C Overview</h2>
            <div className="h-px flex-1" style={{ background: "#D8E6F0" }} />
          </div>
          <B2COverview />
        </div>
      )}
    </div>
  );
};

export default Dashboard;
