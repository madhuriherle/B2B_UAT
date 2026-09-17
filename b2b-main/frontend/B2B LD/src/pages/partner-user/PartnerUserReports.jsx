import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "../../lib/api";
import { theme, serif, card, inputStyle } from "../../lib/userPortalTheme";

const formatDate = (value) =>
  value ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "-";

const statusBadge = (status) => {
  const s = (status || "").toLowerCase();
  const styles = {
    completed: { background: theme.successSoft, color: theme.success, border: `1px solid ${theme.success}33` },
    pending: { background: theme.goldSoft, color: theme.navy, border: `1px solid ${theme.gold}66` },
    failed: { background: theme.goldSoft, color: theme.navy, border: `1px solid ${theme.gold}66` },
    cancelled: { background: theme.bg, color: theme.slate, border: `1px solid ${theme.border}` },
  };
  const style = styles[s] || { background: theme.bg, color: theme.slate, border: `1px solid ${theme.border}` };
  return <span className="inline-flex items-center px-2.5 py-1 rounded text-xs font-semibold capitalize" style={style}>{status || "-"}</span>;
};

const PartnerUserReports = () => {
  const [records, setRecords] = useState([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);
    const query = params.toString() ? `?${params.toString()}` : "";
    apiRequest(`/api/partner-user/reports/sbtr-challans${query}`)
      .then(setRecords)
      .catch(() => setRecords([]))
      .finally(() => setLoading(false));
  }, [dateFrom, dateTo]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return records;
    return records.filter((r) =>
      [r.gtn_number, r.challan_number, r.user_name, r.customer_name, r.state_name, r.status]
        .some((v) => v?.toLowerCase().includes(q))
    );
  }, [records, search]);

  return (
    <div>
      <div className="mb-6 pb-4 border-b" style={{ borderColor: theme.border }}>
        <h1 className="text-2xl font-bold" style={{ color: theme.ink, fontFamily: serif }}>SBTR / Challan Reports</h1>
        <p className="text-sm mt-1" style={{ color: theme.slate }}>SBTR and challan records for your account</p>
      </div>

      <div className="rounded-lg p-4 mb-5 flex flex-wrap gap-3 items-center" style={card}>
        <div className="relative flex-1 min-w-48">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={theme.slate} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" placeholder="Search GTN, challan, customer..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 text-sm rounded outline-none" style={inputStyle} />
        </div>
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="px-4 py-2.5 text-sm rounded outline-none" style={inputStyle} />
        <span className="text-xs" style={{ color: theme.slate }}>to</span>
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="px-4 py-2.5 text-sm rounded outline-none" style={inputStyle} />
      </div>

      <div className="rounded-lg overflow-hidden" style={card}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ background: theme.bg, borderBottom: `1px solid ${theme.border}` }}>
                {["GTN Number", "Challan Number", "Customer Name", "State", "Address", "Status", "Created Date"].map((h) => (
                  <th key={h} className="text-left px-5 py-3.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: theme.slate }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-t transition-colors hover:bg-slate-50/50" style={{ borderColor: theme.border }}>
                  <td className="px-5 py-4 text-sm font-mono" style={{ color: theme.navy }}>{r.gtn_number || "-"}</td>
                  <td className="px-5 py-4 text-sm font-mono" style={{ color: theme.navy }}>{r.challan_number || "-"}</td>
                  <td className="px-5 py-4 text-sm" style={{ color: theme.ink }}>{r.customer_name || "-"}</td>
                  <td className="px-5 py-4 text-sm" style={{ color: theme.slate }}>{r.state_name || "-"}</td>
                  <td className="px-5 py-4 text-sm max-w-48 truncate" style={{ color: theme.slate }}>{r.address || "-"}</td>
                  <td className="px-5 py-4">{statusBadge(r.status)}</td>
                  <td className="px-5 py-4 text-sm whitespace-nowrap" style={{ color: theme.slate }}>{formatDate(r.created_at)}</td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan="7" className="text-center py-16">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: theme.bg }}>
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><line x1="6" y1="9" x2="18" y2="9"/><line x1="6" y1="13" x2="14" y2="13"/></svg>
                      </div>
                      <p className="font-semibold" style={{ color: theme.slate }}>No SBTR / Challan records found</p>
                    </div>
                  </td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td colSpan="7" className="text-center py-16 text-sm" style={{ color: theme.slate }}>Loading records...</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex justify-between items-center px-5 py-4 border-t" style={{ borderColor: theme.border }}>
          <p className="text-sm" style={{ color: theme.slate }}>Showing <span className="font-semibold" style={{ color: theme.ink }}>{filtered.length}</span> of {records.length} records</p>
        </div>
      </div>
    </div>
  );
};

export default PartnerUserReports;
