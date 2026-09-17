import { useEffect, useState } from "react";
import { apiRequest } from "../../lib/api";
import { formatCurrency } from "../../lib/format";

const inputClass = "w-full px-4 py-2.5 text-sm rounded-xl outline-none transition-all";
const inputStyle = { background: "#F3F8FB", border: "1px solid #D8E6F0", color: "#1e293b" };
const card = { background: "#fff", border: "1px solid #D8E6F0", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" };

const Field = ({ label, children }) => (
  <div>
    <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#5B7285" }}>{label}</label>
    {children}
  </div>
);

const formatDate = (value) =>
  value ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "-";

const PartnerTransactions = () => {
  const [users, setUsers] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ userId: "", dateFrom: "", dateTo: "" });

  useEffect(() => {
    apiRequest("/api/partner/wallets/users").then(setUsers).catch(() => setUsers([]));
  }, []);

  const loadTransactions = () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filters.userId) params.set("user_id", filters.userId);
    if (filters.dateFrom) params.set("date_from", filters.dateFrom);
    if (filters.dateTo) params.set("date_to", filters.dateTo);
    const qs = params.toString();
    apiRequest(`/api/partner/wallet/transactions${qs ? `?${qs}` : ""}`)
      .then(setTransactions)
      .catch(() => setTransactions([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadTransactions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  const clearFilters = () => setFilters({ userId: "", dateFrom: "", dateTo: "" });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: "#0f172a" }}>Transactions</h1>
        <p className="text-sm mt-1" style={{ color: "#5B7285" }}>All wallet transfers made to your users</p>
      </div>

      <div className="rounded-2xl p-4 mb-5 grid grid-cols-1 md:grid-cols-4 gap-3 items-end" style={card}>
        <Field label="User">
          <select value={filters.userId} onChange={(e) => setFilters({ ...filters, userId: e.target.value })} className={inputClass} style={inputStyle}>
            <option value="">All users</option>
            {users.map((u) => (
              <option key={u.membership_id} value={u.membership_id}>{u.full_name}</option>
            ))}
          </select>
        </Field>
        <Field label="From Date">
          <input type="date" value={filters.dateFrom} onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })} className={inputClass} style={inputStyle} />
        </Field>
        <Field label="To Date">
          <input type="date" value={filters.dateTo} onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })} className={inputClass} style={inputStyle} />
        </Field>
        <button onClick={clearFilters} className="px-4 py-2.5 rounded-xl text-sm font-medium" style={{ background: "#E2EBF4", color: "#5B7285" }}>
          Clear Filters
        </button>
      </div>

      <div className="rounded-2xl overflow-hidden" style={card}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ background: "#F3F8FB", borderBottom: "1px solid #D8E6F0" }}>
                {["Date", "User", "Credit Amount", "Remarks", "Balance After Transaction"].map((h) => (
                  <th key={h} className="text-left px-5 py-3.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: "#5B7285" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {transactions.map((t) => (
                <tr key={t.id} className="border-t transition-colors hover:bg-slate-50/50" style={{ borderColor: "#E2EBF4" }}>
                  <td className="px-5 py-4 text-sm whitespace-nowrap" style={{ color: "#5B7285" }}>{formatDate(t.created_at)}</td>
                  <td className="px-5 py-4">
                    <p className="text-sm font-semibold" style={{ color: "#1e293b" }}>{t.full_name}</p>
                    <p className="text-xs" style={{ color: "#5B7285" }}>{t.email}</p>
                  </td>
                  <td className="px-5 py-4 text-sm font-semibold" style={{ color: "#3D7A1F" }}>{formatCurrency(t.amount)}</td>
                  <td className="px-5 py-4 text-sm" style={{ color: "#5B7285" }}>{t.description || "-"}</td>
                  <td className="px-5 py-4 text-sm" style={{ color: "#1e293b" }}>{formatCurrency(t.balance_after)}</td>
                </tr>
              ))}
              {!loading && transactions.length === 0 && (
                <tr>
                  <td colSpan="5" className="text-center py-16 text-sm" style={{ color: "#5B7285" }}>No transactions found.</td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td colSpan="5" className="text-center py-16 text-sm" style={{ color: "#5B7285" }}>Loading transactions...</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex justify-between items-center px-5 py-4 border-t" style={{ borderColor: "#E2EBF4" }}>
          <p className="text-sm" style={{ color: "#5B7285" }}>Showing <span className="font-semibold" style={{ color: "#1e293b" }}>{transactions.length}</span> transactions</p>
        </div>
      </div>
    </div>
  );
};

export default PartnerTransactions;

