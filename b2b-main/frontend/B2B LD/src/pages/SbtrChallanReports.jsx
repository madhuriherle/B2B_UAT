import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "../lib/api";

const card = { background: "#fff", border: "1px solid #D8E6F0", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" };
const inputStyle = { background: "#F3F8FB", border: "1px solid #D8E6F0", color: "#1e293b" };

const formatDate = (value) =>
  value ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "-";

const statusBadge = (status) => {
  const s = (status || "").toLowerCase();
  const styles = {
    completed: { background: "#E6F5EA", color: "#3D7A1F" },
    pending: { background: "#E8F3FB", color: "#1E6091" },
    failed: { background: "#E8F3FB", color: "#1E6091" },
    cancelled: { background: "#E2EBF4", color: "#334155" },
  };
  const style = styles[s] || { background: "#E2EBF4", color: "#334155" };
  return <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold capitalize" style={style}>{status || "-"}</span>;
};

const SbtrChallanReports = () => {
  const [records, setRecords] = useState([]);
  const [organizations, setOrganizations] = useState([]);
  const [partnerFilter, setPartnerFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiRequest("/api/organizations").then(setOrganizations).catch(() => setOrganizations([]));
  }, []);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (partnerFilter) params.set("organization_id", partnerFilter);
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);
    const query = params.toString() ? `?${params.toString()}` : "";
    apiRequest(`/api/reports/sbtr-challans${query}`)
      .then(setRecords)
      .catch(() => setRecords([]))
      .finally(() => setLoading(false));
  }, [partnerFilter, dateFrom, dateTo]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return records;
    return records.filter((r) =>
      [r.gtn_number, r.challan_number, r.partner_name, r.user_name, r.customer_name, r.state_name, r.status]
        .some((v) => v?.toLowerCase().includes(q))
    );
  }, [records, search]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: "#0f172a" }}>SBTR / Challan Reports</h1>
        <p className="text-sm mt-1" style={{ color: "#5B7285" }}>All SBTR and challan records across partners</p>
      </div>

      <div className="rounded-2xl p-4 mb-5 flex flex-wrap gap-3 items-center" style={card}>
        <div className="relative flex-1 min-w-48">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5B7285" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" placeholder="Search GTN, challan, partner, user, customer..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 text-sm rounded-xl outline-none" style={inputStyle} />
        </div>
        <select value={partnerFilter} onChange={(e) => setPartnerFilter(e.target.value)} className="px-4 py-2.5 text-sm rounded-xl outline-none max-w-56" style={inputStyle}>
          <option value="">All Partners</option>
          {organizations.map((o) => <option key={o.id} value={o.id}>{o.organization_name}</option>)}
        </select>
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="px-4 py-2.5 text-sm rounded-xl outline-none" style={inputStyle} />
        <span className="text-xs" style={{ color: "#5B7285" }}>to</span>
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="px-4 py-2.5 text-sm rounded-xl outline-none" style={inputStyle} />
      </div>

      <div className="rounded-2xl overflow-hidden" style={card}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ background: "#F3F8FB", borderBottom: "1px solid #D8E6F0" }}>
                {["GTN Number", "Challan Number", "Partner Name", "User Name", "Customer Name", "State", "Address", "Status", "Created Date"].map((h) => (
                  <th key={h} className="text-left px-5 py-3.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: "#5B7285" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-t transition-colors hover:bg-slate-50/50" style={{ borderColor: "#E2EBF4" }}>
                  <td className="px-5 py-4 text-sm font-mono" style={{ color: "#1E6091" }}>{r.gtn_number || "-"}</td>
                  <td className="px-5 py-4 text-sm font-mono" style={{ color: "#1E6091" }}>{r.challan_number || "-"}</td>
                  <td className="px-5 py-4 text-sm" style={{ color: "#1e293b" }}>{r.partner_name}</td>
                  <td className="px-5 py-4 text-sm" style={{ color: "#1e293b" }}>{r.user_name || "-"}</td>
                  <td className="px-5 py-4 text-sm" style={{ color: "#1e293b" }}>{r.customer_name || "-"}</td>
                  <td className="px-5 py-4 text-sm" style={{ color: "#5B7285" }}>{r.state_name || "-"}</td>
                  <td className="px-5 py-4 text-sm max-w-48 truncate" style={{ color: "#5B7285" }}>{r.address || "-"}</td>
                  <td className="px-5 py-4">{statusBadge(r.status)}</td>
                  <td className="px-5 py-4 text-sm whitespace-nowrap" style={{ color: "#5B7285" }}>{formatDate(r.created_at)}</td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan="9" className="text-center py-16">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: "#E2EBF4" }}>
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><line x1="6" y1="9" x2="18" y2="9"/><line x1="6" y1="13" x2="14" y2="13"/></svg>
                      </div>
                      <p className="font-semibold" style={{ color: "#5B7285" }}>No SBTR / Challan records found</p>
                    </div>
                  </td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td colSpan="9" className="text-center py-16 text-sm" style={{ color: "#5B7285" }}>Loading records...</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex justify-between items-center px-5 py-4 border-t" style={{ borderColor: "#E2EBF4" }}>
          <p className="text-sm" style={{ color: "#5B7285" }}>Showing <span className="font-semibold" style={{ color: "#1e293b" }}>{filtered.length}</span> of {records.length} records</p>
        </div>
      </div>
    </div>
  );
};

export default SbtrChallanReports;

