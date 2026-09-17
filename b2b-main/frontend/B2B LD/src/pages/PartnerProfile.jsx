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
import EditPartnerModal from "../components/EditPartnerModal";
import SuccessModal from "../components/SuccessModal";

const card = { background: "#fff", border: "1px solid #D8E6F0", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" };

const Field = ({ label, children }) => (
  <div>
    <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#5B7285" }}>{label}</label>
    {children}
  </div>
);

const formatDate = (value) =>
  value ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "-";

const formatDateTime = (value) =>
  value
    ? new Date(value).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "-";

const PENDING_ORDER_STATUSES = ["Submitted", "In Progress"];

const Muted = ({ children = "—" }) => <span style={{ color: "#cbd5e1" }}>{children}</span>;

const SectionLabel = ({ children }) => (
  <p className="text-[11px] font-bold uppercase tracking-wider mb-3" style={{ color: "#94A3B8" }}>{children}</p>
);

const TWO_FACTOR_MAP = {
  true: { label: "Enabled", bg: "#E6F5EA", color: "#3D7A1F", dot: "#16A34A" },
  false: { label: "Disabled", bg: "#E2EBF4", color: "#5B7285", dot: "#94A3B8" },
};

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "services", label: "Assigned Services" },
  { key: "users", label: "Partner Users" },
  { key: "revenue", label: "Revenue" },
  { key: "wallet", label: "Wallet" },
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

const PartnerProfile = () => {
  const { organizationId } = useParams();
  const { user } = useAuth();
  const base = portalBase(user);
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = TABS.some((t) => t.key === searchParams.get("tab")) ? searchParams.get("tab") : "overview";

  const [partner, setPartner] = useState(null);
  const [users, setUsers] = useState([]);
  const [pricing, setPricing] = useState({ services: [] });
  const [wallet, setWallet] = useState(null);
  const [orders, setOrders] = useState([]);
  const [revenue, setRevenue] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [states, setStates] = useState([]);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  const loadPartner = () => apiRequest(`/api/organizations/${organizationId}`).then(setPartner).catch(() => setPartner(null));

  useEffect(() => {
    apiRequest(`/api/organizations/${organizationId}`).then(setPartner).catch(() => setPartner(null));
    apiRequest(`/api/organizations/${organizationId}/users`).then(setUsers).catch(() => setUsers([]));
    apiRequest(`/api/organizations/${organizationId}/pricing`).then(setPricing).catch(() => setPricing({ services: [] }));
    apiRequest(`/api/organizations/${organizationId}/wallet`).then(setWallet).catch(() => setWallet(null));
    apiRequest(`/api/reports/orders?organization_id=${organizationId}`).then(setOrders).catch(() => setOrders([]));
    apiRequest(`/api/organizations/${organizationId}/revenue`).then(setRevenue).catch(() => setRevenue(null));
    apiRequest(`/api/organizations/${organizationId}/timeline`).then(setTimeline).catch(() => setTimeline([]));
    apiRequest("/api/catalog/states").then(setStates).catch(() => setStates([]));
  }, [organizationId]);

  const setTab = (key) => setSearchParams(key === "overview" ? {} : { tab: key });

  const pendingOrders = orders.filter((o) => PENDING_ORDER_STATUSES.includes(o.status)).length;

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <Link to={`${base}/customer-list`} className="text-xs font-semibold inline-flex items-center gap-1 mb-2" style={{ color: "#16A34A" }}>
            ← Back to Partner List
          </Link>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold" style={{ color: "#0f172a" }}>{partner ? partner.organization_name : "Loading partner..."}</h1>
            {partner && <StatusBadge status={partner.is_active} />}
          </div>
          {partner && (
            <p className="text-sm mt-1" style={{ color: "#5B7285" }}>
              {partner.organization_type || "-"} · {partner.payment_mode === "PPS" ? "Self PPS" : "Wallet"} · {partner.email}
            </p>
          )}
        </div>
        {partner && (
          <button onClick={() => setShowEditModal(true)} className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white shrink-0" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>
            Edit Partner
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Users" value={users.length} />
        <StatCard label="Total Orders" value={orders.length} />
        <StatCard label="Total Revenue" value={revenue ? formatCurrency(revenue.total_revenue) : "..."} />
        <StatCard label="Pending Orders" value={pendingOrders} />
        <StatCard label="Wallet" value={partner?.payment_mode === "PPS" ? "N/A" : wallet ? formatCurrency(wallet.balance) : "..."} />
      </div>

      <Tabs tabs={TABS} activeKey={activeTab} onChange={setTab} />

      {activeTab === "overview" && (
        <div className="space-y-6">
          <section className="rounded-2xl p-6" style={card}>
            <h2 className="text-base font-bold mb-4" style={{ color: "#0f172a" }}>Basic Details</h2>
            {!partner ? (
              <p className="text-sm" style={{ color: "#5B7285" }}>Loading...</p>
            ) : (
              <div className="space-y-5">
                <div>
                  <SectionLabel>Identity</SectionLabel>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <Field label="Partner Name"><p className="text-sm" style={{ color: "#1e293b" }}>{partner.organization_name}</p></Field>
                    <Field label="Partner Type"><p className="text-sm" style={{ color: "#1e293b" }}>{partner.organization_type || "-"}</p></Field>
                    {partner.organization_type === "Retailer" && (
                      <Field label="Retailer Category"><p className="text-sm" style={{ color: "#1e293b" }}>{partner.retailer_category || "-"}</p></Field>
                    )}
                    <Field label="GST Number"><p className="text-sm" style={{ color: "#1e293b" }}>{partner.gst_number || "-"}</p></Field>
                  </div>
                </div>

                <div className="pt-5" style={{ borderTop: "1px solid #E2EBF4" }}>
                  <SectionLabel>Contact &amp; Location</SectionLabel>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <Field label="Contact Person"><p className="text-sm" style={{ color: "#1e293b" }}>{partner.contact_person || "-"}</p></Field>
                    <Field label="Email"><p className="text-sm" style={{ color: "#1e293b" }}>{partner.email}</p></Field>
                    <Field label="Mobile"><p className="text-sm" style={{ color: "#1e293b" }}>{partner.mobile || "-"}</p></Field>
                    <Field label="State"><p className="text-sm" style={{ color: "#1e293b" }}>{partner.state_name || "-"}</p></Field>
                  </div>
                  <div className="mt-4">
                    <Field label="Address">
                      <p className="text-sm" style={{ color: "#1e293b" }}>
                        {[partner.address_line1, partner.address_line2, partner.city, partner.state_name, partner.pincode].filter(Boolean).join(", ") || "-"}
                      </p>
                    </Field>
                  </div>
                </div>

                <div className="pt-5" style={{ borderTop: "1px solid #E2EBF4" }}>
                  <SectionLabel>Account &amp; Security</SectionLabel>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <Field label="Status"><StatusBadge status={partner.is_active} /></Field>
                    <Field label="Payment Mode"><p className="text-sm" style={{ color: "#1e293b" }}>{partner.payment_mode === "PPS" ? "Self PPS (Pay Per Service)" : "Wallet"}</p></Field>
                    <Field label="Two-Factor Authentication"><StatusBadge status={!!partner.two_factor_enabled} map={TWO_FACTOR_MAP} /></Field>
                    <Field label="Created Date"><p className="text-sm" style={{ color: "#1e293b" }}>{formatDate(partner.created_at)}</p></Field>
                  </div>
                </div>
              </div>
            )}
          </section>

          <section className="rounded-2xl p-6" style={card}>
            <h2 className="text-base font-bold mb-4" style={{ color: "#0f172a" }}>Payment Configuration</h2>
            {partner?.payment_mode === "PPS" ? (
              <PlaceholderNotice title="Self PPS (Pay Per Service)" message="This partner is billed per service instead of using a wallet, so there's no wallet balance to show." />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="rounded-xl p-4" style={{ background: "#F3F8FB", border: "1px solid #D8E6F0" }}>
                  <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#5B7285" }}>Wallet Balance</p>
                  <p className="text-xl font-bold mt-1" style={{ color: "#1E6091" }}>{wallet ? formatCurrency(wallet.balance) : "..."}</p>
                </div>
                <div className="rounded-xl p-4" style={{ background: "#F3F8FB", border: "1px solid #D8E6F0" }}>
                  <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#5B7285" }}>Total Wallet Recharge</p>
                  <p className="text-xl font-bold mt-1" style={{ color: "#3D7A1F" }}>{wallet ? formatCurrency(wallet.total_credits) : "..."}</p>
                </div>
                <div className="rounded-xl p-4" style={{ background: "#F3F8FB", border: "1px solid #D8E6F0" }}>
                  <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#5B7285" }}>Total Wallet Used</p>
                  <p className="text-xl font-bold mt-1" style={{ color: "#1E6091" }}>{wallet ? formatCurrency(wallet.total_debits) : "..."}</p>
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {activeTab === "services" && (
        <section className="rounded-2xl p-6" style={card}>
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <h2 className="text-base font-bold" style={{ color: "#0f172a" }}>Assigned Services</h2>
            <Link to={`${base}/quotation?organization_id=${organizationId}`} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: "#E8F3FB", color: "#1E6091" }}>
              Edit Services
            </Link>
          </div>
          <TableShell headers={["Service Name", "Status", "Pricing", "Last Updated"]}>
            {pricing.services.filter((s) => s.is_active).map((s) => (
              <tr key={s.service_name} className="border-t" style={{ borderColor: "#E2EBF4" }}>
                <td className="px-4 py-3 text-sm font-semibold" style={{ color: "#1e293b" }}>{s.service_name}</td>
                <td className="px-4 py-3"><StatusBadge status={s.is_active} /></td>
                <td className="px-4 py-3 text-sm" style={{ color: "#1e293b" }}>{s.price !== null && s.price !== undefined ? formatCurrency(s.price) : <Muted />}</td>
                <td className="px-4 py-3 text-sm whitespace-nowrap" style={{ color: "#5B7285" }}>{formatDateTime(s.updated_at)}</td>
              </tr>
            ))}
            {pricing.services.filter((s) => s.is_active).length === 0 && <EmptyRow colSpan={4}>No services assigned yet.</EmptyRow>}
          </TableShell>
        </section>
      )}

      {activeTab === "users" && (
        <section className="rounded-2xl p-6" style={card}>
          <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
            <h2 className="text-base font-bold" style={{ color: "#0f172a" }}>Partner Users</h2>
            <Link to={`${base}/partners/${organizationId}/users`} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: "#E8F3FB", color: "#1E6091" }}>
              Manage Users
            </Link>
          </div>
          <TableShell headers={["Name", "Role", "Email", "Mobile", "Status"]}>
            {users.map((u) => (
              <tr key={u.id} className="border-t" style={{ borderColor: "#E2EBF4" }}>
                <td className="px-4 py-3 text-sm font-semibold" style={{ color: "#1e293b" }}>{u.full_name}</td>
                <td className="px-4 py-3 text-sm capitalize" style={{ color: "#1e293b" }}>{u.role_name || "-"}</td>
                <td className="px-4 py-3 text-sm" style={{ color: "#1e293b" }}>{u.email}</td>
                <td className="px-4 py-3 text-sm" style={{ color: "#1e293b" }}>{u.mobile || "-"}</td>
                <td className="px-4 py-3"><StatusBadge status={u.is_active} /></td>
              </tr>
            ))}
            {users.length === 0 && <EmptyRow colSpan={5}>No users added yet.</EmptyRow>}
          </TableShell>
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

      {activeTab === "wallet" && (
        <section className="rounded-2xl p-6" style={card}>
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <h2 className="text-base font-bold" style={{ color: "#0f172a" }}>Wallet Transactions</h2>
            {partner?.payment_mode !== "PPS" && (
              <Link to={`${base}/partners/${organizationId}/wallet`} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: "#E8F3FB", color: "#1E6091" }}>
                Manage Wallet
              </Link>
            )}
          </div>
          {partner?.payment_mode === "PPS" ? (
            <PlaceholderNotice title="Not applicable" message="This partner uses Self PPS (Pay Per Service), not a wallet." />
          ) : (
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
          )}
        </section>
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
            message="Tracking who changed what (partner edits, service toggles, user changes) isn't instrumented yet. The Timeline tab shows what's derivable from existing records today."
          />
        </section>
      )}

      {showEditModal && partner && (
        <EditPartnerModal
          partner={partner}
          states={states}
          onClose={() => setShowEditModal(false)}
          onSaved={() => {
            loadPartner();
            setShowEditModal(false);
            setShowSuccess(true);
          }}
        />
      )}

      {showSuccess && <SuccessModal title="Saved Successfully" message="Partner details updated successfully" onOk={() => setShowSuccess(false)} />}
    </div>
  );
};

export default PartnerProfile;
