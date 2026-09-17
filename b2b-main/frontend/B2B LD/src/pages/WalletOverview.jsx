import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest } from "../lib/api";
import { formatCurrency } from "../lib/format";
import { useAuth } from "../lib/AuthContext";
import { portalBase } from "../lib/roleHome";

const card = { background: "#fff", border: "1px solid #D8E6F0", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" };

const WalletOverview = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const base = portalBase(user);
  const [wallets, setWallets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [partnerTypeFilter, setPartnerTypeFilter] = useState("");
  const [balanceFilter, setBalanceFilter] = useState("");

  useEffect(() => {
    apiRequest("/api/organizations/wallets/summary")
      .then(setWallets)
      .catch(() => setWallets([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = wallets.filter((w) => {
    if (search && !w.organization_name?.toLowerCase().includes(search.toLowerCase())) return false;
    if (partnerTypeFilter && w.partner_type !== partnerTypeFilter) return false;
    if (balanceFilter === "zero" && Number(w.balance) !== 0) return false;
    if (balanceFilter === "positive" && Number(w.balance) <= 0) return false;
    return true;
  });

  const clearFilters = () => {
    setSearch("");
    setPartnerTypeFilter("");
    setBalanceFilter("");
  };
  const hasFilters = search || partnerTypeFilter || balanceFilter;

  const totals = wallets.reduce(
    (acc, w) => ({
      balance: acc.balance + Number(w.balance || 0),
      total_credits: acc.total_credits + Number(w.total_credits || 0),
      total_debits: acc.total_debits + Number(w.total_debits || 0),
    }),
    { balance: 0, total_credits: 0, total_debits: 0 }
  );

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: "#0f172a" }}>Wallet</h1>
        <p className="text-sm mt-1" style={{ color: "#5B7285" }}>Manage partner wallets and their user wallets</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {[
          { label: "Total Balance Across Partners", value: totals.balance, bg: "#E8F3FB", color: "#1E6091" },
          { label: "Total Credits", value: totals.total_credits, bg: "#E6F5EA", color: "#3D7A1F" },
          { label: "Total Debits", value: totals.total_debits, bg: "#E8F3FB", color: "#1E6091" },
        ].map((c) => (
          <div key={c.label} className="rounded-2xl p-5" style={card}>
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#5B7285" }}>{c.label}</p>
            <p className="text-2xl font-bold mt-1.5" style={{ color: c.color }}>{loading ? "..." : formatCurrency(c.value)}</p>
          </div>
        ))}
      </div>

      <div className="rounded-2xl p-4 mb-5" style={card}>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div className="md:col-span-2 relative">
            <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#5B7285" }}>Search</label>
            <svg className="absolute left-3 bottom-3" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5B7285" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="text" placeholder="Search by partner name..." value={search} onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 text-sm rounded-xl outline-none" style={{ background: "#F3F8FB", border: "1px solid #D8E6F0", color: "#1e293b" }} />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#5B7285" }}>Partner Type</label>
            <select value={partnerTypeFilter} onChange={(e) => setPartnerTypeFilter(e.target.value)} className="w-full px-3 py-2.5 text-sm rounded-xl outline-none" style={{ background: "#F3F8FB", border: "1px solid #D8E6F0", color: "#1e293b" }}>
              <option value="">All Types</option>
              <option value="Dealer">Dealer</option>
              <option value="Retailer">Retailer</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#5B7285" }}>Balance</label>
            <select value={balanceFilter} onChange={(e) => setBalanceFilter(e.target.value)} className="w-full px-3 py-2.5 text-sm rounded-xl outline-none" style={{ background: "#F3F8FB", border: "1px solid #D8E6F0", color: "#1e293b" }}>
              <option value="">Any Balance</option>
              <option value="positive">Positive Balance</option>
              <option value="zero">Zero Balance</option>
            </select>
          </div>
        </div>
        {hasFilters && (
          <button onClick={clearFilters} className="mt-3 text-xs font-semibold" style={{ color: "#1E6091" }}>Clear filters</button>
        )}
      </div>

      <div className="rounded-2xl overflow-hidden" style={card}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ background: "#F3F8FB", borderBottom: "1px solid #D8E6F0" }}>
                {["Partner Name", "Current Balance", "Total Credits", "Total Debits", "Actions"].map((h) => (
                  <th key={h} className="text-left px-5 py-3.5 text-xs font-semibold uppercase tracking-wider" style={{ color: "#5B7285" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((w) => (
                <tr key={w.organization_id} className="border-t transition-colors hover:bg-slate-50/50" style={{ borderColor: "#E2EBF4" }}>
                  <td className="px-5 py-4"><p className="text-sm font-semibold" style={{ color: "#1e293b" }}>{w.organization_name}</p></td>
                  <td className="px-5 py-4 text-sm font-semibold" style={{ color: "#0f172a" }}>{formatCurrency(w.balance)}</td>
                  <td className="px-5 py-4 text-sm" style={{ color: "#3D7A1F" }}>{formatCurrency(w.total_credits)}</td>
                  <td className="px-5 py-4 text-sm" style={{ color: "#1E6091" }}>{formatCurrency(w.total_debits)}</td>
                  <td className="px-5 py-4">
                    <button onClick={() => navigate(`${base}/partners/${w.organization_id}/wallet`)} className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors" style={{ background: "#E8F3FB", color: "#1E6091" }}>
                      Manage Wallet
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan="5" className="text-center py-16">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: "#E2EBF4" }}>
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 3v4"/><path d="M8 3v4"/><path d="M2 11h20"/></svg>
                      </div>
                      <p className="font-semibold" style={{ color: "#5B7285" }}>No partner wallets found</p>
                    </div>
                  </td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td colSpan="5" className="text-center py-16 text-sm" style={{ color: "#5B7285" }}>Loading wallets...</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default WalletOverview;

