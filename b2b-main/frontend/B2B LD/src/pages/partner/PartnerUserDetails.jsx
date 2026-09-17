import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiRequest } from "../../lib/api";
import { formatCurrency } from "../../lib/format";

const card = { background: "#fff", border: "1px solid #D8E6F0", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" };

const Field = ({ label, children }) => (
  <div>
    <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: "#5B7285" }}>{label}</p>
    {children}
  </div>
);

const statusBadge = (isActive) =>
  isActive ? (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold" style={{ background: "#E6F5EA", color: "#3D7A1F" }}>
      <span className="w-1.5 h-1.5 rounded-full bg-[#16A34A]"></span>Active
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold" style={{ background: "#E8F3FB", color: "#1E6091" }}>
      <span className="w-1.5 h-1.5 rounded-full bg-[#176B87]"></span>Inactive
    </span>
  );

const formatDate = (value) =>
  value ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "-";

const PartnerUserDetails = () => {
  const { membershipId } = useParams();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiRequest(`/api/partner/users/${membershipId}`)
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, [membershipId]);

  if (loading) {
    return <p className="text-sm" style={{ color: "#5B7285" }}>Loading user...</p>;
  }

  if (!user) {
    return <p className="text-sm" style={{ color: "#5B7285" }}>User not found.</p>;
  }

  const stats = [
    { label: "Total Orders", value: user.total_orders, color: "#1E6091" },
    { label: "Completed Orders", value: user.completed_orders, color: "#3D7A1F" },
    { label: "Pending Orders", value: user.pending_orders, color: "#176B87" },
  ];

  return (
    <div>
      <div className="mb-6">
        <Link to="/partner/users" className="text-xs font-semibold inline-flex items-center gap-1 mb-2" style={{ color: "#16A34A" }}>
          ← Back to Manage Users
        </Link>
        <h1 className="text-2xl font-bold" style={{ color: "#0f172a" }}>{user.full_name}</h1>
        <p className="text-sm mt-1" style={{ color: "#5B7285" }}>User details</p>
      </div>

      <section className="rounded-2xl p-6 mb-6" style={card}>
        <h2 className="text-base font-bold mb-4" style={{ color: "#0f172a" }}>Basic Information</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Field label="Full Name"><p className="text-sm font-medium" style={{ color: "#1e293b" }}>{user.full_name}</p></Field>
          <Field label="Email"><p className="text-sm font-medium" style={{ color: "#1e293b" }}>{user.email}</p></Field>
          <Field label="Mobile Number"><p className="text-sm font-medium" style={{ color: "#1e293b" }}>{user.mobile || "-"}</p></Field>
          <Field label="Status">{statusBadge(user.is_active)}</Field>
          <Field label="Created Date"><p className="text-sm font-medium" style={{ color: "#1e293b" }}>{formatDate(user.created_at)}</p></Field>
        </div>
      </section>

      <section className="rounded-2xl p-6 mb-6" style={card}>
        <h2 className="text-base font-bold mb-4" style={{ color: "#0f172a" }}>Wallet Information</h2>
        <div className="rounded-xl p-5" style={{ background: "#F3F8FB", border: "1px solid #D8E6F0" }}>
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#5B7285" }}>Current Balance</p>
          <p className="text-2xl font-bold mt-1" style={{ color: "#0f172a" }}>{formatCurrency(user.wallet_balance)}</p>
        </div>
      </section>

      <section className="rounded-2xl p-6" style={card}>
        <h2 className="text-base font-bold mb-4" style={{ color: "#0f172a" }}>Statistics</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {stats.map((s) => (
            <div key={s.label} className="rounded-xl p-5" style={{ background: "#F3F8FB", border: "1px solid #D8E6F0" }}>
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#5B7285" }}>{s.label}</p>
              <p className="text-2xl font-bold mt-1.5" style={{ color: s.color }}>{s.value}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

export default PartnerUserDetails;

