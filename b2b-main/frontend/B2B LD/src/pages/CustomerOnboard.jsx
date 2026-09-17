import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest } from "../lib/api";
import { formatCurrency, gstInclusiveTooltip } from "../lib/format";
import { isValidMobile, sanitizeMobileInput, passwordStrengthError, PASSWORD_HINT } from "../lib/validation";
import { useAuth } from "../lib/AuthContext";
import { portalBase } from "../lib/roleHome";
import SuccessModal from "../components/SuccessModal";
import DocumentServiceConfigPanel from "../components/DocumentServiceConfigPanel";
import BulkEstampPricingPanel from "../components/BulkEstampPricingPanel";
import InlineRenameButton from "../components/InlineRenameButton";
import QuickAddModal from "../components/QuickAddModal";
import PriceHistoryModal from "../components/PriceHistoryModal";
import { useConfirm } from "../components/ConfirmProvider";


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

// Same set Edit Partner's Services tab hides — not needed right now, but
// kept (not deleted) since they'll be needed again later. Remove a name
// from this set to bring that service back into view here too.
// "Manual eStamp" was removed from this set 2026-08-27 (see EditPartnerModal.jsx)
// but this copy was never updated to match — it's a fully built, live feature.
const HIDDEN_SERVICES = new Set(["Document Service", "eNotary", "eSBTR"]);

const inputClass = "w-full px-4 py-2.5 text-sm rounded-xl outline-none transition-all disabled:cursor-not-allowed";
const inputStyle = { background: "#F3F8FB", border: "1px solid #D8E6F0", color: "#1e293b" };
const disabledStyle = { background: "#E2EBF4", border: "1px solid #D8E6F0", color: "#5B7285" };

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

// Additional Charges rows for one service — shared between ServiceEditModal
// and nowhere else, same pattern as EditPartnerModal.jsx. Amount-vs-
// Percentage config only applies to eStamp Bulk's "Service Charge"; every
// other charge/service combination is a plain fixed amount.
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
// (for eStamp Bulk) the tiered pricing table — same "Edit overlay" pattern
// as EditPartnerModal.jsx, so a new partner's Services step matches what
// Super Admin already sees on an existing partner.
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

const toNumberOrNull = (value) => (value === "" || value === null || value === undefined ? null : Number(value));

const emptyOrganizationData = {
  organizationName: "", organizationType: "", retailerCategory: "", paymentMode: "Wallet", contactPerson: "",
  email: "", mobile: "", addressLine1: "", addressLine2: "", city: "", state: "", pincode: "", gstNumber: "", status: true, password: "",
};

const emptyPricing = { services: [] };

const CustomerOnboard = () => {
  const { confirm, alert } = useConfirm();
  const navigate = useNavigate();
  const { user } = useAuth();
  const base = portalBase(user);
  const [organizationData, setOrganizationData] = useState(emptyOrganizationData);
  const [organizationSaved, setOrganizationSaved] = useState(false);
  const [savedOrgId, setSavedOrgId] = useState(null);
  const [users, setUsers] = useState([{ fullName: "", email: "", mobile: "", password: "", saved: false }]);
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(false);
  const [states, setStates] = useState([]);
  const [showSuccess, setShowSuccess] = useState(false);

  // Wizard step (1=Partner, 2=Users, 3=Services) — controls which cards are
  // shown; unlike organizationSaved/users[].saved this doesn't gate any data,
  // it only toggles visibility of the Services card so Back/Next never lose
  // anything already entered.
  const [step, setStep] = useState(1);
  const [pricing, setPricing] = useState(emptyPricing);
  const [loadingServices, setLoadingServices] = useState(false);
  const [servicesLoaded, setServicesLoaded] = useState(false);
  const [savingServices, setSavingServices] = useState(false);
  const [savingDocService, setSavingDocService] = useState(false);
  const [servicesSaved, setServicesSaved] = useState(false);
  // Additional, admin-defined per-service charges (Delivery Charge, Handling
  // Charge, any arbitrary type Super Admin created on Manage Services) —
  // { [service_name]: [{charge_name, is_active, price}] }, same shape/pattern
  // as EditPartnerModal.jsx and Quotation.jsx use.
  const [serviceCharges, setServiceCharges] = useState({});
  const [chargeMaster, setChargeMaster] = useState([]);
  // The partner-specific Charge Types catalog (from
  // /api/organizations/{id}/pricing/charges) — which of the global charge
  // types (chargeMaster) are enabled for THIS partner. Distinct from
  // serviceCharges, which holds each enabled charge's per-service price.
  const [charges, setCharges] = useState({ charges: [] });
  // The raw service master list (with real ids, unlike pricing.services
  // which only carries names) — needed to PATCH /api/services/{id} when
  // renaming from the Edit overlay.
  const [serviceMaster, setServiceMaster] = useState([]);
  const [showAddService, setShowAddService] = useState(false);
  const [showAddCharge, setShowAddCharge] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  // Which service's row currently has its "Edit" overlay open — null means
  // the Services list is just the scannable table.
  const [editingServiceName, setEditingServiceName] = useState(null);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    apiRequest("/api/catalog/states")
      .then((data) => setStates(data.map((s) => ({ id: s.id, state_name: s.state_name }))))
      .catch(() => setStates([]));
  }, []);

  // Loads everything the Services step needs — callable again after
  // renaming/adding a service or charge type, not just on first visit.
  const loadServices = () => {
    if (!savedOrgId) return;
    setLoadingServices(true);
    Promise.all([
      apiRequest(`/api/organizations/${savedOrgId}/pricing`),
      apiRequest(`/api/organizations/${savedOrgId}/pricing/charges`).catch(() => ({ charges: [] })),
      apiRequest(`/api/organizations/${savedOrgId}/pricing/service-charges`).catch(() => ({ charges: [] })),
      apiRequest(`/api/charges`).catch(() => []),
      apiRequest(`/api/services`).catch(() => []),
    ])
      .then(([pricingResult, chargesResult, serviceChargesResult, chargeMasterResult, serviceMasterResult]) => {
        setPricing(pricingResult);
        setCharges(chargesResult);
        const grouped = {};
        for (const c of serviceChargesResult.charges || []) {
          (grouped[c.service_name] = grouped[c.service_name] || []).push({
            charge_name: c.charge_name, is_active: c.is_active, price: c.price,
            calculation_type: c.calculation_type || "amount", percentage: c.percentage, minimum_amount: c.minimum_amount,
          });
        }
        setServiceCharges(grouped);
        setChargeMaster(chargeMasterResult);
        setServiceMaster(serviceMasterResult);
        setServicesLoaded(true);
      })
      .catch((err) => showToast(err.message, "error"))
      .finally(() => setLoadingServices(false));
  };

  // Load the partner's service list the first time Step 3 is reached, not
  // on every Back/Next, so re-visiting the step doesn't clobber unsaved edits.
  useEffect(() => {
    if (step !== 3 || servicesLoaded || !savedOrgId) return;
    loadServices();
  }, [step, servicesLoaded, savedOrgId]);

  const handleOrgChange = (e) => {
    const { name, value, type, checked } = e.target;
    const nextValue =
      name === "mobile" ? sanitizeMobileInput(value)
      : name === "pincode" ? value.replace(/\D/g, "").slice(0, 6)
      : type === "checkbox" ? checked : value;
    setOrganizationData({ ...organizationData, [name]: nextValue });
  };

  const handleSaveOrganization = async () => {
    if (!organizationData.organizationName || !organizationData.email || !organizationData.organizationType) {
      showToast("Please fill required fields", "error");
      return;
    }
    if (organizationData.organizationType === "Retailer" && !organizationData.retailerCategory) {
      showToast("Retailer Category is required for Retailer partners", "error");
      return;
    }
    if (organizationData.organizationType === "Retailer" || organizationData.organizationType === "Dealer") {
      const passwordError = passwordStrengthError(organizationData.password);
      if (passwordError) {
        showToast(passwordError, "error");
        return;
      }
    }
    if (organizationData.mobile && !isValidMobile(organizationData.mobile)) {
      showToast("Mobile number must be exactly 10 digits", "error");
      return;
    }
    if (!organizationData.addressLine1 || !organizationData.city || !organizationData.state || !organizationData.pincode) {
      showToast("Please fill all required address fields", "error");
      return;
    }
    if (!/^\d{6}$/.test(organizationData.pincode)) {
      showToast("Pincode must be exactly 6 digits", "error");
      return;
    }
    setLoading(true);
    try {
      const result = await apiRequest("/api/organizations", {
        method: "POST",
        body: JSON.stringify({
          organization_name: organizationData.organizationName,
          organization_type: organizationData.organizationType,
          retailer_category: organizationData.organizationType === "Retailer" ? organizationData.retailerCategory : null,
          payment_mode: organizationData.paymentMode,
          contact_person: organizationData.contactPerson || null,
          email: organizationData.email,
          mobile: organizationData.mobile || null,
          address_line1: organizationData.addressLine1 || null,
          address_line2: organizationData.addressLine2 || null,
          city: organizationData.city || null,
          pincode: organizationData.pincode || null,
          state_id: organizationData.state || null,
          gst_number: organizationData.gstNumber || null,
          is_active: organizationData.status,
        }),
      });
      setSavedOrgId(result.id);

      // Every partner — Dealer or Retailer — gets a working login the
      // moment Partner Details is saved, using the credentials captured on
      // this form, so a partner is never left unable to log in just because
      // nobody continued past this step. Retailer partners have no separate
      // "Add User" step at all (skip straight to Services); Dealer partners
      // still see Partner Users next, but purely to add extra logins beyond
      // this primary one, not as a requirement to have any login at all.
      await apiRequest(`/api/organizations/${result.id}/users`, {
        method: "POST",
        body: JSON.stringify({
          full_name: organizationData.contactPerson || organizationData.organizationName,
          email: organizationData.email,
          mobile: organizationData.mobile || null,
          password: organizationData.password,
        }),
      });
      setOrganizationSaved(true);
      setStep(organizationData.organizationType === "Retailer" ? 3 : 2);
      setShowSuccess(true);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const handleUserChange = (index, e) => {
    const { name, value } = e.target;
    const updatedUsers = [...users];
    updatedUsers[index][name] = name === "mobile" ? sanitizeMobileInput(value) : value;
    setUsers(updatedUsers);
  };

  const addUser = () => {
    if (users.length >= 3) {
      showToast("Maximum 3 users allowed", "error");
      return;
    }
    setUsers([...users, { fullName: "", email: "", mobile: "", password: "", saved: false }]);
  };

  const removeUser = (index) => setUsers(users.filter((_, i) => i !== index));

  const handleSaveUser = async (index) => {
    if (!users[index].fullName || !users[index].email || !users[index].password) {
      showToast("Fill all required user fields", "error");
      return;
    }
    if (users[index].mobile && !isValidMobile(users[index].mobile)) {
      showToast("Mobile number must be exactly 10 digits", "error");
      return;
    }
    const passwordError = passwordStrengthError(users[index].password);
    if (passwordError) {
      showToast(passwordError, "error");
      return;
    }
    setLoading(true);
    try {
      await apiRequest(`/api/organizations/${savedOrgId}/users`, {
        method: "POST",
        body: JSON.stringify({
          full_name: users[index].fullName,
          email: users[index].email,
          mobile: users[index].mobile || null,
          password: users[index].password,
        }),
      });
      const updatedUsers = [...users];
      updatedUsers[index].saved = true;
      setUsers(updatedUsers);
      showToast(`User ${index + 1} saved. They can log in with the email and password set above.`);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const handleEditUser = (index) => {
    const updatedUsers = [...users];
    updatedUsers[index].saved = false;
    setUsers(updatedUsers);
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

  // Renaming a master entry changes the key every other list (pricing,
  // charges, serviceCharges, chargeMaster) keys off of — simplest and
  // safest to just reload everything fresh rather than try to patch each
  // structure's references to the old name in place.
  const renameService = async (serviceId, newName) => {
    await apiRequest(`/api/services/${serviceId}`, { method: "PATCH", body: JSON.stringify({ service_name: newName }) });
    loadServices();
  };

  const renameCharge = async (chargeId, newName) => {
    await apiRequest(`/api/charges/${chargeId}`, { method: "PATCH", body: JSON.stringify({ charge_name: newName }) });
    loadServices();
  };

  // Deletes from the global charge-type catalog (not just this partner) —
  // same master list every partner's Additional Charges picker reads from,
  // so this affects everyone, not only the partner being onboarded.
  const handleDeleteCharge = async (chargeMasterRow) => {
    if (!await confirm(`Delete charge type "${chargeMasterRow.charge_name}"? This removes it for every partner, not just this one.`)) return;
    try {
      await apiRequest(`/api/charges/${chargeMasterRow.id}`, { method: "DELETE" });
      loadServices();
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const handleCreateService = async ({ name, description }) => {
    await apiRequest(`/api/services`, {
      method: "POST",
      body: JSON.stringify({ service_name: name, description }),
    });
    setShowAddService(false);
    loadServices();
  };

  const handleCreateCharge = async ({ name, description }) => {
    await apiRequest(`/api/charges`, {
      method: "POST",
      body: JSON.stringify({ charge_name: name, description }),
    });
    setShowAddCharge(false);
    loadServices();
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

  // Document Service must persist immediately (like on Manage Services) —
  // DocumentServiceConfigPanel only serves/accepts document configs once the
  // backend already considers this service active for the partner.
  const toggleDocumentService = async (nextActive) => {
    setSavingDocService(true);
    updateService("Document Service", "is_active", nextActive);
    try {
      await apiRequest(`/api/organizations/${savedOrgId}/pricing`, {
        method: "PUT",
        body: JSON.stringify({ services: [{ service_name: "Document Service", is_active: nextActive, price: null }] }),
      });
    } catch (err) {
      updateService("Document Service", "is_active", !nextActive);
      showToast(err.message, "error");
    } finally {
      setSavingDocService(false);
    }
  };

  const handleSaveServices = async ({ silent = false } = {}) => {
    setSavingServices(true);
    try {
      const updated = await apiRequest(`/api/organizations/${savedOrgId}/pricing`, {
        method: "PUT",
        body: JSON.stringify({
          services: pricing.services.map((s) => ({
            service_name: s.service_name,
            is_active: s.is_active,
            price: toNumberOrNull(s.price),
          })),
        }),
      });
      // One save per service that currently has (or ever had, this session)
      // an Additional Charges list — a full replace each time, so unticking
      // a charge client-side actually deletes that assignment server-side
      // too (see organizations.update_organization_service_charge_pricing).
      for (const [serviceName, list] of Object.entries(serviceCharges)) {
        await apiRequest(`/api/organizations/${savedOrgId}/pricing/services/${encodeURIComponent(serviceName)}/charges`, {
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
        await apiRequest(`/api/organizations/${savedOrgId}/pricing/charges`, {
          method: "PUT",
          body: JSON.stringify({
            // Price is set per-service in Additional Charges above, not here —
            // this only saves which charge types are enabled for this partner.
            charges: charges.charges.map((c) => ({
              charge_name: c.charge_name,
              is_active: c.is_active,
            })),
          }),
        });
      }
      setPricing(updated);
      setServicesSaved(true);
      if (!silent) showToast("Services saved.");
      return true;
    } catch (err) {
      showToast(err.message, "error");
      return false;
    } finally {
      setSavingServices(false);
    }
  };

  // "Create Partner" is the primary call-to-action at the end of the wizard —
  // it must persist whatever service toggles are pending, not just navigate
  // away, otherwise a partner who never separately clicked "Save Services"
  // silently loses their selections.
  const handleCreatePartner = async () => {
    const saved = await handleSaveServices({ silent: true });
    if (saved) navigate(`${base}/customer-list`);
  };

  const handleNewCustomer = () => {
    setOrganizationData(emptyOrganizationData);
    setUsers([{ fullName: "", email: "", mobile: "", password: "", saved: false }]);
    setOrganizationSaved(false);
    setSavedOrgId(null);
    setStep(1);
    setPricing(emptyPricing);
    setServicesLoaded(false);
    setServicesSaved(false);
    setServiceCharges({});
    setCharges({ charges: [] });
    setServiceMaster([]);
    setEditingServiceName(null);
  };

  const documentServiceActive = pricing.services.find((s) => s.service_name === "Document Service")?.is_active;
  const visibleServices = pricing.services.filter((s) => !HIDDEN_SERVICES.has(s.service_name));
  const editingService = editingServiceName ? visibleServices.find((s) => s.service_name === editingServiceName) : null;

  return (
    <div>
      {toast && (
        <div className="fixed top-5 right-5 z-50 px-5 py-3 rounded-xl text-sm font-semibold shadow-lg text-white transition-all" style={{ background: toast.type === "error" ? "#176B87" : "#16A34A" }}>
          {toast.msg}
        </div>
      )}

      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "#0f172a" }}>Customer Onboard</h1>
          <p className="text-sm mt-1" style={{ color: "#5B7285" }}>Register a new partner, its users, and its services</p>
        </div>
        {organizationSaved && (
          <button onClick={handleNewCustomer} className="px-4 py-2 rounded-xl text-sm font-semibold" style={{ background: "#E2EBF4", color: "#334155" }}>
            New Customer
          </button>
        )}
      </div>

      <div className="flex items-center gap-3 mb-6">
        <div className="flex items-center gap-2">
          <span className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: "#1E6091" }}>1</span>
          <span className="text-sm font-semibold" style={{ color: "#1E6091" }}>Partner</span>
        </div>
        <div className="flex-1 h-0.5 rounded-full max-w-16" style={{ background: organizationSaved ? "#1E6091" : "#D8E6F0" }}></div>
        <div className="flex items-center gap-2">
          <span className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: organizationSaved ? "#1E6091" : "#E2EBF4", color: organizationSaved ? "#fff" : "#5B7285" }}>2</span>
          <span className="text-sm font-semibold" style={{ color: organizationSaved ? "#1E6091" : "#5B7285" }}>Users</span>
        </div>
        <div className="flex-1 h-0.5 rounded-full max-w-16" style={{ background: organizationSaved ? "#1E6091" : "#D8E6F0" }}></div>
        <div className="flex items-center gap-2">
          <span className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: step === 3 || servicesSaved ? "#1E6091" : "#E2EBF4", color: step === 3 || servicesSaved ? "#fff" : "#5B7285" }}>3</span>
          <span className="text-sm font-semibold" style={{ color: step === 3 || servicesSaved ? "#1E6091" : "#5B7285" }}>Services</span>
        </div>
      </div>

      <div className="rounded-2xl p-6 mb-6" style={{ background: "#fff", border: "1px solid #D8E6F0", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        <div className="flex justify-between items-center mb-5">
          <div>
            <h2 className="text-base font-bold" style={{ color: "#0f172a" }}>Partner Details</h2>
            <p className="text-xs mt-0.5" style={{ color: "#5B7285" }}>Primary business information</p>
          </div>
          {organizationSaved && (
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold" style={{ background: "#E6F5EA", color: "#3D7A1F" }}>
              Saved
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Partner Name *">
            <input type="text" name="organizationName" value={organizationData.organizationName} onChange={handleOrgChange} disabled={organizationSaved} placeholder="e.g. Infosys Limited" className={inputClass} style={organizationSaved ? disabledStyle : inputStyle} />
          </Field>
          <Field label="Partner Type *">
            <select name="organizationType" value={organizationData.organizationType} onChange={handleOrgChange} disabled={organizationSaved} className={inputClass} style={organizationSaved ? disabledStyle : inputStyle}>
              <option value="">Select type</option>
              <option value="Dealer">Dealer</option>
              <option value="Retailer">Retailer</option>
            </select>
          </Field>
          {organizationData.organizationType === "Retailer" && (
            <Field label="Retailer Category *">
              <select name="retailerCategory" value={organizationData.retailerCategory} onChange={handleOrgChange} disabled={organizationSaved} className={inputClass} style={organizationSaved ? disabledStyle : inputStyle}>
                <option value="">Select category</option>
                {RETAILER_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </Field>
          )}
          {(organizationData.organizationType === "Retailer" || organizationData.organizationType === "Dealer") && (
            <Field label="Password *">
              <input type="password" name="password" value={organizationData.password} onChange={handleOrgChange} disabled={organizationSaved} placeholder={PASSWORD_HINT} className={inputClass} style={organizationSaved ? disabledStyle : inputStyle} />
            </Field>
          )}
          <Field label="Contact Person">
            <input type="text" name="contactPerson" value={organizationData.contactPerson} onChange={handleOrgChange} disabled={organizationSaved} placeholder="Full name" className={inputClass} style={organizationSaved ? disabledStyle : inputStyle} />
          </Field>
          <Field label="Email Address *">
            <input type="email" name="email" value={organizationData.email} onChange={handleOrgChange} disabled={organizationSaved} placeholder="contact@company.com" className={inputClass} style={organizationSaved ? disabledStyle : inputStyle} />
          </Field>
          <Field label="Mobile Number">
            <input type="text" inputMode="numeric" maxLength={10} name="mobile" value={organizationData.mobile} onChange={handleOrgChange} disabled={organizationSaved} placeholder="9876543210" className={inputClass} style={organizationSaved ? disabledStyle : inputStyle} />
          </Field>
          <Field label="State *">
            <select name="state" value={organizationData.state} onChange={handleOrgChange} disabled={organizationSaved} className={inputClass} style={organizationSaved ? disabledStyle : inputStyle}>
              <option value="">Select state</option>
              {states.map((s) => (
                <option key={s.id} value={s.id}>{s.state_name}</option>
              ))}
            </select>
          </Field>
          <Field label="GST Number">
            <input type="text" name="gstNumber" value={organizationData.gstNumber} onChange={handleOrgChange} disabled={organizationSaved} placeholder="22AAAAA0000A1Z5" className={inputClass} style={organizationSaved ? disabledStyle : inputStyle} />
          </Field>
          <Field label="Active Status">
            <label className="flex items-center gap-3 py-2 cursor-pointer">
              <div className="relative" onClick={() => !organizationSaved && setOrganizationData({ ...organizationData, status: !organizationData.status })}>
                <div className="w-11 h-6 rounded-full transition-colors" style={{ background: organizationData.status ? "#1E6091" : "#D8E6F0" }}></div>
                <div className="absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all" style={{ left: organizationData.status ? "24px" : "4px" }}></div>
              </div>
              <span className="text-sm font-medium" style={{ color: organizationData.status ? "#1E6091" : "#5B7285" }}>{organizationData.status ? "Active" : "Inactive"}</span>
            </label>
          </Field>
          <div className="md:col-span-2">
            <Field label="Payment Configuration *">
              <div className="flex items-center gap-6 py-2">
                {PAYMENT_MODES.map((opt) => (
                  <label key={opt.value} className="flex items-center gap-2 cursor-pointer text-sm font-medium" style={{ color: organizationData.paymentMode === opt.value ? "#1E6091" : "#5B7285" }}>
                    <input
                      type="radio"
                      name="paymentMode"
                      value={opt.value}
                      checked={organizationData.paymentMode === opt.value}
                      onChange={handleOrgChange}
                      disabled={organizationSaved}
                      className="accent-[#1E6091]"
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </Field>
          </div>
          <Field label="Address Line 1 *">
            <input type="text" name="addressLine1" value={organizationData.addressLine1} onChange={handleOrgChange} disabled={organizationSaved} placeholder="Building, street" className={inputClass} style={organizationSaved ? disabledStyle : inputStyle} />
          </Field>
          <Field label="Address Line 2">
            <input type="text" name="addressLine2" value={organizationData.addressLine2} onChange={handleOrgChange} disabled={organizationSaved} placeholder="Area, landmark (optional)" className={inputClass} style={organizationSaved ? disabledStyle : inputStyle} />
          </Field>
          <Field label="City *">
            <input type="text" name="city" value={organizationData.city} onChange={handleOrgChange} disabled={organizationSaved} placeholder="e.g. Bengaluru" className={inputClass} style={organizationSaved ? disabledStyle : inputStyle} />
          </Field>
          <Field label="Pincode *">
            <input type="text" inputMode="numeric" maxLength={6} name="pincode" value={organizationData.pincode} onChange={handleOrgChange} disabled={organizationSaved} placeholder="560001" className={inputClass} style={organizationSaved ? disabledStyle : inputStyle} />
          </Field>
        </div>

        {!organizationSaved && (
          <div className="mt-5 flex justify-end">
            <button onClick={handleSaveOrganization} disabled={loading} className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>
              {loading ? "Saving..." : "Save Partner"}
            </button>
          </div>
        )}
      </div>

      {organizationSaved && organizationData.organizationType !== "Retailer" && (
        <div className="rounded-2xl p-6 mb-6" style={{ background: "#fff", border: "1px solid #D8E6F0", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div className="flex justify-between items-center mb-5">
            <div>
              <h2 className="text-base font-bold" style={{ color: "#0f172a" }}>Partner Users</h2>
              <p className="text-xs mt-0.5" style={{ color: "#5B7285" }}>
                {organizationData.contactPerson || organizationData.organizationName} can already log in with the email and password set on Partner Details. Optionally add up to 2 more users here — they can log in immediately with the email and password set below —{" "}
                {organizationData.organizationType === "Dealer"
                  ? "into the Partner Panel."
                  : "into the Users Portal."}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={addUser} className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-colors" style={{ background: "#E8F3FB", color: "#1E6091", border: "1px solid #BBF7F0" }}>
                Add User
              </button>
              <button
                onClick={() => setStep(3)}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
                style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}
              >
                Next: Services
              </button>
            </div>
          </div>

          <div className="space-y-4">
            {users.map((user, index) => (
              <div key={index} className="rounded-xl p-5" style={{ background: "#F3F8FB", border: `1px solid ${user.saved ? "#BBF7F0" : "#D8E6F0"}` }}>
                <div className="flex justify-between items-center mb-4">
                  <div className="flex items-center gap-3">
                    <span className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: user.saved ? "#1E6091" : "#cbd5e1" }}>{index + 1}</span>
                    <span className="text-sm font-semibold" style={{ color: "#1e293b" }}>User {index + 1}</span>
                    {user.saved && <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold" style={{ background: "#E6F5EA", color: "#3D7A1F" }}>Saved</span>}
                  </div>
                  {users.length > 1 && (
                    <button onClick={() => removeUser(index)} className="text-xs px-3 py-1.5 rounded-lg font-semibold" style={{ background: "#E8F3FB", color: "#1E6091" }}>Remove</button>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Field label="Full Name *">
                    <input type="text" name="fullName" value={user.fullName} onChange={(e) => handleUserChange(index, e)} disabled={user.saved} placeholder="e.g. Rahul Sharma" className={inputClass} style={user.saved ? disabledStyle : { ...inputStyle, background: "#fff" }} />
                  </Field>
                  <Field label="Email *">
                    <input type="email" name="email" value={user.email} onChange={(e) => handleUserChange(index, e)} disabled={user.saved} placeholder="user@company.com" className={inputClass} style={user.saved ? disabledStyle : { ...inputStyle, background: "#fff" }} />
                  </Field>
                  <Field label="Mobile">
                    <input type="text" inputMode="numeric" maxLength={10} name="mobile" value={user.mobile} onChange={(e) => handleUserChange(index, e)} disabled={user.saved} placeholder="9876543210" className={inputClass} style={user.saved ? disabledStyle : { ...inputStyle, background: "#fff" }} />
                  </Field>
                  <Field label="Password *">
                    <input type="password" name="password" value={user.password} onChange={(e) => handleUserChange(index, e)} disabled={user.saved} placeholder={PASSWORD_HINT} className={inputClass} style={user.saved ? disabledStyle : { ...inputStyle, background: "#fff" }} />
                  </Field>
                </div>
                <div className="mt-4 flex justify-end">
                  {!user.saved ? (
                    <button onClick={() => handleSaveUser(index)} disabled={loading} className="px-5 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-60" style={{ background: "#16A34A" }}>
                      {loading ? "Saving..." : "Save User"}
                    </button>
                  ) : (
                    <button onClick={() => handleEditUser(index)} className="px-5 py-2 rounded-xl text-sm font-semibold" style={{ background: "#E8F3FB", color: "#1E6091" }}>
                      Edit User
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="rounded-2xl p-6" style={{ background: "#fff", border: "1px solid #D8E6F0", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div className="flex justify-between items-center mb-5">
            <div>
              <h2 className="text-base font-bold" style={{ color: "#0f172a" }}>Partner Services</h2>
              <p className="text-xs mt-0.5" style={{ color: "#5B7285" }}>Click Edit on a service to set its price and additional charges</p>
            </div>
            <div className="flex items-center gap-2">
              {servicesSaved && (
                <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold" style={{ background: "#E6F5EA", color: "#3D7A1F" }}>
                  Saved
                </span>
              )}
              <button onClick={() => setStep(2)} className="px-4 py-2 rounded-xl text-sm font-semibold" style={{ background: "#E2EBF4", color: "#334155" }}>
                Back
              </button>
            </div>
          </div>

          <div className="rounded-xl p-4 mb-5 text-sm font-medium" style={{ background: "#E8F3FB", color: "#1E6091", border: "1px solid #BBF7F0" }}>
            {organizationData.paymentMode === "Wallet"
              ? "This partner uses Wallet payments. Service usage will be deducted from their wallet balance."
              : "This partner uses Self PPS (Pay Per Service). No wallet-related settings apply."}
          </div>

          {loadingServices ? (
            <div className="rounded-xl p-8 text-center" style={{ background: "#F3F8FB", border: "1px solid #D8E6F0" }}>
              <p className="text-sm" style={{ color: "#5B7285" }}>Loading services...</p>
            </div>
          ) : (
            <>
              <div className="mb-4 flex items-start justify-between gap-3">
                <p className="text-xs" style={{ color: "#5B7285" }}>Enable the services this partner can access</p>
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
                  <DocumentServiceConfigPanel key={savedOrgId} organizationId={savedOrgId} />
                </div>
              )}

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

              <div className="mt-5 flex justify-end">
                <button onClick={handleCreatePartner} disabled={savingServices} className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>
                  {savingServices ? "Saving..." : "Create Partner"}
                </button>
              </div>
            </>
          )}

          {editingService && (
            <ServiceEditModal
              service={editingService}
              serviceMasterRow={serviceMaster.find((m) => m.service_name === editingService.service_name)}
              chargeMaster={chargeMaster}
              assignedCharges={chargesForService(editingService.service_name)}
              organizationId={savedOrgId}
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
              title={organizationData.organizationName}
              fetchUrl={`/api/price-history?organization_id=${savedOrgId}`}
              onClose={() => setShowHistory(false)}
            />
          )}
        </div>
      )}

      {showSuccess && (
        <SuccessModal
          title="Partner Saved Successfully"
          message="Now add users for this partner below."
          onOk={() => setShowSuccess(false)}
        />
      )}
    </div>
  );
};

export default CustomerOnboard;
