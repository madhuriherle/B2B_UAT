import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiRequest } from "../lib/api";
import { formatCurrency } from "../lib/format";
import { useAuth } from "../lib/AuthContext";
import { portalBase } from "../lib/roleHome";
import StatCard from "../components/StatCard";
import StatusBadge from "../components/StatusBadge";

const card = { background: "#fff", border: "1px solid #D8E6F0", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" };

const formatDate = (value) =>
  value ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "-";

const PAYMENT_BADGE = {
  success: { bg: "#E6F5EA", color: "#3D7A1F", label: "Paid" },
  pending: { bg: "#FEF3C7", color: "#92400E", label: "Pending" },
  failed: { bg: "#FDECEC", color: "#C0392B", label: "Failed" },
};

const Badge = ({ status }) => {
  const s = PAYMENT_BADGE[status] || { bg: "#E2EBF4", color: "#5B7285", label: status || "-" };
  return <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-semibold" style={{ background: s.bg, color: s.color }}>{s.label}</span>;
};

const Field = ({ label, children }) => (
  <div>
    <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#5B7285" }}>{label}</label>
    {children}
  </div>
);

const CustomerProfile = () => {
  const { userId } = useParams();
  const { user } = useAuth();
  const base = portalBase(user);
  const [customer, setCustomer] = useState(null);

  useEffect(() => {
    apiRequest(`/api/admin/b2c-customers/${userId}`).then(setCustomer).catch(() => setCustomer(null));
  }, [userId]);

  return (
    <div>
      <div className="mb-6">
        <Link to={`${base}/customers/b2c`} className="text-xs font-semibold inline-flex items-center gap-1 mb-2" style={{ color: "#16A34A" }}>
          ← Back to B2C Customers
        </Link>
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-bold" style={{ color: "#0f172a" }}>{customer ? customer.name : "Loading customer..."}</h1>
          {customer && <StatusBadge status={customer.is_active} />}
        </div>
        {customer && <p className="text-sm mt-1" style={{ color: "#5B7285" }}>{customer.email}</p>}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Orders" value={customer?.total_orders ?? "..."} />
        <StatCard label="Total Spent" value={customer ? formatCurrency(customer.total_spent) : "..."} />
        <StatCard label="Mobile" value={customer?.mobile || "-"} />
        <StatCard label="Customer Since" value={customer ? formatDate(customer.created_at) : "..."} />
      </div>

      <section className="rounded-2xl p-6 mb-6" style={card}>
        <h2 className="text-base font-bold mb-4" style={{ color: "#0f172a" }}>Basic Details</h2>
        {!customer ? (
          <p className="text-sm" style={{ color: "#5B7285" }}>Loading...</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Name"><p className="text-sm" style={{ color: "#1e293b" }}>{customer.name}</p></Field>
            <Field label="Email"><p className="text-sm" style={{ color: "#1e293b" }}>{customer.email}</p></Field>
            <Field label="Mobile"><p className="text-sm" style={{ color: "#1e293b" }}>{customer.mobile || "-"}</p></Field>
            <Field label="City"><p className="text-sm" style={{ color: "#1e293b" }}>{customer.city || "-"}</p></Field>
            <Field label="State"><p className="text-sm" style={{ color: "#1e293b" }}>{customer.state || "-"}</p></Field>
            <div className="md:col-span-2">
              <Field label="Address"><p className="text-sm" style={{ color: "#1e293b" }}>{customer.address || "-"}</p></Field>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-2xl p-6" style={card}>
        <h2 className="text-base font-bold mb-4" style={{ color: "#0f172a" }}>Order History</h2>
        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid #D8E6F0" }}>
          <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ background: "#F3F8FB" }}>
                {["Order ID", "Document", "Amount", "Payment", "Status", "Date"].map((h) => (
                  <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: "#5B7285" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!customer || customer.orders.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-10 text-sm" style={{ color: "#5B7285" }}>{customer ? "No orders yet." : "Loading..."}</td></tr>
              ) : (
                customer.orders.map((o) => (
                  <tr key={o.user_doc_id} className="border-t" style={{ borderColor: "#E2EBF4" }}>
                    <td className="px-4 py-3 text-sm font-mono font-semibold" style={{ color: "#6B21A8" }}>#{o.user_doc_id}</td>
                    <td className="px-4 py-3 text-sm" style={{ color: "#1e293b" }}>{o.document_name}</td>
                    <td className="px-4 py-3 text-sm font-semibold" style={{ color: "#0f172a" }}>{o.amount_paid > 0 ? formatCurrency(o.amount_paid) : "-"}</td>
                    <td className="px-4 py-3"><Badge status={o.payment_status} /></td>
                    <td className="px-4 py-3 text-sm capitalize" style={{ color: "#5B7285" }}>{o.doc_status}</td>
                    <td className="px-4 py-3 text-sm whitespace-nowrap" style={{ color: "#5B7285" }}>{formatDate(o.created_at)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          </div>
        </div>
      </section>
    </div>
  );
};

export default CustomerProfile;
