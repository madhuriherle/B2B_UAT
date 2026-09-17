import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { apiRequest } from "../lib/api";
import { gstInclusiveTooltip } from "../lib/format";
import { useAuth } from "../lib/AuthContext";
import { portalBase } from "../lib/roleHome";
import QuickAddModal from "../components/QuickAddModal";
import PriceHistoryModal from "../components/PriceHistoryModal";
import DocumentServiceConfigPanel from "../components/DocumentServiceConfigPanel";
import BulkEstampPricingPanel from "../components/BulkEstampPricingPanel";
import SuccessModal from "../components/SuccessModal";
import InlineRenameButton from "../components/InlineRenameButton";

const addIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const historyIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 3v5h5" /><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" /><path d="M12 7v5l4 2" />
  </svg>
);

const inputClass = "w-full px-4 py-2.5 text-sm rounded-xl outline-none transition-all disabled:cursor-not-allowed";
const inputStyle = { background: "#F3F8FB", border: "1px solid #D8E6F0", color: "#1e293b" };
const disabledStyle = { background: "#E2EBF4", border: "1px solid #D8E6F0", color: "#5B7285" };
const card = { background: "#fff", border: "1px solid #D8E6F0", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" };
const priceInputStyle = { background: "#F3F8FB", border: "1px solid #D8E6F0", color: "#1e293b" };

const Field = ({ label, children }) => (
  <div>
    <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#5B7285" }}>{label}</label>
    {children}
  </div>
);

const emptyPricing = { services: [] };
const emptyCharges = { charges: [] };

// Native <select> can't filter its options as you type, so the Partner field
// is a combobox: a text input that opens a filtered list on focus, matching
// name/contact/email, and reports the picked id the same way onChange did.
const PartnerSearchSelect = ({ organizations, selectedOrgId, onSelect }) => {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  const selected = organizations.find((o) => String(o.id) === String(selectedOrgId));

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? organizations.filter(
        (o) =>
          o.organization_name?.toLowerCase().includes(q) ||
          o.contact_person?.toLowerCase().includes(q) ||
          o.email?.toLowerCase().includes(q)
      )
    : organizations;

  const handleSelect = (org) => {
    onSelect(org.id);
    setQuery("");
    setOpen(false);
  };

  return (
    <div className="relative" ref={containerRef}>
      <input
        type="text"
        value={open ? query : selected?.organization_name || ""}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => {
          setOpen(true);
          setQuery("");
        }}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        placeholder="Search by partner name"
        className={inputClass}
        style={{ ...inputStyle, paddingRight: selectedOrgId && !open ? "2.25rem" : undefined }}
      />
      {selectedOrgId && !open && (
        <button
          type="button"
          onClick={() => onSelect("")}
          aria-label="Clear partner"
          className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded-full text-sm font-semibold transition-colors hover:bg-[#E2EBF4]"
          style={{ color: "#5B7285" }}
        >
          ✕
        </button>
      )}
      {open && (
        <div
          className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto rounded-xl shadow-lg"
          style={{ background: "#fff", border: "1px solid #D8E6F0" }}
        >
          {selectedOrgId && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleSelect({ id: "" })}
              className="w-full text-left px-4 py-2 text-xs font-semibold transition-colors hover:bg-[#F3F8FB]"
              style={{ color: "#5B7285" }}
            >
              ✕ Clear selection
            </button>
          )}
          {filtered.length === 0 ? (
            <p className="px-4 py-3 text-sm" style={{ color: "#94A3B8" }}>No partners found</p>
          ) : (
            filtered.map((o) => (
              <button
                type="button"
                key={o.id}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleSelect(o)}
                className="w-full text-left px-4 py-2.5 text-sm transition-colors hover:bg-[#F3F8FB]"
                style={{ background: String(o.id) === String(selectedOrgId) ? "#E8F3FB" : "transparent", color: "#1e293b" }}
              >
                <p className="font-medium">{o.organization_name}</p>
                <p className="text-xs" style={{ color: "#94A3B8" }}>{o.contact_person || "-"} · {o.email}</p>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
};

const toNumberOrNull = (value) => (value === "" || value === null || value === undefined ? null : Number(value));

const PriceInput = ({ value, onChange, width = "w-24", disabled = false }) => {
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
        className={`${width} px-2 py-1.5 text-sm rounded-lg outline-none disabled:cursor-not-allowed`}
        style={disabled ? { background: "#E2EBF4", border: "1px solid #D8E6F0", color: "#cbd5e1" } : priceInputStyle}
      />
      {tooltip && (
        <div className="pointer-events-none absolute left-1/2 bottom-full z-30 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[11px] font-semibold opacity-0 shadow-lg transition-opacity group-hover:opacity-100" style={{ background: "#0f172a", color: "#fff" }}>
          {tooltip}
        </div>
      )}
    </div>
  );
};

const PercentInput = ({ value, onChange, width = "w-20", disabled = false }) => (
  <div className="flex items-center gap-1.5">
    <input
      type="number"
      min="0"
      step="0.01"
      value={value ?? ""}
      onChange={onChange}
      disabled={disabled}
      className={`${width} px-2 py-1.5 text-sm rounded-lg outline-none disabled:cursor-not-allowed`}
      style={disabled ? { background: "#E2EBF4", border: "1px solid #D8E6F0", color: "#cbd5e1" } : priceInputStyle}
    />
    <span className="text-xs" style={{ color: disabled ? "#cbd5e1" : "#5B7285" }}>%</span>
  </div>
);

const Quotation = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const base = portalBase(user);
  const [searchParams] = useSearchParams();
  // Captured once at mount: if this page was opened via a deep link from a
  // partner's profile ("Edit Services"), saving should return there instead
  // of clearing the form for the next partner (the standalone sidebar flow).
  const [returnOrgId] = useState(() => searchParams.get("organization_id") || null);
  const [organizations, setOrganizations] = useState([]);
  const [selectedOrgId, setSelectedOrgId] = useState(searchParams.get("organization_id") || "");
  const [pricing, setPricing] = useState(emptyPricing);
  const [charges, setCharges] = useState(emptyCharges);
  // Additional, admin-defined per-service charges (Delivery Charge, Handling
  // Charge, any arbitrary type Super Admin creates via "+ Add Charge" below)
  // — { [service_name]: [{charge_name, is_active, price, calculation_type,
  // percentage, minimum_amount}] }, distinct from the org-wide Charges
  // section and from each service's own Base Price. calculation_type/
  // percentage/minimum_amount only ever matter for "Service Charge" — every
  // other charge stays a plain fixed `price`, same as before.
  const [serviceCharges, setServiceCharges] = useState({});
  const [chargeMaster, setChargeMaster] = useState([]);
  // The raw master lists (with real ids, unlike pricing.services/charges.charges
  // which only carry names) — needed to PATCH /api/services/{id} or
  // /api/charges/{id} when renaming.
  const [serviceMaster, setServiceMaster] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [showAddService, setShowAddService] = useState(false);
  const [showAddCharge, setShowAddCharge] = useState(false);
  const [historyModal, setHistoryModal] = useState(null);
  const [showSuccess, setShowSuccess] = useState(false);

  const reloadMasters = () => {
    apiRequest("/api/services").then(setServiceMaster).catch(() => setServiceMaster([]));
    apiRequest("/api/charges").then(setChargeMaster).catch(() => setChargeMaster([]));
  };

  useEffect(() => {
    apiRequest("/api/organizations").then(setOrganizations).catch(() => setOrganizations([]));
    reloadMasters();
  }, []);

  const reloadOrgData = () => {
    if (!selectedOrgId) {
      setPricing(emptyPricing);
      setCharges(emptyCharges);
      setServiceCharges({});
      return;
    }
    setLoading(true);
    Promise.all([
      apiRequest(`/api/organizations/${selectedOrgId}/pricing`).catch(() => emptyPricing),
      apiRequest(`/api/organizations/${selectedOrgId}/pricing/charges`).catch(() => emptyCharges),
      apiRequest(`/api/organizations/${selectedOrgId}/pricing/service-charges`).catch(() => ({ charges: [] })),
    ])
      .then(([pricingResult, chargesResult, serviceChargesResult]) => {
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
      })
      .finally(() => setLoading(false));
  };

  useEffect(reloadOrgData, [selectedOrgId]);

  // Renaming a master entry changes the key every other list (pricing,
  // charges, serviceCharges) keys off of — simplest and safest to reload
  // both the masters and the currently selected org's data fresh rather
  // than try to patch each structure's references to the old name in place.
  const renameService = async (serviceId, newName) => {
    await apiRequest(`/api/services/${serviceId}`, { method: "PATCH", body: JSON.stringify({ service_name: newName }) });
    reloadMasters();
    reloadOrgData();
  };

  const renameCharge = async (chargeId, newName) => {
    await apiRequest(`/api/charges/${chargeId}`, { method: "PATCH", body: JSON.stringify({ charge_name: newName }) });
    reloadMasters();
    reloadOrgData();
  };

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const handleCreateService = async ({ name, description }) => {
    await apiRequest("/api/services", {
      method: "POST",
      body: JSON.stringify({ service_name: name, description }),
    });
    setShowAddService(false);
    showToast("Service added");
    reloadMasters();
    reloadOrgData();
  };

  const handleCreateCharge = async ({ name, description }) => {
    await apiRequest("/api/charges", {
      method: "POST",
      body: JSON.stringify({ charge_name: name, description }),
    });
    setShowAddCharge(false);
    showToast("Charge added");
    reloadMasters();
    reloadOrgData();
  };

  const selectedOrganization = organizations.find((o) => String(o.id) === String(selectedOrgId));

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

  // The Document Service Configuration panel below is gated on this toggle
  // being active, and the backend requires it to actually be saved active
  // before it'll serve or accept document configs — so unlike other
  // services, this one must persist immediately rather than waiting for the
  // "Save Pricing" button, or the panel would open against a service the
  // backend still considers off.
  const [savingDocService, setSavingDocService] = useState(false);
  const toggleDocumentService = async (nextActive) => {
    setSavingDocService(true);
    updateService("Document Service", "is_active", nextActive);
    try {
      await apiRequest(`/api/organizations/${selectedOrgId}/pricing`, {
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

  const handleSave = async () => {
    if (!selectedOrganization) {
      showToast("Select a partner first", "error");
      return;
    }
    setSaving(true);
    try {
      const [updatedPricing, updatedCharges] = await Promise.all([
        apiRequest(`/api/organizations/${selectedOrgId}/pricing`, {
          method: "PUT",
          body: JSON.stringify({
            services: pricing.services.map((s) => ({
              service_name: s.service_name,
              is_active: s.is_active,
              price: toNumberOrNull(s.price),
            })),
          }),
        }),
        apiRequest(`/api/organizations/${selectedOrgId}/pricing/charges`, {
          method: "PUT",
          body: JSON.stringify({
            // Price is no longer set here — Manage Services' per-service
            // "Additional Charges" panel is now the only place a charge gets
            // a price (see serviceCharges save below). This panel is just
            // the org-wide enable/disable toggle for each charge type.
            charges: charges.charges.map((c) => ({
              charge_name: c.charge_name,
              is_active: c.is_active,
            })),
          }),
        }),
      ]);
      // One save per service that currently has (or ever had, this session)
      // an Additional Charges list — a full replace each time, so unticking
      // a charge client-side actually deletes that assignment server-side
      // too (see organizations.update_organization_service_charge_pricing).
      for (const [serviceName, list] of Object.entries(serviceCharges)) {
        await apiRequest(`/api/organizations/${selectedOrgId}/pricing/services/${encodeURIComponent(serviceName)}/charges`, {
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
      setPricing(updatedPricing);
      setCharges(updatedCharges);
      setShowSuccess(true);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setSaving(false);
    }
  };

  const handleSuccessOk = () => {
    setShowSuccess(false);
    if (returnOrgId) {
      navigate(`${base}/partners/${returnOrgId}/profile?tab=services`);
      return;
    }
    setSelectedOrgId("");
    setPricing(emptyPricing);
    setCharges(emptyCharges);
    setServiceCharges({});
  };

  return (
    <div>
      {toast && (
        <div className="fixed top-5 right-5 z-50 px-5 py-3 rounded-xl text-sm font-semibold shadow-lg text-white transition-all max-w-xl" style={{ background: toast.type === "error" ? "#176B87" : "#16A34A" }}>
          {toast.msg}
        </div>
      )}

      <div className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: "#0f172a" }}>Manage Services</h1>
        <p className="text-sm mt-1" style={{ color: "#5B7285" }}>Configure service access and pricing for a partner</p>
      </div>

      <section className="rounded-2xl p-6 mb-6" style={card}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Partner *">
            <PartnerSearchSelect organizations={organizations} selectedOrgId={selectedOrgId} onSelect={setSelectedOrgId} />
          </Field>
          <Field label="Partner Email">
            <input value={selectedOrganization?.email || ""} disabled className={inputClass} style={disabledStyle} placeholder="Auto-filled from partner" />
          </Field>
          <Field label="Partner Type">
            <input value={selectedOrganization?.organization_type || "-"} disabled className={inputClass} style={disabledStyle} />
          </Field>
          <Field label="Contact Person">
            <input value={selectedOrganization?.contact_person || "-"} disabled className={inputClass} style={disabledStyle} />
          </Field>
          <Field label="Mobile">
            <input value={selectedOrganization?.mobile || "-"} disabled className={inputClass} style={disabledStyle} />
          </Field>
          <Field label="State">
            <input value={selectedOrganization?.state_name || "-"} disabled className={inputClass} style={disabledStyle} />
          </Field>
        </div>
      </section>

      {!selectedOrgId ? (
        <div className="rounded-2xl p-10 text-center mb-6" style={card}>
          <p className="text-sm" style={{ color: "#5B7285" }}>Select a partner to configure services and pricing.</p>
        </div>
      ) : loading ? (
        <div className="rounded-2xl p-10 text-center mb-6" style={card}>
          <p className="text-sm" style={{ color: "#5B7285" }}>Loading pricing...</p>
        </div>
      ) : (
        <>
          <section className="rounded-2xl p-6 mb-6" style={card}>
            <div className="flex items-start justify-between gap-3 mb-1">
              <h2 className="text-base font-bold" style={{ color: "#0f172a" }}>Services</h2>
              <button type="button" onClick={() => setShowAddService(true)} title="Add service" className="w-8 h-8 shrink-0 rounded-lg flex items-center justify-center text-white transition-opacity hover:opacity-90" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>
                {addIcon}
              </button>
            </div>
            <p className="text-xs mb-4" style={{ color: "#5B7285" }}>Enable a service to see every available charge type for it — tick the ones that apply and set their price</p>
            <div className="grid grid-cols-1 gap-3">
              {pricing.services.map((s) => {
                const assigned = chargesForService(s.service_name);
                const assignedByName = Object.fromEntries(assigned.map((c) => [c.charge_name, c]));
                const availableCharges = chargeMaster.filter((c) => c.status);
                const serviceMasterRow = serviceMaster.find((m) => m.service_name === s.service_name);
                return (
                  <div key={s.service_name} className="rounded-xl p-3" style={{ background: s.is_active ? "#E6F5EA" : "#F3F8FB", border: `1px solid ${s.is_active ? "#16A34A" : "#D8E6F0"}` }}>
                    <div className="flex items-center flex-wrap gap-3">
                      <button
                        type="button"
                        disabled={s.service_name === "Document Service" && savingDocService}
                        onClick={() =>
                          s.service_name === "Document Service"
                            ? toggleDocumentService(!s.is_active)
                            : updateService(s.service_name, "is_active", !s.is_active)
                        }
                        className="w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold flex-shrink-0 disabled:opacity-60"
                        style={{ background: s.is_active ? "#16A34A" : "#D8E6F0", color: s.is_active ? "#fff" : "#5B7285" }}
                      >
                        {s.is_active ? "✓" : ""}
                      </button>
                      <span className="text-sm font-semibold flex-1 min-w-[80px] truncate" style={{ color: s.is_active ? "#1e293b" : "#5B7285" }}>{s.service_name}</span>
                      {serviceMasterRow && (
                        <InlineRenameButton
                          currentName={s.service_name}
                          onRename={(newName) => renameService(serviceMasterRow.id, newName)}
                        />
                      )}
                      {/* eStamp Bulk has no Base Price of its own — its stamp
                          value already comes dynamically from denomination x
                          quantity at order time, and its own fee is set via
                          the "Service Charge" additional charge below
                          instead (Amount or Percentage of that stamp value).
                          A Base Price here would double-charge on top of
                          both, so it's hidden rather than just left at 0. */}
                      {s.service_name !== "Document Service" && s.service_name !== "eStamp Bulk" && (
                        <div className="flex items-center gap-2 flex-shrink-0 ml-auto">
                          <div className="flex flex-col items-end gap-0.5">
                            <span className="text-[10px] font-medium" style={{ color: "#94A3B8" }}>Base Price (excluding GST)</span>
                            <PriceInput value={s.price} onChange={(e) => updateService(s.service_name, "price", e.target.value)} width="w-20" disabled={!s.is_active} />
                          </div>
                          <button
                            type="button"
                            title="Price history"
                            onClick={() =>
                              setHistoryModal({
                                title: `${s.service_name} — ${selectedOrganization?.organization_name || ""}`,
                                fetchUrl: `/api/organizations/${selectedOrgId}/pricing/services/${encodeURIComponent(s.service_name)}/history`,
                              })
                            }
                            className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 transition-colors"
                            style={{ background: "#E2EBF4", color: "#5B7285" }}
                          >
                            {historyIcon}
                          </button>
                        </div>
                      )}
                    </div>

                    {s.service_name !== "Document Service" && s.is_active && (
                      <div className="mt-3 pt-3" style={{ borderTop: "1px dashed #C9DCE8" }}>
                        <p className="text-[10px] font-semibold uppercase tracking-wide mb-2" style={{ color: "#94A3B8" }}>Additional Charges</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          {availableCharges.map((master) => {
                            const c = assignedByName[master.charge_name];
                            const isActive = !!c?.is_active;
                            // Amount-vs-Percentage config only applies to
                            // eStamp Bulk's "Service Charge" — every other
                            // charge/service combination is a plain fixed
                            // amount, same as before this feature existed.
                            // Only takes over the row once actually turned on
                            // — while unchecked it renders as the same
                            // compact row as every other charge, not a big
                            // box full of disabled ₹0/0% fields nobody asked
                            // to configure yet.
                            const isEstampBulkServiceCharge = s.service_name === "eStamp Bulk" && master.charge_name === "Service Charge" && isActive;
                            if (isEstampBulkServiceCharge) {
                              const calcType = c?.calculation_type || "amount";
                              return (
                                <div
                                  key={master.charge_name}
                                  className="rounded-lg p-2 md:col-span-2"
                                  style={{ background: isActive ? "#E8F3FB" : "#F8FAFC", border: `1px solid ${isActive ? "#1E6091" : "#E2EBF4"}` }}
                                >
                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => toggleServiceCharge(s.service_name, master.charge_name)}
                                      className="w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                                      style={{ background: isActive ? "#16A34A" : "#D8E6F0", color: isActive ? "#fff" : "#5B7285" }}
                                    >
                                      {isActive ? "✓" : ""}
                                    </button>
                                    <span className="text-xs font-medium flex-1 min-w-0 truncate" style={{ color: isActive ? "#1e293b" : "#94A3B8" }}>{master.charge_name}</span>
                                    <select
                                      value={calcType}
                                      onChange={(e) => updateServiceChargeField(s.service_name, master.charge_name, "calculation_type", e.target.value)}
                                      disabled={!isActive}
                                      className="text-xs rounded-lg px-2 py-1.5 outline-none disabled:cursor-not-allowed"
                                      style={!isActive ? { background: "#E2EBF4", border: "1px solid #D8E6F0", color: "#cbd5e1" } : priceInputStyle}
                                    >
                                      <option value="amount">In Amount</option>
                                      <option value="percentage">In Percentage</option>
                                    </select>
                                  </div>
                                  <div className="flex items-center gap-4 mt-2 pl-7">
                                    {calcType === "amount" ? (
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-[10px] font-medium" style={{ color: "#94A3B8" }}>Amount</span>
                                        <PriceInput
                                          value={c?.price}
                                          onChange={(e) => updateServiceChargeField(s.service_name, master.charge_name, "price", e.target.value)}
                                          width="w-20"
                                          disabled={!isActive}
                                        />
                                      </div>
                                    ) : (
                                      <>
                                        <div className="flex items-center gap-1.5">
                                          <span className="text-[10px] font-medium" style={{ color: "#94A3B8" }}>Percentage</span>
                                          <PercentInput
                                            value={c?.percentage}
                                            onChange={(e) => updateServiceChargeField(s.service_name, master.charge_name, "percentage", e.target.value)}
                                            disabled={!isActive}
                                          />
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                          <span className="text-[10px] font-medium" style={{ color: "#94A3B8" }}>Min. Amount</span>
                                          <PriceInput
                                            value={c?.minimum_amount}
                                            onChange={(e) => updateServiceChargeField(s.service_name, master.charge_name, "minimum_amount", e.target.value)}
                                            width="w-20"
                                            disabled={!isActive}
                                          />
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
                                  onClick={() => toggleServiceCharge(s.service_name, master.charge_name)}
                                  className="w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                                  style={{ background: isActive ? "#16A34A" : "#D8E6F0", color: isActive ? "#fff" : "#5B7285" }}
                                >
                                  {isActive ? "✓" : ""}
                                </button>
                                <span className="text-xs font-medium flex-1 min-w-0 truncate" style={{ color: isActive ? "#1e293b" : "#94A3B8" }}>{master.charge_name}</span>
                                <PriceInput
                                  value={c?.price}
                                  onChange={(e) => updateServiceChargeField(s.service_name, master.charge_name, "price", e.target.value)}
                                  width="w-20"
                                  disabled={!isActive}
                                />
                              </div>
                            );
                          })}
                          {availableCharges.length === 0 && (
                            <p className="text-xs md:col-span-2" style={{ color: "#94A3B8" }}>No charge types exist yet — use the + button above to create one.</p>
                          )}
                        </div>
                      </div>
                    )}

                    {s.service_name === "eStamp Bulk" && s.is_active && (
                      <BulkEstampPricingPanel organizationId={selectedOrgId} />
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-2xl p-6 mb-6" style={card}>
            <div className="flex items-start justify-between gap-3 mb-1">
              <h2 className="text-base font-bold" style={{ color: "#0f172a" }}>Charges</h2>
              <button type="button" onClick={() => setShowAddCharge(true)} title="Add charge" className="w-8 h-8 shrink-0 rounded-lg flex items-center justify-center text-white transition-opacity hover:opacity-90" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>
                {addIcon}
              </button>
            </div>
            <p className="text-xs mb-4" style={{ color: "#5B7285" }}>Add and enable charge types here — set each one's price per service under Manage Services above.</p>
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
                      <InlineRenameButton currentName={c.charge_name} onRename={(newName) => renameCharge(chargeMasterRow.id, newName)} />
                    )}
                  </div>
                );
              })}
              {charges.charges.length === 0 && (
                <p className="text-sm md:col-span-2" style={{ color: "#5B7285" }}>No charges configured yet.</p>
              )}
            </div>
          </section>

          {pricing.services.find((s) => s.service_name === "Document Service")?.is_active && (
            <DocumentServiceConfigPanel key={selectedOrgId} organizationId={selectedOrgId} />
          )}

          <div className="flex justify-end pt-4 pb-2">
            <button disabled={saving} onClick={handleSave} className="px-10 py-2.5 rounded-xl text-sm font-semibold text-white shadow-lg disabled:opacity-60 min-w-[180px]" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>
              {saving ? "Saving..." : "Save Pricing"}
            </button>
          </div>
        </>
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

      {historyModal && (
        <PriceHistoryModal
          key={historyModal.fetchUrl}
          title={historyModal.title}
          fetchUrl={historyModal.fetchUrl}
          onClose={() => setHistoryModal(null)}
        />
      )}

      {showSuccess && <SuccessModal title="Pricing Saved Successfully" onOk={handleSuccessOk} />}
    </div>
  );
};

export default Quotation;

