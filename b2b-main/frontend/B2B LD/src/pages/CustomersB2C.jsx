import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest } from "../lib/api";
import { formatCurrency } from "../lib/format";
import { useAuth } from "../lib/AuthContext";
import { portalBase } from "../lib/roleHome";

const formatDate = (value) =>
  value ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "-";

const CustomersB2C = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const base = portalBase(user);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    apiRequest("/api/admin/b2c-customers")
      .then((data) => setCustomers(data || []))
      .catch(() => setCustomers([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = customers.filter((c) => {
    const q = search.trim().toLowerCase();
    return q === "" || c.name?.toLowerCase().includes(q) || c.email?.toLowerCase().includes(q);
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: "#0f172a" }}>B2C Customers</h1>
        <p className="text-sm mt-1" style={{ color: "#5B7285" }}>Auto-fetched from registered user order history</p>
      </div>

      <div className="rounded-2xl p-4 mb-5" style={{ background: "#fff", border: "1px solid #D8E6F0" }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or email..."
          className="w-full px-4 py-2.5 text-sm rounded-xl outline-none" style={{ background: "#F3F8FB", border: "1px solid #D8E6F0", color: "#1e293b" }} />
      </div>

      <div className="rounded-2xl overflow-hidden" style={{ background: "#fff", border: "1px solid #D8E6F0", boxShadow: "0 8px 24px rgba(30,96,145,0.1)" }}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ background: "#F3F8FB" }}>
                {["Customer", "Total Orders", "Total Spent", "Last Order", "Actions"].map((h) => (
                  <th key={h} className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: "#5B7285" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="text-center py-12 text-sm" style={{ color: "#5B7285" }}>Loading...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-12 text-sm" style={{ color: "#5B7285" }}>No customers found.</td></tr>
              ) : (
                filtered.map((c) => (
                  <tr key={c.user_id} className="border-t" style={{ borderColor: "#EEF3F8" }}>
                    <td className="px-5 py-3 text-sm" style={{ color: "#1e293b" }}>
                      <p className="font-semibold">{c.name}</p>
                      <p className="text-xs" style={{ color: "#94A3B8" }}>{c.email}</p>
                    </td>
                    <td className="px-5 py-3 text-sm" style={{ color: "#5B7285" }}>{c.total_orders}</td>
                    <td className="px-5 py-3 text-sm font-semibold" style={{ color: "#0f172a" }}>{formatCurrency(c.total_spent)}</td>
                    <td className="px-5 py-3 text-sm whitespace-nowrap" style={{ color: "#94A3B8" }}>{formatDate(c.last_order_at)}</td>
                    <td className="px-5 py-3">
                      <button onClick={() => navigate(`${base}/customers/b2c/${c.user_id}/profile`)} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: "#E8F3FB", color: "#1E6091" }}>View</button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default CustomersB2C;
