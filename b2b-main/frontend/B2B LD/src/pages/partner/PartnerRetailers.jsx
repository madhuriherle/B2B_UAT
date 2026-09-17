import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest } from "../../lib/api";

const inputStyle = { background: "#F3F8FB", border: "1px solid #D8E6F0", color: "#1e293b" };
const card = { background: "#fff", border: "1px solid #D8E6F0", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" };

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

const PartnerRetailers = () => {
  const navigate = useNavigate();
  const [retailers, setRetailers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    apiRequest("/api/partner/retailers")
      .then(setRetailers)
      .catch(() => setRetailers([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = retailers.filter((r) =>
    r.organization_name?.toLowerCase().includes(search.toLowerCase()) ||
    r.email?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "#0f172a" }}>My Retailers</h1>
          <p className="text-sm mt-1" style={{ color: "#5B7285" }}>Retailers onboarded under your dealership</p>
        </div>
        <button onClick={() => navigate("/partner/retailers/create")} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>
          + Add Retailer
        </button>
      </div>

      <div className="rounded-2xl p-4 mb-5 flex flex-wrap gap-3 items-center" style={card}>
        <div className="relative flex-1 min-w-48">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5B7285" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" placeholder="Search by name or email..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 text-sm rounded-xl outline-none" style={inputStyle} />
        </div>
      </div>

      <div className="rounded-2xl overflow-hidden" style={card}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ background: "#F3F8FB", borderBottom: "1px solid #D8E6F0" }}>
                {["Retailer Name", "Category", "Payment Mode", "Email", "Mobile", "State", "Status", "Created Date"].map((h) => (
                  <th key={h} className="text-left px-5 py-3.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: "#5B7285" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-t transition-colors hover:bg-slate-50/50" style={{ borderColor: "#E2EBF4" }}>
                  <td className="px-5 py-4"><p className="text-sm font-semibold" style={{ color: "#1e293b" }}>{r.organization_name}</p></td>
                  <td className="px-5 py-4 text-sm" style={{ color: "#1e293b" }}>{r.retailer_category || "-"}</td>
                  <td className="px-5 py-4 text-sm" style={{ color: "#1e293b" }}>{r.payment_mode === "PPS" ? "Self PPS" : "Wallet"}</td>
                  <td className="px-5 py-4 text-sm" style={{ color: "#1e293b" }}>{r.email}</td>
                  <td className="px-5 py-4 text-sm" style={{ color: "#1e293b" }}>{r.mobile || "-"}</td>
                  <td className="px-5 py-4 text-sm" style={{ color: "#1e293b" }}>{r.state_name || "-"}</td>
                  <td className="px-5 py-4">{statusBadge(r.is_active)}</td>
                  <td className="px-5 py-4 text-sm whitespace-nowrap" style={{ color: "#5B7285" }}>{formatDate(r.created_at)}</td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan="8" className="text-center py-16">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: "#E2EBF4" }}>
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                      </div>
                      <p className="font-semibold" style={{ color: "#5B7285" }}>No retailers yet</p>
                      <button onClick={() => navigate("/partner/retailers/create")} className="text-sm font-semibold px-4 py-2 rounded-xl text-white" style={{ background: "#1E6091" }}>Add your first retailer</button>
                    </div>
                  </td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td colSpan="8" className="text-center py-16 text-sm" style={{ color: "#5B7285" }}>Loading retailers...</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex justify-between items-center px-5 py-4 border-t" style={{ borderColor: "#E2EBF4" }}>
          <p className="text-sm" style={{ color: "#5B7285" }}>Showing <span className="font-semibold" style={{ color: "#1e293b" }}>{filtered.length}</span> of {retailers.length} retailers</p>
        </div>
      </div>
    </div>
  );
};

export default PartnerRetailers;
