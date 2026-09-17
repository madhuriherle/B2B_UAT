import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { apiRequest } from "../lib/api";
import { formatCurrency } from "../lib/format";
import { useAuth } from "../lib/AuthContext";
import { portalBase } from "../lib/roleHome";
import ConfirmModal from "../components/ConfirmModal";
import EditPartnerModal from "../components/EditPartnerModal";
import SuccessModal from "../components/SuccessModal";

// Doubles as the activate/deactivate control (see handleToggleActive) — the
// Status column itself is the toggle, so there's exactly one place to flip a
// partner's access rather than a separate look-alike button elsewhere.
const StatusToggle = ({ checked, onToggle }) => (
  <label className="inline-flex items-center gap-2 cursor-pointer select-none" title={checked ? "Active — click to deactivate" : "Inactive — click to activate"}>
    <span
      role="switch"
      aria-checked={checked}
      onClick={onToggle}
      className="relative inline-flex w-9 h-5 rounded-full transition-colors shrink-0"
      style={{ background: checked ? "#16A34A" : "#D8E6F0" }}
    >
      <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all" style={{ left: checked ? "18px" : "2px" }}></span>
    </span>
    <span className="text-xs font-semibold" style={{ color: checked ? "#3D7A1F" : "#C0392B" }}>{checked ? "Active" : "Inactive"}</span>
  </label>
);

// Standard 2-letter state/UT abbreviations — same convention as vehicle
// registration codes (Karnataka -> KA, etc.). Independent of, and broader
// than, organization_state.STATE_NAME_TO_SIGNDESK_STAMP_CODE, which only
// covers the 21 states SignDesk's eStamp API supports; this list covers
// every state/UT so no partner's row is ever left blank. Falls back to the
// full state name if a table entry somehow doesn't match one of these.
const STATE_CODES = {
  "Andhra Pradesh": "AP", "Arunachal Pradesh": "AR", "Assam": "AS", "Bihar": "BR",
  "Chhattisgarh": "CG", "Goa": "GA", "Gujarat": "GJ", "Haryana": "HR",
  "Himachal Pradesh": "HP", "Jharkhand": "JH", "Karnataka": "KA", "Kerala": "KL",
  "Madhya Pradesh": "MP", "Maharashtra": "MH", "Manipur": "MN", "Meghalaya": "ML",
  "Mizoram": "MZ", "Nagaland": "NL", "Odisha": "OD", "Orissa": "OD", "Punjab": "PB",
  "Rajasthan": "RJ", "Sikkim": "SK", "Tamil Nadu": "TN", "Telangana": "TS",
  "Tripura": "TR", "Uttar Pradesh": "UP", "Uttarakhand": "UK", "West Bengal": "WB",
  "Andaman and Nicobar Islands": "AN", "Chandigarh": "CH",
  "Dadra and Nagar Haveli and Daman and Diu": "DN", "Delhi": "DL",
  "Jammu and Kashmir": "JK", "Ladakh": "LA", "Lakshadweep": "LD", "Puducherry": "PY",
};
const stateCode = (stateName) => (stateName ? STATE_CODES[stateName] || stateName : null);

const formatDate = (value) =>
  value ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "-";

const paymentModeLabel = (mode) => (mode === "PPS" ? "Self PPS (Pay Per Service)" : "Wallet");

const SummaryTile = ({ label, value, accent, icon }) => (
  <div className="rounded-xl overflow-hidden transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5" style={{ background: "#fff", border: "1px solid #D8E6F0", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
    <div className="h-1" style={{ background: accent.gradient || accent.color }} />
    <div className="px-3.5 py-2.5 flex items-center gap-3">
      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: accent.bg, color: accent.color }}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wide truncate" style={{ color: "#5B7285" }}>{label}</p>
        <p className="text-lg font-bold leading-tight truncate" style={{ color: "#0f172a" }}>{value}</p>
      </div>
    </div>
  </div>
);

const icons = {
  partners: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  active: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>,
  inactive: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>,
  wallet: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/></svg>,
  search: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5B7285" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
  pin: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>,
};

const CustomerList = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const base = portalBase(user);
  const [searchParams] = useSearchParams();
  const [partners, setPartners] = useState([]);
  const [states, setStates] = useState([]);
  const [search, setSearch] = useState(searchParams.get("search") || "");
  // Default to "active" — inactive partners can no longer log in (see
  // handleToggleActive below), so they're no longer the common case to see
  // at a glance; "all"/"disabled" are still one click away via the pills.
  const [filterStatus, setFilterStatus] = useState("active");
  const [modal, setModal] = useState(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [toggleError, setToggleError] = useState("");
  const [deactivateTarget, setDeactivateTarget] = useState(null);
  const [deactivating, setDeactivating] = useState(false);

  const loadPartners = () => {
    apiRequest("/api/organizations").then(setPartners).catch(() => setPartners([]));
  };

  const applyActiveStatus = async (partner, nextActive) => {
    setToggleError("");
    try {
      await apiRequest(`/api/organizations/${partner.id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: nextActive }),
      });
      setPartners((prev) => prev.map((p) => (p.id === partner.id ? { ...p, is_active: nextActive } : p)));
      return true;
    } catch (err) {
      setToggleError(err.message);
      return false;
    }
  };

  // Deactivating an org also blocks login for every user under it (see
  // auth.get_current_partner/get_current_partner_user), so it's a bigger
  // step than the per-user toggle on Manage Users — worth a confirm.
  // Reactivating has no such downside, so it goes straight through.
  const handleToggleActive = (partner) => {
    if (partner.is_active) {
      setDeactivateTarget(partner);
      return;
    }
    applyActiveStatus(partner, true);
  };

  const handleConfirmDeactivate = async () => {
    if (!deactivateTarget) return;
    setDeactivating(true);
    const ok = await applyActiveStatus(deactivateTarget, false);
    setDeactivating(false);
    if (ok) setDeactivateTarget(null);
  };

  useEffect(() => {
    loadPartners();
    apiRequest("/api/catalog/states").then(setStates).catch(() => setStates([]));
  }, []);

  // The header's global search box navigates to this same route with a new
  // ?search= value instead of mounting a fresh page, so the URL param can
  // change without this component remounting — resync local state to it.
  useEffect(() => {
    setSearch(searchParams.get("search") || "");
  }, [searchParams]);

  const filtered = partners.filter((p) => {
    const query = search.trim().toLowerCase();
    const matchSearch =
      query === "" ||
      p.organization_name?.toLowerCase().startsWith(query) ||
      [p.contact_person, p.email, p.mobile, p.organization_type, p.state_name, paymentModeLabel(p.payment_mode)].some(
        (field) => field?.toLowerCase().includes(query)
      );
    const matchStatus =
      filterStatus === "all" || (filterStatus === "active" ? p.is_active : !p.is_active);
    return matchSearch && matchStatus;
  });

  const closeModal = () => setModal(null);

  const activeCount = partners.filter((p) => p.is_active).length;
  const totalWallet = partners
    .filter((p) => p.payment_mode !== "PPS")
    .reduce((sum, p) => sum + Number(p.wallet_balance || 0), 0);

  return (
    <div>
      <div className="flex justify-between items-start mb-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "#0f172a" }}>Partner List</h1>
          <p className="text-sm mt-1" style={{ color: "#5B7285" }}>View and manage all onboarded partners</p>
        </div>
      </div>

      {toggleError && (
        <p className="text-xs font-medium mb-3 px-3 py-2 rounded-lg" style={{ background: "#FDECEC", color: "#C0392B" }}>{toggleError}</p>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <SummaryTile label="Total Partners" value={partners.length} accent={{ bg: "#E8F3FB", color: "#1E6091", gradient: "linear-gradient(90deg, #1E6091, #2C86C4)" }} icon={icons.partners} />
        <SummaryTile label="Active" value={activeCount} accent={{ bg: "#E6F5EA", color: "#16A34A", gradient: "linear-gradient(90deg, #3D7A1F, #16A34A)" }} icon={icons.active} />
        <SummaryTile label="Inactive" value={partners.length - activeCount} accent={{ bg: "#FDECEC", color: "#C0392B", gradient: "linear-gradient(90deg, #C0392B, #E8695C)" }} icon={icons.inactive} />
        <SummaryTile label="Total Wallet Balance" value={formatCurrency(totalWallet)} accent={{ bg: "#EFE8FB", color: "#6B21A8", gradient: "linear-gradient(90deg, #6B21A8, #9333EA)" }} icon={icons.wallet} />
      </div>

      <div className="rounded-xl p-2.5 mb-4 flex flex-wrap gap-2.5 items-center" style={{ background: "#fff", border: "1px solid #D8E6F0", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        <div className="relative w-full max-w-xs">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2">{icons.search}</span>
          <input type="text" placeholder="Search partners..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg outline-none transition-shadow focus:ring-2"
            style={{ background: "#F3F8FB", border: "1px solid #D8E6F0", color: "#1e293b" }} />
        </div>
        <div className="flex gap-1 rounded-full p-0.5" style={{ background: "#F3F8FB", border: "1px solid #D8E6F0" }}>
          {["all", "active", "disabled"].map(s => (
            <button key={s} onClick={() => setFilterStatus(s)}
              className="px-3 py-1 rounded-full text-sm font-medium capitalize transition-all"
              style={filterStatus === s
                ? { background: "#1E6091", color: "#fff", boxShadow: "0 2px 6px rgba(30,96,145,0.35)" }
                : { color: "#5B7285" }}>
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl overflow-hidden" style={{ background: "#fff", border: "1px solid #D8E6F0", boxShadow: "0 8px 24px rgba(30,96,145,0.1)" }}>
        <div className="h-1.5" style={{ background: "linear-gradient(90deg, #1E6091, #176B87, #16A34A)" }}></div>
        <div className="overflow-x-auto">
          <table className="w-full border-separate" style={{ borderSpacing: 0 }}>
            <thead>
              <tr style={{ background: "linear-gradient(180deg, #EAF3FA, #F3F8FB)" }}>
                {["Partner", "Contact Details", "State", "Wallet", "Status", "Onboarding Date", "Actions"].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider whitespace-nowrap border-b" style={{ color: "#1E6091", borderColor: "#D8E6F0" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((partner, i) => (
                <tr key={partner.id} className="transition-colors hover:bg-[#EAF3FA]" style={{ background: i % 2 === 1 ? "#FAFCFE" : "#fff" }}>
                  <td className="px-4 py-3 border-b" style={{ borderColor: "#EEF3F8" }}>
                    <div className="min-w-0 max-w-[160px]">
                      <p className="text-sm font-semibold truncate" title={partner.organization_name} style={{ color: "#1e293b" }}>{partner.organization_name}</p>
                      <p className="text-xs mt-0.5 truncate" style={{ color: "#94A3B8" }}>
                        {partner.organization_type || "-"}
                        {partner.organization_type === "Retailer" && partner.retailer_category && ` · ${partner.retailer_category}`}
                      </p>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm border-b max-w-[150px]" style={{ color: "#1e293b", borderColor: "#EEF3F8" }}>
                    <p className="truncate" title={partner.contact_person}>{partner.contact_person || "-"}</p>
                    <p className="text-xs mt-0.5 truncate" title={partner.email} style={{ color: "#94A3B8" }}>{partner.email}</p>
                    <p className="text-xs" style={{ color: "#94A3B8" }}>{partner.mobile || "-"}</p>
                  </td>
                  <td className="px-4 py-3 text-sm border-b max-w-[100px]" style={{ color: "#1e293b", borderColor: "#EEF3F8" }}>
                    <span className="inline-flex items-center gap-1.5 truncate" title={partner.state_name} style={{ color: partner.state_name ? "#1e293b" : "#94A3B8" }}>
                      <span className="shrink-0" style={{ color: "#94A3B8" }}>{icons.pin}</span>
                      <span className="truncate">{stateCode(partner.state_name) || "-"}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm font-bold border-b whitespace-nowrap" style={{ color: "#1E6091", borderColor: "#EEF3F8" }}>
                    {partner.payment_mode === "PPS" ? <span style={{ color: "#cbd5e1", fontWeight: 400 }}>-</span> : formatCurrency(partner.wallet_balance)}
                  </td>
                  <td className="px-4 py-3 border-b" style={{ borderColor: "#EEF3F8" }}>
                    <StatusToggle checked={partner.is_active} onToggle={() => handleToggleActive(partner)} />
                  </td>
                  <td className="px-4 py-3 text-sm whitespace-nowrap border-b" style={{ color: "#5B7285", borderColor: "#EEF3F8" }}>{formatDate(partner.created_at)}</td>
                  <td className="px-4 py-3 border-b" style={{ borderColor: "#EEF3F8" }}>
                    <div className="flex flex-nowrap items-center gap-1 whitespace-nowrap">
                      <button onClick={() => navigate(`${base}/partners/${partner.id}/profile`)} className="px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors hover:opacity-80" style={{ background: "#E8F3FB", color: "#1E6091" }}>View</button>
                      <button onClick={() => setModal({ type: "edit", partner })} className="px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors hover:opacity-80" style={{ background: "#E6F5EA", color: "#3D7A1F" }}>Edit</button>
                      {partner.payment_mode !== "PPS" && (
                        <button onClick={() => navigate(`${base}/partners/${partner.id}/wallet`)} className="px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors hover:opacity-80" style={{ background: "#D8E6F0", color: "#334155" }}>Wallet</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan="7" className="text-center py-16">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: "#E2EBF4" }}>
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                      </div>
                      <p className="font-semibold" style={{ color: "#5B7285" }}>No partners found</p>
                      <p className="text-sm" style={{ color: "#cbd5e1" }}>Try adjusting your search or filters</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex justify-between items-center px-5 py-4 border-t" style={{ borderColor: "#E2EBF4", background: "#F8FBFD" }}>
          <p className="text-sm" style={{ color: "#5B7285" }}>Showing <span className="font-semibold" style={{ color: "#1e293b" }}>{filtered.length}</span> of {partners.length} partners</p>
        </div>
      </div>

      {modal?.type === "edit" && (
        <EditPartnerModal
          partner={modal.partner}
          states={states}
          onClose={closeModal}
          onSaved={() => {
            loadPartners();
            closeModal();
            setShowSuccess(true);
          }}
        />
      )}

      {showSuccess && <SuccessModal title="Saved Successfully" message="Partner details updated successfully" onOk={() => setShowSuccess(false)} />}

      {deactivateTarget && (
        <ConfirmModal
          title="Deactivate Partner"
          message={`Deactivate ${deactivateTarget.organization_name}? Its users will no longer be able to log in.`}
          confirmLabel="Deactivate"
          cancelLabel="Keep Active"
          confirmTone="danger"
          busy={deactivating}
          onConfirm={handleConfirmDeactivate}
          onClose={() => !deactivating && setDeactivateTarget(null)}
        />
      )}
    </div>
  );
};

export default CustomerList;
