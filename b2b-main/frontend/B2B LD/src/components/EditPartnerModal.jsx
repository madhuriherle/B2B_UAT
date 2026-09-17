import { useEffect, useState } from "react";
import { apiRequest } from "../lib/api";
import { formatCurrency, gstInclusiveTooltip } from "../lib/format";
import { isValidMobile, sanitizeMobileInput } from "../lib/validation";
import Modal from "./Modal";
import DocumentServiceConfigPanel from "./DocumentServiceConfigPanel";
import InlineRenameButton from "./InlineRenameButton";
import QuickAddModal from "./QuickAddModal";
import PriceHistoryModal from "./PriceHistoryModal";
import BulkEstampPricingPanel from "./BulkEstampPricingPanel";
import { useConfirm } from "./ConfirmProvider";


const addIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const historyIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

const trashIcon = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
);

const inputClass = "w-full px-4 py-2.5 text-sm rounded-xl outline-none transition-all disabled:cursor-not-allowed";
const inputStyle = { background: "#F3F8FB", border: "1px solid #D8E6F0", color: "#1e293b" };

// Temporarily hidden from the Edit Partner "Services" list — not needed
// right now, but kept (not deleted) since they'll be needed again later.
// Remove a name from this set to bring that service back into view.
// "Manual eStamp" was removed from this set 2026-08-27 — it's a fully built,
// shipped Partner/User Portal feature (see PartnerCreateManualEstamp.jsx),
// so Super Admin needs to be able to enable/price it per partner here; being
// hidden meant there was no way to turn it on for any partner at all.
const HIDDEN_SERVICES = new Set(["Document Service", "eNotary", "eSBTR"]);

const RETAILER_CATEGORIES = ["Banks", "Co-Operative Bank", "Co-Operative Societies", "NBFC", "PSC"];
const PAYMENT_MODES = [
  { value: "Wallet", label: "Wallet" },
  { value: "PPS", label: "Self PPS (Pay Per Service)" },
];

const Field = ({ label, children }) => (
  <div>
    <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#5B7285" }}>{label}</label>
    {children}
  </div>
);

const SectionLabel = ({ children }) => (
  <p className="text-[11px] font-bold uppercase tracking-wider mb-3" style={{ color: "#94A3B8" }}>{children}</p>
);

const PriceInput = ({ value, onChange, disabled = false }) => {
  const tooltip = gstInclusiveTooltip(value);
  return (
    <div className="relative flex items-center gap-1.5 group">
      <span className="text-xs" style={{ color: disabled ? "#cbd5e1" : "#5B7285" }}>₹</span>
      <input
        type="number"
        min="0"
        value={disabled ? "" : (value ?? "")}
        onChange={onChange}
        disabled={disabled}
        className="price-number-input w-24 px-2 py-1.5 text-sm rounded-lg outline-none disabled:cursor-not-allowed"
        style={disabled ? { background: "#E2EBF4", border: "1px solid #D8E6F0", color: "#cbd5e1" } : { background: "#F3F8FB", border: "1px solid #D8E6F0", color: "#1e293b" }}
      />
      {tooltip && (
        <div className="pointer-events-none absolute left-1/2 bottom-full z-30 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[11px] font-semibold opacity-0 shadow-lg transition-opacity group-hover:opacity-100" style={{ background: "#0f172a", color: "#fff" }}>
          {tooltip}
        </div>
      )}
    </div>
  );
};

const PercentInput = ({ value, onChange, disabled = false }) => (
  <div className="flex items-center gap-1.5">
    <input
      type="number"
      min="0"
      step="0.01"
      value={value ?? ""}
      onChange={onChange}
      disabled={disabled}
      className="price-number-input w-20 px-2 py-1.5 text-sm rounded-lg outline-none disabled:cursor-not-allowed"
      style={disabled ? { background: "#E2EBF4", border: "1px solid #D8E6F0", color: "#cbd5e1" } : { background: "#F3F8FB", border: "1px solid #D8E6F0", color: "#1e293b" }}
    />
    <span className="text-xs" style={{ color: disabled ? "#cbd5e1" : "#5B7285" }}>%</span>
  </div>
);

const StatusPill = ({ active, onClick, disabled }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-colors disabled:opacity-60"
    style={{ background: active ? "#E6F5EA" : "#E2EBF4", color: active ? "#3D7A1F" : "#5B7285" }}
  >
    <span className="w-1.5 h-1.5 rounded-full" style={{ background: active ? "#16A34A" : "#94A3B8" }}></span>
    {active ? "Enabled" : "Disabled"}
  </button>
);

const toNumberOrNull = (value) => (value === "" || value === null || value === undefined ? null : Number(value));

// Additional Charges rows for one service — shared between ServiceEditModal
// and nowhere else now (used to be inline in every service box at once,
// which is exactly the "too much on one screen" problem this was split out
// to fix). Amount-vs-Percentage config only applies to eStamp Bulk's
// "Service Charge"; every other charge/service combination is a plain fixed
// amount.
const ServiceChargeRows = ({ serviceName, chargeMaster, assignedByName, onToggleCharge, onUpdateChargeField }) => {
  const availableCharges = chargeMaster.filter((c) => c.status);

  if (availableCharges.length === 0) {
    return <p className="text-xs" style={{ color: "#94A3B8" }}>No charge types exist yet — add one from Charge Types below.</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-2">
      {availableCharges.map((master) => {
        const c = assignedByName[master.charge_name];
        const isActive = !!c?.is_active;
        const isEstampBulkServiceCharge = serviceName === "eStamp Bulk" && master.charge_name === "Service Charge" && isActive;

        if (isEstampBulkServiceCharge) {
          const calcType = c?.calculation_type || "amount";
          return (
            <div key={master.charge_name} className="rounded-lg p-2" style={{ background: "#E8F3FB", border: "1px solid #1E6091" }}>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onToggleCharge(master.charge_name)}
                  className="w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                  style={{ background: "#16A34A", color: "#fff" }}
                >
                  ✓
                </button>
                <span className="text-xs font-medium flex-1 min-w-0 truncate" style={{ color: "#1e293b" }}>{master.charge_name}</span>
                <select
                  value={calcType}
                  onChange={(e) => onUpdateChargeField(master.charge_name, "calculation_type", e.target.value)}
                  className="text-xs rounded-lg px-2 py-1.5 outline-none"
                  style={inputStyle}
                >
                  <option value="amount">In Amount</option>
                  <option value="percentage">In Percentage</option>
                </select>
              </div>
              <div className="flex items-center gap-4 mt-2 pl-7">
                {calcType === "amount" ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-medium" style={{ color: "#94A3B8" }}>Amount</span>
                    <PriceInput value={c?.price} onChange={(e) => onUpdateChargeField(master.charge_name, "price", e.target.value)} />
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-medium" style={{ color: "#94A3B8" }}>Percentage</span>
                      <PercentInput value={c?.percentage} onChange={(e) => onUpdateChargeField(master.charge_name, "percentage", e.target.value)} />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-medium" style={{ color: "#94A3B8" }}>Min. Amount</span>
                      <PriceInput value={c?.minimum_amount} onChange={(e) => onUpdateChargeField(master.charge_name, "minimum_amount", e.target.value)} />
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        }

        return (
          <div
            key={master.charge_name}
            className="flex items-center gap-2 rounded-lg p-2"
            style={{ background: isActive ? "#E8F3FB" : "#F8FAFC", border: `1px solid ${isActive ? "#1E6091" : "#E2EBF4"}` }}
          >
            <button
              type="button"
              onClick={() => onToggleCharge(master.charge_name)}
              className="w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold flex-shrink-0"
              style={{ background: isActive ? "#16A34A" : "#D8E6F0", color: isActive ? "#fff" : "#5B7285" }}
            >
              {isActive ? "✓" : ""}
            </button>
            <span className="text-xs font-medium flex-1 min-w-0 truncate" style={{ color: isActive ? "#1e293b" : "#94A3B8" }}>{master.charge_name}</span>
            <PriceInput value={c?.price} onChange={(e) => onUpdateChargeField(master.charge_name, "price", e.target.value)} disabled={!isActive} />
          </div>
        );
      })}
    </div>
  );
};

// Everything about one service — base price, its additional charges, and
// (for eStamp Bulk) the tiered pricing table — used to live expanded inline
// for every service at once. Now it only exists while a service's "Edit" is
// open, so the main modal is just a scannable list by default. Reads/writes
// the SAME pricing/serviceCharges state the parent's "Save Changes" already
// persists — this overlay has no save button of its own, "Done" just closes it.
const ServiceEditModal = ({ service, serviceMasterRow, chargeMaster, assignedCharges, organizationId, onRename, onUpdateService, onToggleCharge, onUpdateChargeField, onClose }) => {
  const assignedByName = Object.fromEntries(assignedCharges.map((c) => [c.charge_name, c]));
  const isBulk = service.service_name === "eStamp Bulk";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,0.5)", backdropFilter: "blur(4px)" }}>
      <div className="w-full max-w-lg rounded-2xl overflow-hidden shadow-2xl" style={{ background: "#fff", maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
        <div className="px-6 py-5 border-b flex items-center justify-between shrink-0" style={{ borderColor: "#E2EBF4" }}>
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="text-lg font-bold truncate" style={{ color: "#0f172a" }}>{service.service_name}</h2>
            {serviceMasterRow && <InlineRenameButton currentName={service.service_name} onRename={onRename} />}
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: "#E2EBF4", color: "#5B7285" }}>✕</button>
        </div>

        <div className="p-6 space-y-5 overflow-y-auto">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold" style={{ color: "#1e293b" }}>Enabled for this partner</span>
            <div className="relative cursor-pointer" onClick={() => onUpdateService("is_active", !service.is_active)}>
              <div className="w-11 h-6 rounded-full transition-colors" style={{ background: service.is_active ? "#16A34A" : "#D8E6F0" }}></div>
              <div className="absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all" style={{ left: service.is_active ? "24px" : "4px" }}></div>
            </div>
          </div>

          {!isBulk && (
            <Field label={`${service.service_name}'s Base Price (excluding GST)`}>
              <PriceInput value={service.price} onChange={(e) => onUpdateService("price", e.target.value)} disabled={!service.is_active} />
            </Field>
          )}

          {service.is_active && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#94A3B8" }}>Additional Charges</p>
              <ServiceChargeRows
                serviceName={service.service_name}
                chargeMaster={chargeMaster}
                assignedByName={assignedByName}
                onToggleCharge={onToggleCharge}
                onUpdateChargeField={onUpdateChargeField}
              />
            </div>
          )}

          {isBulk && service.is_active && <BulkEstampPricingPanel organizationId={organizationId} />}
        </div>

        <div className="px-6 py-4 border-t flex justify-end shrink-0" style={{ borderColor: "#E2EBF4", background: "#F3F8FB" }}>
          <button onClick={onClose} className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

const EditPartnerModal = ({ partner, states, onClose, onSaved }) => {
  const { confirm, alert } = useConfirm();
  const [form, setForm] = useState({
    organization_name: partner.organization_name || "",
    organization_type: partner.organization_type || "",
    retailer_category: partner.retailer_category || "",
    payment_mode: partner.payment_mode || "Wallet",
    contact_person: partner.contact_person || "",
    email: partner.email || "",
    mobile: partner.mobile || "",
    state_id: partner.state_id || "",
    gst_number: partner.gst_number || "",
    address_line1: partner.address_line1 || "",
    address_line2: partner.address_line2 || "",
    city: partner.city || "",
    pincode: partner.pincode || "",
    two_factor_enabled: !!partner.two_factor_enabled,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [pricing, setPricing] = useState({ services: [] });
  const [charges, setCharges] = useState({ charges: [] });
  const [loadingServices, setLoadingServices] = useState(true);

  // Additional, admin-defined per-service charges (Delivery Charge, Handling
  // Charge, any arbitrary type Super Admin creates) — organized as
  // { [service_name]: [{charge_name, is_active, price, calculation_type,
  // percentage, minimum_amount}] }, distinct from the org-wide Charge Types
  // catalog below and from each service's own Base Price. calculation_type/
  // percentage/minimum_amount only ever matter for "Service Charge".
  const [serviceCharges, setServiceCharges] = useState({});
  const [chargeMaster, setChargeMaster] = useState([]);
  // The raw master lists (with real ids, unlike pricing.services/charges.charges
  // which only carry names) — needed to PATCH /api/services/{id} or
  // /api/charges/{id} when renaming.
  const [serviceMaster, setServiceMaster] = useState([]);
  const [showAddService, setShowAddService] = useState(false);
  const [showAddCharge, setShowAddCharge] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  // Which service's compact row currently has its "Edit" overlay open —
  // null means the Services list is just the scannable table.
  const [editingServiceName, setEditingServiceName] = useState(null);

  // Global Article Code master (see ArticleCodeMaster.jsx) — not scoped to
  // this partner, but managed inline here too so Super Admin doesn't have to
  // leave this modal to add a code an eStamp Bulk partner-user needs in
  // their dropdown (partner_user.list_my_article_codes only ever returns
  // active ones). Every change below persists immediately, unlike
  // Services/Charges above which batch into the Save Changes button.
  const [articleCodes, setArticleCodes] = useState([]);
  const [showAddArticleCode, setShowAddArticleCode] = useState(false);

  // The partner's own primary login (organization_users row created
  // alongside the org itself — see CustomerOnboard.jsx), so Super Admin can
  // reset its password from here instead of having no way to at all.
  const [primaryUser, setPrimaryUser] = useState(null);
  const [resettingPassword, setResettingPassword] = useState(false);

  const loadAll = () => {
    apiRequest(`/api/organizations/${partner.id}/pricing`)
      .then(setPricing)
      .catch(() => setPricing({ services: [] }))
      .finally(() => setLoadingServices(false));
    apiRequest(`/api/organizations/${partner.id}/pricing/charges`)
      .then(setCharges)
      .catch(() => setCharges({ charges: [] }));
    apiRequest(`/api/organizations/${partner.id}/pricing/service-charges`)
      .then((res) => {
        const grouped = {};
        for (const c of res.charges || []) {
          (grouped[c.service_name] = grouped[c.service_name] || []).push({
            charge_name: c.charge_name, is_active: c.is_active, price: c.price,
            calculation_type: c.calculation_type || "amount", percentage: c.percentage, minimum_amount: c.minimum_amount,
          });
        }
        setServiceCharges(grouped);
      })
      .catch(() => setServiceCharges({}));
    apiRequest(`/api/charges`)
      .then(setChargeMaster)
      .catch(() => setChargeMaster([]));
    apiRequest(`/api/services`)
      .then(setServiceMaster)
      .catch(() => setServiceMaster([]));
    apiRequest(`/api/article-codes`)
      .then(setArticleCodes)
      .catch(() => setArticleCodes([]));
    apiRequest(`/api/organizations/${partner.id}/users`)
      .then((list) => setPrimaryUser(list.find((u) => u.email?.toLowerCase() === partner.email?.toLowerCase()) || list[0] || null))
      .catch(() => setPrimaryUser(null));
  };

  useEffect(loadAll, [partner.id]);

  const handleResetPassword = async () => {
    if (!primaryUser) return;
    if (!await confirm(`Send a new login link to ${primaryUser.full_name} (${primaryUser.email})?`)) return;
    setResettingPassword(true);
    try {
      const result = await apiRequest(`/api/organizations/${partner.id}/users/${primaryUser.id}/reset-password`, {
        method: "POST",
      });
      if (result.mail_sent) {
        setError("");
        await alert(`Login link emailed to ${primaryUser.email}`);
      } else {
        await alert(`Could not send email (${result.mail_error}). Link: ${result.reset_link}`);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setResettingPassword(false);
    }
  };

  // Renaming a master entry changes the key every other list (pricing,
  // charges, serviceCharges, chargeMaster) keys off of — simplest and
  // safest to just reload everything fresh rather than try to patch each
  // structure's references to the old name in place.
  const renameService = async (serviceId, newName) => {
    await apiRequest(`/api/services/${serviceId}`, { method: "PATCH", body: JSON.stringify({ service_name: newName }) });
    loadAll();
  };

  const renameCharge = async (chargeId, newName) => {
    await apiRequest(`/api/charges/${chargeId}`, { method: "PATCH", body: JSON.stringify({ charge_name: newName }) });
    loadAll();
  };

  // Deletes from the global charge-type catalog (not just this partner) —
  // same master list every partner's Additional Charges picker reads from,
  // so this affects everyone, not only the partner currently being edited.
  const handleDeleteCharge = async (chargeMasterRow) => {
    if (!await confirm(`Delete charge type "${chargeMasterRow.charge_name}"? This removes it for every partner, not just this one.`)) return;
    setError("");
    try {
      await apiRequest(`/api/charges/${chargeMasterRow.id}`, { method: "DELETE" });
      loadAll();
    } catch (err) {
      setError(err.message);
    }
  };

  const updateService = (serviceName, field, value) => {
    setPricing((prev) => ({
      ...prev,
      services: prev.services.map((s) =>
        s.service_name === serviceName
          ? field === "is_active" && !value
            ? { ...s, is_active: false, price: null }
            : { ...s, [field]: value }
          : s
      ),
    }));
  };

  const updateCharge = (chargeName, field, value) => {
    setCharges((prev) => ({
      ...prev,
      charges: prev.charges.map((c) => (c.charge_name === chargeName ? { ...c, [field]: value } : c)),
    }));
  };

  const chargesForService = (serviceName) => serviceCharges[serviceName] || [];

  const setChargesForService = (serviceName, updater) => {
    setServiceCharges((prev) => ({ ...prev, [serviceName]: updater(prev[serviceName] || []) }));
  };

  const emptyServiceCharge = { price: null, calculation_type: "amount", percentage: null, minimum_amount: null };

  // Toggling a charge row on/off for a service — creates the row (active)
  // the first time it's ticked, since nothing is assigned until then.
  const toggleServiceCharge = (serviceName, chargeName) => {
    setChargesForService(serviceName, (list) => {
      const idx = list.findIndex((c) => c.charge_name === chargeName);
      if (idx === -1) return [...list, { charge_name: chargeName, is_active: true, ...emptyServiceCharge }];
      return list.map((c, i) => (i === idx ? { ...c, is_active: !c.is_active } : c));
    });
  };

  // Generic field updater for a service's charge row — price for a plain
  // fixed charge, or calculation_type/percentage/minimum_amount for
  // "Service Charge"'s Amount-vs-Percentage config.
  const updateServiceChargeField = (serviceName, chargeName, field, value) => {
    setChargesForService(serviceName, (list) => {
      const idx = list.findIndex((c) => c.charge_name === chargeName);
      if (idx === -1) return [...list, { charge_name: chargeName, is_active: true, ...emptyServiceCharge, [field]: value }];
      return list.map((c, i) => (i === idx ? { ...c, [field]: value } : c));
    });
  };

  const handleCreateService = async ({ name, description }) => {
    await apiRequest(`/api/services`, {
      method: "POST",
      body: JSON.stringify({ service_name: name, description }),
    });
    setShowAddService(false);
    loadAll();
  };

  const handleCreateCharge = async ({ name, description }) => {
    await apiRequest(`/api/charges`, {
      method: "POST",
      body: JSON.stringify({ charge_name: name, description }),
    });
    setShowAddCharge(false);
    loadAll();
  };

  const handleCreateArticleCode = async ({ name, description }) => {
    await apiRequest(`/api/article-codes`, {
      method: "POST",
      body: JSON.stringify({ article_code: name, description }),
    });
    setShowAddArticleCode(false);
    loadAll();
  };

  const toggleArticleCodeStatus = async (id, currentStatus) => {
    setArticleCodes((prev) => prev.map((c) => (c.id === id ? { ...c, is_active: !currentStatus } : c)));
    try {
      await apiRequest(`/api/article-codes/${id}`, { method: "PATCH", body: JSON.stringify({ is_active: !currentStatus }) });
    } catch (err) {
      setArticleCodes((prev) => prev.map((c) => (c.id === id ? { ...c, is_active: currentStatus } : c)));
      setError(err.message);
    }
  };

  const renameArticleCode = async (id, newCode) => {
    await apiRequest(`/api/article-codes/${id}`, { method: "PATCH", body: JSON.stringify({ article_code: newCode }) });
    loadAll();
  };

  // Document Service must persist immediately — DocumentServiceConfigPanel
  // only serves/accepts document configs once the backend already considers
  // this service active for the partner. Document Service itself is hidden
  // from the Services table (HIDDEN_SERVICES), so this only ever fires from
  // the dead-but-preserved panel below, not from the table's own toggle.
  const toggleDocumentService = async (nextActive) => {
    updateService("Document Service", "is_active", nextActive);
    try {
      await apiRequest(`/api/organizations/${partner.id}/pricing`, {
        method: "PUT",
        body: JSON.stringify({ services: [{ service_name: "Document Service", is_active: nextActive, price: null }] }),
      });
    } catch (err) {
      updateService("Document Service", "is_active", !nextActive);
      setError(err.message);
    }
  };

  const documentServiceActive = pricing.services.find((s) => s.service_name === "Document Service")?.is_active;
  const visibleServices = pricing.services.filter((s) => !HIDDEN_SERVICES.has(s.service_name));
  const editingService = editingServiceName ? visibleServices.find((s) => s.service_name === editingServiceName) : null;

  const handleChange = (e) => {
    const { name, value } = e.target;
    const nextValue =
      name === "mobile" ? sanitizeMobileInput(value)
      : name === "pincode" ? value.replace(/\D/g, "").slice(0, 6)
      : value;
    setForm({ ...form, [name]: nextValue });
  };

  const isLegacyType = form.organization_type && !["Dealer", "Retailer"].includes(form.organization_type);

  const handleSubmit = async () => {
    if (!form.organization_name || !form.email) {
      setError("Partner name and email are required");
      return;
    }
    if (form.organization_type === "Retailer" && !form.retailer_category) {
      setError("Retailer Category is required for Retailer partners");
      return;
    }
    if (form.mobile && !isValidMobile(form.mobile)) {
      setError("Mobile number must be exactly 10 digits");
      return;
    }
    if (!form.address_line1 || !form.city || !form.state_id || !form.pincode) {
      setError("Please fill all required address fields");
      return;
    }
    if (!/^\d{6}$/.test(form.pincode)) {
      setError("Pincode must be exactly 6 digits");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await apiRequest(`/api/organizations/${partner.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...form,
          state_id: form.state_id || null,
          retailer_category: form.organization_type === "Retailer" ? form.retailer_category : null,
        }),
      });
      if (pricing.services.length > 0) {
        await apiRequest(`/api/organizations/${partner.id}/pricing`, {
          method: "PUT",
          body: JSON.stringify({
            services: pricing.services.map((s) => ({
              service_name: s.service_name,
              is_active: s.is_active,
              price: toNumberOrNull(s.price),
            })),
          }),
        });
      }
      // One save per service that currently has (or ever had, this session)
      // an Additional Charges list — a full replace each time, so unticking
      // a charge client-side actually deletes that assignment server-side
      // too (see organizations.update_organization_service_charge_pricing).
      for (const [serviceName, list] of Object.entries(serviceCharges)) {
        await apiRequest(`/api/organizations/${partner.id}/pricing/services/${encodeURIComponent(serviceName)}/charges`, {
          method: "PUT",
          body: JSON.stringify({
            charges: list.map((c) => ({
              charge_name: c.charge_name,
              is_active: c.is_active,
              calculation_type: c.calculation_type || "amount",
              price: toNumberOrNull(c.price),
              percentage: toNumberOrNull(c.percentage),
              minimum_amount: toNumberOrNull(c.minimum_amount),
            })),
          }),
        });
      }
      if (charges.charges.length > 0) {
        await apiRequest(`/api/organizations/${partner.id}/pricing/charges`, {
          method: "PUT",
          body: JSON.stringify({
            // Price is no longer set here — the per-service "Additional
            // Charges" panel (see serviceCharges save) is the only place a
            // charge gets a price.
            charges: charges.charges.map((c) => ({
              charge_name: c.charge_name,
              is_active: c.is_active,
            })),
          }),
        });
      }
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal title="Edit Partner" subtitle={partner.organization_name} onClose={onClose} width="max-w-2xl">
      {error && <p className="text-xs font-medium mb-3 px-3 py-2 rounded-lg" style={{ background: "#E8F3FB", color: "#1E6091" }}>{error}</p>}

      <div>
        <SectionLabel>Partner Details</SectionLabel>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Partner Name *">
            <input name="organization_name" value={form.organization_name} onChange={handleChange} className={inputClass} style={inputStyle} />
          </Field>
          <Field label="Partner Type *">
            <select name="organization_type" value={form.organization_type} onChange={handleChange} className={inputClass} style={inputStyle}>
              <option value="">Select type</option>
              <option value="Dealer">Dealer</option>
              <option value="Retailer">Retailer</option>
              {isLegacyType && <option value={form.organization_type}>{form.organization_type} (legacy)</option>}
            </select>
          </Field>
          {form.organization_type === "Retailer" && (
            <Field label="Retailer Category *">
              <select name="retailer_category" value={form.retailer_category} onChange={handleChange} className={inputClass} style={inputStyle}>
                <option value="">Select category</option>
                {RETAILER_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Contact Person">
            <input name="contact_person" value={form.contact_person} onChange={handleChange} className={inputClass} style={inputStyle} />
          </Field>
          <Field label="Email *">
            <input type="email" name="email" value={form.email} onChange={handleChange} className={inputClass} style={inputStyle} />
          </Field>
          <Field label="Mobile">
            <input type="text" inputMode="numeric" maxLength={10} name="mobile" value={form.mobile} onChange={handleChange} className={inputClass} style={inputStyle} />
          </Field>
          <Field label="State *">
            <select name="state_id" value={form.state_id} onChange={handleChange} className={inputClass} style={inputStyle}>
              <option value="">Select state</option>
              {states.map((s) => <option key={s.id} value={s.id}>{s.state_name}</option>)}
            </select>
          </Field>
          <Field label="GST Number">
            <input name="gst_number" value={form.gst_number} onChange={handleChange} className={inputClass} style={inputStyle} />
          </Field>
          <Field label="Address Line 1 *">
            <input name="address_line1" value={form.address_line1} onChange={handleChange} placeholder="Building, street" className={inputClass} style={inputStyle} />
          </Field>
          <Field label="Address Line 2">
            <input name="address_line2" value={form.address_line2} onChange={handleChange} placeholder="Area, landmark (optional)" className={inputClass} style={inputStyle} />
          </Field>
          <Field label="City *">
            <input name="city" value={form.city} onChange={handleChange} placeholder="e.g. Bengaluru" className={inputClass} style={inputStyle} />
          </Field>
          <Field label="Pincode *">
            <input type="text" inputMode="numeric" maxLength={6} name="pincode" value={form.pincode} onChange={handleChange} placeholder="560001" className={inputClass} style={inputStyle} />
          </Field>
        </div>
      </div>

      <div className="mt-6 pt-5" style={{ borderTop: "1px solid #E2EBF4" }}>
        <SectionLabel>Account Settings</SectionLabel>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Payment Configuration *">
            <div className="flex items-center gap-6 py-2">
              {PAYMENT_MODES.map((opt) => (
                <label key={opt.value} className="flex items-center gap-2 cursor-pointer text-sm font-medium" style={{ color: form.payment_mode === opt.value ? "#1E6091" : "#5B7285" }}>
                  <input type="radio" name="payment_mode" value={opt.value} checked={form.payment_mode === opt.value} onChange={handleChange} className="accent-[#1E6091]" />
                  {opt.label}
                </label>
              ))}
            </div>
          </Field>
          <Field label="Two-Factor Authentication (Login OTP)">
            <label className="flex items-center gap-3 py-2 cursor-pointer">
              <div className="relative" onClick={() => setForm({ ...form, two_factor_enabled: !form.two_factor_enabled })}>
                <div className="w-11 h-6 rounded-full transition-colors" style={{ background: form.two_factor_enabled ? "#1E6091" : "#D8E6F0" }}></div>
                <div className="absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all" style={{ left: form.two_factor_enabled ? "24px" : "4px" }}></div>
              </div>
              <span className="text-sm font-medium" style={{ color: form.two_factor_enabled ? "#1E6091" : "#5B7285" }}>{form.two_factor_enabled ? "Enabled" : "Disabled"}</span>
            </label>
          </Field>
          <Field label="Login Password">
            {primaryUser ? (
              <button
                type="button"
                onClick={handleResetPassword}
                disabled={resettingPassword}
                className="px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-60"
                style={{ background: "#E8F3FB", color: "#1E6091" }}
              >
                {resettingPassword ? "Sending..." : "Reset Password"}
              </button>
            ) : (
              <p className="text-xs py-2" style={{ color: "#5B7285" }}>No login account found for this partner yet.</p>
            )}
          </Field>
        </div>
      </div>

      <div className="mt-6 pt-5" style={{ borderTop: "1px solid #E2EBF4" }}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold" style={{ color: "#0f172a" }}>Services</h3>
            <p className="text-xs mt-0.5" style={{ color: "#5B7285" }}>Click Edit on a service to set its price and additional charges</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setShowHistory(true)}
              className="h-8 px-3 rounded-lg flex items-center gap-1.5 text-xs font-semibold transition-colors"
              style={{ background: "#E2EBF4", color: "#5B7285" }}
            >
              {historyIcon}
              Price History
            </button>
            <button type="button" onClick={() => setShowAddService(true)} title="Add service" className="w-8 h-8 shrink-0 rounded-lg flex items-center justify-center text-white transition-opacity hover:opacity-90" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>
              {addIcon}
            </button>
          </div>
        </div>

        {loadingServices ? (
          <div className="rounded-xl p-8 text-center" style={{ background: "#F3F8FB", border: "1px solid #D8E6F0" }}>
            <p className="text-sm" style={{ color: "#5B7285" }}>Loading services...</p>
          </div>
        ) : (
          <>
            <div className="rounded-xl overflow-hidden" style={{ border: "1px solid #D8E6F0" }}>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr style={{ background: "#F3F8FB" }}>
                      {["Service", "Status", "Base Price", ""].map((h) => (
                        <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: "#5B7285" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleServices.map((s) => (
                      <tr key={s.service_name} className="border-t" style={{ borderColor: "#E2EBF4" }}>
                        <td className="px-4 py-3">
                          <span className="text-sm font-semibold" style={{ color: "#1e293b" }}>{s.service_name}</span>
                        </td>
                        <td className="px-4 py-3">
                          <StatusPill active={s.is_active} onClick={() => updateService(s.service_name, "is_active", !s.is_active)} />
                        </td>
                        <td className="px-4 py-3 text-sm font-semibold" style={{ color: "#1e293b" }}>
                          {s.is_active && s.price !== null && s.price !== undefined ? formatCurrency(s.price) : <span style={{ color: "#94A3B8", fontWeight: 400 }}>—</span>}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button type="button" onClick={() => setEditingServiceName(s.service_name)} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: "#E8F3FB", color: "#1E6091" }}>
                            Edit
                          </button>
                        </td>
                      </tr>
                    ))}
                    {visibleServices.length === 0 && (
                      <tr>
                        <td colSpan={4} className="text-center py-10 text-sm" style={{ color: "#5B7285" }}>No services are configured in Manage Services yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {documentServiceActive && !HIDDEN_SERVICES.has("Document Service") && (
              <div className="mt-5">
                <DocumentServiceConfigPanel key={partner.id} organizationId={partner.id} />
              </div>
            )}
          </>
        )}
      </div>

      <div className="mt-6 pt-5" style={{ borderTop: "1px solid #E2EBF4" }}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold" style={{ color: "#0f172a" }}>Charge Types</h3>
            <p className="text-xs mt-0.5" style={{ color: "#5B7285" }}>The catalog of charge types available to this partner — add or rename them here. Each one's price is set per service, inside that service's Edit panel above.</p>
          </div>
          <button type="button" onClick={() => setShowAddCharge(true)} title="Add charge" className="w-8 h-8 shrink-0 rounded-lg flex items-center justify-center text-white transition-opacity hover:opacity-90" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>
            {addIcon}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {charges.charges.map((c) => {
            const chargeMasterRow = chargeMaster.find((m) => m.charge_name === c.charge_name);
            return (
              <div key={c.charge_name} className="flex items-center gap-3 rounded-xl p-3" style={{ background: c.is_active ? "#E6F5EA" : "#F3F8FB", border: `1px solid ${c.is_active ? "#16A34A" : "#D8E6F0"}` }}>
                <button
                  type="button"
                  onClick={() => updateCharge(c.charge_name, "is_active", !c.is_active)}
                  className="w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold flex-shrink-0"
                  style={{ background: c.is_active ? "#16A34A" : "#D8E6F0", color: c.is_active ? "#fff" : "#5B7285" }}
                >
                  {c.is_active ? "✓" : ""}
                </button>
                <span className="text-sm font-semibold flex-1" style={{ color: c.is_active ? "#1e293b" : "#5B7285" }}>{c.charge_name}</span>
                {chargeMasterRow && (
                  <>
                    <InlineRenameButton currentName={c.charge_name} onRename={(newName) => renameCharge(chargeMasterRow.id, newName)} />
                    <button
                      type="button"
                      title="Delete charge type"
                      onClick={() => handleDeleteCharge(chargeMasterRow)}
                      className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 transition-colors"
                      style={{ background: "#FDECEC", color: "#C0392B" }}
                    >
                      {trashIcon}
                    </button>
                  </>
                )}
              </div>
            );
          })}
          {charges.charges.length === 0 && (
            <p className="text-sm md:col-span-2" style={{ color: "#5B7285" }}>No charges are configured in Manage Services yet.</p>
          )}
        </div>
      </div>

      <div className="mt-6 pt-5 flex justify-end gap-2" style={{ borderTop: "1px solid #E2EBF4" }}>
        <button onClick={onClose} className="px-5 py-2.5 rounded-xl text-sm font-semibold" style={{ background: "#E2EBF4", color: "#334155" }}>Cancel</button>
        <button onClick={handleSubmit} disabled={loading} className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>
          {loading ? "Saving..." : "Save Changes"}
        </button>
      </div>

      {editingService && (
        <ServiceEditModal
          service={editingService}
          serviceMasterRow={serviceMaster.find((m) => m.service_name === editingService.service_name)}
          chargeMaster={chargeMaster}
          assignedCharges={chargesForService(editingService.service_name)}
          organizationId={partner.id}
          onRename={(newName) => {
            const row = serviceMaster.find((m) => m.service_name === editingService.service_name);
            setEditingServiceName(newName);
            if (row) renameService(row.id, newName);
          }}
          onUpdateService={(field, value) => updateService(editingService.service_name, field, value)}
          onToggleCharge={(chargeName) => toggleServiceCharge(editingService.service_name, chargeName)}
          onUpdateChargeField={(chargeName, field, value) => updateServiceChargeField(editingService.service_name, chargeName, field, value)}
          onClose={() => setEditingServiceName(null)}
        />
      )}

      {showAddService && (
        <QuickAddModal
          title="Add Service"
          nameLabel="Service Name"
          namePlaceholder="e.g. eStamp"
          showDescription
          onClose={() => setShowAddService(false)}
          onSave={handleCreateService}
        />
      )}

      {showAddCharge && (
        <QuickAddModal
          title="Add Charge"
          nameLabel="Charge Name"
          namePlaceholder="e.g. Handling Charge"
          showDescription
          onClose={() => setShowAddCharge(false)}
          onSave={handleCreateCharge}
        />
      )}

      {showHistory && (
        <PriceHistoryModal
          title={partner.organization_name}
          fetchUrl={`/api/price-history?organization_id=${partner.id}`}
          onClose={() => setShowHistory(false)}
        />
      )}
    </Modal>
  );
};

export default EditPartnerModal;
