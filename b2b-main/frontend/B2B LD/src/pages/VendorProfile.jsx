import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { apiRequest } from "../lib/api";
import { formatCurrency } from "../lib/format";
import { useAuth } from "../lib/AuthContext";
import { portalBase } from "../lib/roleHome";
import Tabs from "../components/Tabs";
import StatCard from "../components/StatCard";
import StatusBadge from "../components/StatusBadge";
import PlaceholderNotice from "../components/PlaceholderNotice";
import AssignOrderModal from "../components/AssignOrderModal";
import TrendChart from "../components/TrendChart";

const card = { background: "#fff", border: "1px solid #D8E6F0", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" };

const Field = ({ label, children }) => (
  <div>
    <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#5B7285" }}>{label}</label>
    {children}
  </div>
);

const Pill = ({ label, checked, onChange }) => (
  <label className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer text-sm font-medium" style={{ background: checked ? "#E6F5EA" : "#fff", border: `1px solid ${checked ? "#16A34A" : "#D8E6F0"}`, color: checked ? "#3D7A1F" : "#5B7285" }}>
    <input type="checkbox" checked={checked} onChange={onChange} className="accent-[#16A34A]" />
    {label}
  </label>
);

const formatDate = (value) =>
  value ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "-";

const formatDateTime = (value) =>
  value
    ? new Date(value).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "-";

const PENDING_STATUSES = ["Draft", "Submitted", "In Progress"];

const ORDER_STATUS_MAP = {
  Draft: { label: "Draft", bg: "#E2EBF4", color: "#5B7285", dot: "#94A3B8" },
  Submitted: { label: "Submitted", bg: "#E8F3FB", color: "#1E6091", dot: "#1E6091" },
  "In Progress": { label: "In Progress", bg: "#FEF3C7", color: "#92400E", dot: "#D97706" },
  Completed: { label: "Completed", bg: "#E6F5EA", color: "#3D7A1F", dot: "#16A34A" },
  Failed: { label: "Failed", bg: "#FDECEC", color: "#C0392B", dot: "#C0392B" },
  Cancelled: { label: "Cancelled", bg: "#F1F5F9", color: "#64748B", dot: "#94A3B8" },
};

const Muted = ({ children = "—" }) => <span style={{ color: "#cbd5e1" }}>{children}</span>;

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "states", label: "Assigned States" },
  { key: "orders", label: "Orders" },
  { key: "wallet", label: "Wallet" },
  { key: "revenue", label: "Revenue" },
  { key: "timeline", label: "Timeline" },
  { key: "audit", label: "Audit Log" },
];

const EmptyRow = ({ colSpan, children }) => (
  <tr>
    <td colSpan={colSpan} className="text-center py-12 text-sm" style={{ color: "#5B7285" }}>{children}</td>
  </tr>
);

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

const VendorProfile = () => {
  const { vendorId } = useParams();
  const { user } = useAuth();
  const base = portalBase(user);
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = TABS.some((t) => t.key === searchParams.get("tab")) ? searchParams.get("tab") : "overview";

  const [vendor, setVendor] = useState(null);
  const [statesData, setStatesData] = useState([]);
  const [orders, setOrders] = useState([]);
  const [wallet, setWallet] = useState(null);
  const [revenue, setRevenue] = useState(null);
  const [revenueTrend, setRevenueTrend] = useState([]);
  const [timeline, setTimeline] = useState([]);
  const [toast, setToast] = useState(null);
  const [savingCoverage, setSavingCoverage] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const loadOrders = () =>
    apiRequest(`/api/vendors/order-assignments?vendor_id=${vendorId}`).then(setOrders).catch(() => setOrders([]));

  useEffect(() => {
    apiRequest(`/api/vendors/${vendorId}`).then(setVendor).catch(() => setVendor(null));
    apiRequest(`/api/vendors/${vendorId}/states`).then((r) => setStatesData(r.states)).catch(() => setStatesData([]));
    loadOrders();
    apiRequest(`/api/vendors/${vendorId}/wallet`).then(setWallet).catch(() => setWallet(null));
    apiRequest(`/api/vendors/${vendorId}/revenue`).then(setRevenue).catch(() => setRevenue(null));
    apiRequest(`/api/vendors/${vendorId}/revenue/trend?days=30`).then((r) => setRevenueTrend(r.points)).catch(() => setRevenueTrend([]));
    apiRequest(`/api/vendors/${vendorId}/timeline`).then(setTimeline).catch(() => setTimeline([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorId]);

  const setTab = (key) => setSearchParams(key === "overview" ? {} : { tab: key });

  const assignedStateCount = statesData.filter((s) => s.is_active).length;
  const pendingOrders = orders.filter((o) => PENDING_STATUSES.includes(o.current_status)).length;
  const completedOrders = orders.filter((o) => o.current_status === "Completed").length;
  const cancelledOrders = orders.filter((o) => o.current_status === "Cancelled").length;

  const toggleState = (stateId) =>
    setStatesData((prev) => prev.map((s) => (s.state_id === stateId ? { ...s, is_active: !s.is_active } : s)));

  const handleSaveStates = async () => {
    setSavingCoverage(true);
    try {
      const result = await apiRequest(`/api/vendors/${vendorId}/states`, {
        method: "PUT",
        body: JSON.stringify({ states: statesData.map((s) => ({ state_id: s.state_id, is_active: s.is_active })) }),
      });
      setStatesData(result.states);
      showToast("States saved.");
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setSavingCoverage(false);
    }
  };

  return (
    <div>
      {toast && (
        <div className="fixed top-5 right-5 z-50 px-5 py-3 rounded-xl text-sm font-semibold shadow-lg text-white transition-all" style={{ background: toast.type === "error" ? "#176B87" : "#16A34A" }}>
          {toast.msg}
        </div>
      )}

      <div className="mb-6">
        <Link to={`${base}/vendor-list`} className="text-xs font-semibold inline-flex items-center gap-1 mb-2" style={{ color: "#16A34A" }}>
          ← Back to Vendor List
        </Link>
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-bold" style={{ color: "#0f172a" }}>{vendor ? vendor.vendor_name : "Loading vendor..."}</h1>
          {vendor && <StatusBadge status={vendor.is_active} />}
        </div>
        {vendor && (
          <p className="text-sm mt-1" style={{ color: "#5B7285" }}>
            {vendor.vendor_type} · {vendor.payment_mode === "PPS" ? "Self PPS" : "Wallet"} · {vendor.email}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Orders" value={orders.length} />
        <StatCard label="Pending Orders" value={pendingOrders} />
        <StatCard label="Completed Orders" value={completedOrders} />
        <StatCard label="Cancelled Orders" value={cancelledOrders} />
        <StatCard label="Wallet Balance" value={vendor?.payment_mode === "PPS" ? "—" : wallet ? formatCurrency(wallet.balance) : "..."} />
        <StatCard label="Revenue Earned" value={revenue ? formatCurrency(revenue.total_revenue) : "..."} />
        <StatCard label="Assigned States" value={assignedStateCount} />
      </div>

      <Tabs tabs={TABS} activeKey={activeTab} onChange={setTab} />

      {activeTab === "overview" && (
        <div className="space-y-6">
          <section className="rounded-2xl p-6" style={card}>
            <h2 className="text-base font-bold mb-4" style={{ color: "#0f172a" }}>Basic Details</h2>
            {!vendor ? (
              <p className="text-sm" style={{ color: "#5B7285" }}>Loading...</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Vendor Name"><p className="text-sm" style={{ color: "#1e293b" }}>{vendor.vendor_name}</p></Field>
                <Field label="Vendor ID"><p className="text-sm font-mono" style={{ color: "#1e293b" }}>{vendor.id}</p></Field>
                <Field label="Vendor Type"><p className="text-sm" style={{ color: "#1e293b" }}>{vendor.vendor_type}</p></Field>
                <Field label="GST Number"><p className="text-sm" style={{ color: "#1e293b" }}>{vendor.gst_number || "-"}</p></Field>
                <Field label="Contact Person"><p className="text-sm" style={{ color: "#1e293b" }}>{vendor.contact_person || "-"}</p></Field>
                <Field label="Email"><p className="text-sm" style={{ color: "#1e293b" }}>{vendor.email}</p></Field>
                <Field label="Mobile"><p className="text-sm" style={{ color: "#1e293b" }}>{vendor.mobile || "-"}</p></Field>
                <Field label="City / State"><p className="text-sm" style={{ color: "#1e293b" }}>{[vendor.city, vendor.state_name].filter(Boolean).join(", ") || "-"}</p></Field>
                <Field label="Status"><StatusBadge status={vendor.is_active} /></Field>
                <Field label="Created Date"><p className="text-sm" style={{ color: "#1e293b" }}>{formatDate(vendor.created_at)}</p></Field>
                <div className="md:col-span-2">
                  <Field label="Address"><p className="text-sm" style={{ color: "#1e293b" }}>{vendor.address || "-"}</p></Field>
                </div>
              </div>
            )}
          </section>

          <section className="rounded-2xl p-6" style={card}>
            <h2 className="text-base font-bold mb-4" style={{ color: "#0f172a" }}>Payment Configuration</h2>
            {vendor?.payment_mode === "PPS" ? (
              <PlaceholderNotice title="Self PPS (Pay Per Service)" message="This vendor is paid per completed service instead of using a wallet." />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="rounded-xl p-4" style={{ background: "#F3F8FB", border: "1px solid #D8E6F0" }}>
                  <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#5B7285" }}>Wallet Balance</p>
                  <p className="text-xl font-bold mt-1" style={{ color: "#1E6091" }}>{wallet ? formatCurrency(wallet.balance) : "..."}</p>
                </div>
                <div className="rounded-xl p-4" style={{ background: "#F3F8FB", border: "1px solid #D8E6F0" }}>
                  <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#5B7285" }}>Total Credits</p>
                  <p className="text-xl font-bold mt-1" style={{ color: "#3D7A1F" }}>{wallet ? formatCurrency(wallet.total_credits) : "..."}</p>
                </div>
                <div className="rounded-xl p-4" style={{ background: "#F3F8FB", border: "1px solid #D8E6F0" }}>
                  <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#5B7285" }}>Total Debits</p>
                  <p className="text-xl font-bold mt-1" style={{ color: "#1E6091" }}>{wallet ? formatCurrency(wallet.total_debits) : "..."}</p>
                </div>
              </div>
            )}
          </section>

          <section className="rounded-2xl p-6" style={card}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold" style={{ color: "#0f172a" }}>Recent Activity</h2>
              <button onClick={() => setTab("timeline")} className="text-xs font-semibold" style={{ color: "#1E6091" }}>View full timeline →</button>
            </div>
            {timeline.length === 0 ? (
              <p className="text-sm" style={{ color: "#5B7285" }}>No activity yet.</p>
            ) : (
              <div className="space-y-2">
                {timeline.slice(0, 5).map((event, i) => (
                  <div key={i} className="flex items-center gap-3 text-sm">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "#1E6091" }}></span>
                    <span className="font-semibold" style={{ color: "#1e293b" }}>{event.action}</span>
                    <span className="truncate" style={{ color: "#5B7285" }}>{event.label}</span>
                    <span className="ml-auto text-xs whitespace-nowrap" style={{ color: "#94A3B8" }}>{formatDateTime(event.created_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {activeTab === "states" && (
        <section className="rounded-2xl p-6" style={card}>
          <div className="flex justify-between items-center mb-1">
            <h2 className="text-base font-bold" style={{ color: "#0f172a" }}>Assigned States</h2>
            <button onClick={handleSaveStates} disabled={savingCoverage} className="px-5 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-60" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>
              {savingCoverage ? "Saving..." : "Save States"}
            </button>
          </div>
          <p className="text-xs mb-4" style={{ color: "#5B7285" }}>States this vendor is eligible to serve orders in.</p>
          <div className="flex flex-wrap gap-2">
            {statesData.map((s) => (
              <Pill key={s.state_id} label={s.state_name} checked={s.is_active} onChange={() => toggleState(s.state_id)} />
            ))}
          </div>
          {assignedStateCount > 0 && (
            <div className="mt-6">
              <TableShell headers={["State", "Status", "Assigned Date"]}>
                {statesData.filter((s) => s.is_active).map((s) => (
                  <tr key={s.state_id} className="border-t" style={{ borderColor: "#E2EBF4" }}>
                    <td className="px-4 py-3 text-sm font-semibold" style={{ color: "#1e293b" }}>{s.state_name}</td>
                    <td className="px-4 py-3"><StatusBadge status={s.is_active} /></td>
                    <td className="px-4 py-3 text-sm whitespace-nowrap" style={{ color: "#5B7285" }}>{formatDate(s.assigned_at)}</td>
                  </tr>
                ))}
              </TableShell>
            </div>
          )}
        </section>
      )}

      {activeTab === "orders" && (
        <section className="rounded-2xl p-6" style={card}>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-base font-bold" style={{ color: "#0f172a" }}>Orders</h2>
            {vendor && (
              <button onClick={() => setShowAssignModal(true)} className="px-4 py-2 rounded-xl text-sm font-semibold" style={{ background: "#EFE8FB", color: "#6B21A8" }}>
                Assign Orders
              </button>
            )}
          </div>
          <TableShell headers={["Order ID", "Customer", "Partner", "State", "Service", "Assigned Date", "Completed Date", "SLA Status", "Current Status"]}>
            {orders.map((o) => (
              <tr key={o.assignment_id} className="border-t" style={{ borderColor: "#E2EBF4" }}>
                <td className="px-4 py-3 text-sm font-semibold" style={{ color: "#1e293b" }}>{o.order_no}</td>
                <td className="px-4 py-3 text-sm" style={{ color: "#1e293b" }}>{o.customer_name || <Muted />}</td>
                <td className="px-4 py-3 text-sm" style={{ color: "#1e293b" }}>{o.partner_name}</td>
                <td className="px-4 py-3 text-sm" style={{ color: "#1e293b" }}>{o.state_name || <Muted />}</td>
                <td className="px-4 py-3 text-sm" style={{ color: "#1e293b" }}>{o.service_name || <Muted />}</td>
                <td className="px-4 py-3 text-sm whitespace-nowrap" style={{ color: "#5B7285" }}>{formatDate(o.assigned_at)}</td>
                <td className="px-4 py-3 text-sm whitespace-nowrap" style={{ color: "#5B7285" }}>{o.completed_at ? formatDate(o.completed_at) : <Muted />}</td>
                <td className="px-4 py-3 text-sm"><Muted>Not tracked</Muted></td>
                <td className="px-4 py-3"><StatusBadge status={o.current_status} map={ORDER_STATUS_MAP} /></td>
              </tr>
            ))}
            {orders.length === 0 && <EmptyRow colSpan={9}>No orders assigned yet.</EmptyRow>}
          </TableShell>
        </section>
      )}

      {activeTab === "wallet" && (
        <section className="rounded-2xl p-6" style={card}>
          <h2 className="text-base font-bold mb-4" style={{ color: "#0f172a" }}>Wallet</h2>
          {vendor?.payment_mode === "PPS" ? (
            <PlaceholderNotice title="Not applicable" message="This vendor is paid per completed service instead of using a wallet." />
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
                <div className="rounded-xl p-4" style={{ background: "#F3F8FB", border: "1px solid #D8E6F0" }}>
                  <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#5B7285" }}>Current Balance</p>
                  <p className="text-lg font-bold mt-1" style={{ color: "#1E6091" }}>{wallet ? formatCurrency(wallet.balance) : "..."}</p>
                </div>
                <div className="rounded-xl p-4" style={{ background: "#F3F8FB", border: "1px solid #D8E6F0" }}>
                  <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#5B7285" }}>Total Credits</p>
                  <p className="text-lg font-bold mt-1" style={{ color: "#3D7A1F" }}>{wallet ? formatCurrency(wallet.total_credits) : "..."}</p>
                </div>
                <div className="rounded-xl p-4" style={{ background: "#F3F8FB", border: "1px solid #D8E6F0" }}>
                  <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#5B7285" }}>Total Debits</p>
                  <p className="text-lg font-bold mt-1" style={{ color: "#1E6091" }}>{wallet ? formatCurrency(wallet.total_debits) : "..."}</p>
                </div>
                <div className="rounded-xl p-4" style={{ background: "#F3F8FB", border: "1px solid #D8E6F0" }}>
                  <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#5B7285" }}>Pending Settlement</p>
                  <p className="text-lg font-bold mt-1"><Muted>Not tracked</Muted></p>
                </div>
                <div className="rounded-xl p-4" style={{ background: "#F3F8FB", border: "1px solid #D8E6F0" }}>
                  <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#5B7285" }}>Last Recharge</p>
                  <p className="text-lg font-bold mt-1" style={{ color: "#1e293b" }}>{wallet?.last_recharge_at ? formatDate(wallet.last_recharge_at) : <Muted />}</p>
                </div>
              </div>
              {vendor && (
                <div className="mb-4 flex justify-end">
                  <Link to={`${base}/vendors/${vendor.id}/wallet`} className="text-xs font-semibold" style={{ color: "#1E6091" }}>Manage Wallet (Credit / Debit) →</Link>
                </div>
              )}
              <TableShell headers={["Date", "Type", "Amount", "Balance After", "Description"]}>
                {(wallet?.transactions || []).map((t) => (
                  <tr key={t.id} className="border-t" style={{ borderColor: "#E2EBF4" }}>
                    <td className="px-4 py-3 text-sm" style={{ color: "#5B7285" }}>{formatDate(t.created_at)}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs font-semibold px-2.5 py-1 rounded-full capitalize" style={{ background: t.type === "credit" ? "#E6F5EA" : "#E8F3FB", color: t.type === "credit" ? "#3D7A1F" : "#1E6091" }}>{t.type}</span>
                    </td>
                    <td className="px-4 py-3 text-sm font-semibold" style={{ color: "#1e293b" }}>{formatCurrency(t.amount)}</td>
                    <td className="px-4 py-3 text-sm" style={{ color: "#1e293b" }}>{formatCurrency(t.balance_after)}</td>
                    <td className="px-4 py-3 text-sm" style={{ color: "#5B7285" }}>{t.description || <Muted />}</td>
                  </tr>
                ))}
                {(wallet?.transactions || []).length === 0 && <EmptyRow colSpan={5}>No wallet transactions yet.</EmptyRow>}
              </TableShell>
            </>
          )}
        </section>
      )}

      {activeTab === "revenue" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatCard label="Total Revenue" value={revenue ? formatCurrency(revenue.total_revenue) : "..."} />
            <StatCard label="This Month" value={revenue ? formatCurrency(revenue.this_month_revenue) : "..."} />
            <StatCard label="Today" value={revenue ? formatCurrency(revenue.today_revenue) : "..."} />
          </div>
          <section className="rounded-2xl p-6" style={card}>
            <h2 className="text-base font-bold mb-4" style={{ color: "#0f172a" }}>Revenue Trend (30 days)</h2>
            <TrendChart
              points={revenueTrend.map((p) => ({ date: p.date, value: p.revenue, label: new Date(`${p.date}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) }))}
              color="#16A34A"
              formatValue={formatCurrency}
            />
          </section>
          <section className="rounded-2xl p-6" style={card}>
            <h2 className="text-base font-bold mb-4" style={{ color: "#0f172a" }}>Revenue by Service</h2>
            <TableShell headers={["Service", "Revenue"]}>
              {(revenue?.by_service || []).map((s) => (
                <tr key={s.service_name} className="border-t" style={{ borderColor: "#E2EBF4" }}>
                  <td className="px-4 py-3 text-sm font-semibold" style={{ color: "#1e293b" }}>{s.service_name || <Muted />}</td>
                  <td className="px-4 py-3 text-sm" style={{ color: "#1e293b" }}>{formatCurrency(s.revenue)}</td>
                </tr>
              ))}
              {(revenue?.by_service || []).length === 0 && <EmptyRow colSpan={2}>No completed orders yet.</EmptyRow>}
            </TableShell>
          </section>
        </div>
      )}

      {activeTab === "timeline" && (
        <section className="rounded-2xl p-6" style={card}>
          <h2 className="text-base font-bold mb-1" style={{ color: "#0f172a" }}>Activity Timeline</h2>
          <p className="text-xs mb-4" style={{ color: "#5B7285" }}>Synthesized from existing record timestamps — most recent first.</p>
          {timeline.length === 0 ? (
            <p className="text-sm py-8 text-center" style={{ color: "#5B7285" }}>No activity yet.</p>
          ) : (
            <div className="space-y-3">
              {timeline.map((event, i) => (
                <div key={i} className="flex items-start gap-3 rounded-xl p-3" style={{ background: "#F3F8FB", border: "1px solid #D8E6F0" }}>
                  <span className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: "#1E6091" }}></span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold" style={{ color: "#1e293b" }}>{event.action}</p>
                    <p className="text-xs truncate" style={{ color: "#5B7285" }}>{event.label}</p>
                  </div>
                  <span className="ml-auto text-xs whitespace-nowrap" style={{ color: "#94A3B8" }}>{formatDateTime(event.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {activeTab === "audit" && (
        <section className="rounded-2xl p-6" style={card}>
          <h2 className="text-base font-bold mb-4" style={{ color: "#0f172a" }}>Audit Log</h2>
          <PlaceholderNotice
            title="Audit Log — Coming Soon"
            message="Tracking who changed what isn't instrumented yet. The Timeline tab shows what's derivable from existing records today."
          />
        </section>
      )}

      {showAssignModal && vendor && (
        <AssignOrderModal
          vendor={vendor}
          onClose={() => setShowAssignModal(false)}
          onAssigned={() => {
            loadOrders();
            setShowAssignModal(false);
            showToast("Order assigned.");
          }}
        />
      )}
    </div>
  );
};

export default VendorProfile;
