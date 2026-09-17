import { useEffect, useState } from "react";
import { apiRequest } from "../lib/api";
import { formatCurrency, gstInclusiveTooltip } from "../lib/format";
import PriceHistoryModal from "./PriceHistoryModal";
import SuccessModal from "./SuccessModal";

const inputClass = "w-full px-4 py-2.5 text-sm rounded-xl outline-none transition-all disabled:cursor-not-allowed";
const inputStyle = { background: "#F3F8FB", border: "1px solid #D8E6F0", color: "#1e293b" };
const card = { background: "#fff", border: "1px solid #D8E6F0", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" };

const historyIcon = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 3v5h5" /><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" /><path d="M12 7v5l4 2" />
  </svg>
);

const Field = ({ label, children }) => (
  <div>
    <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#5B7285" }}>{label}</label>
    {children}
  </div>
);

const Toggle = ({ checked, onChange, label }) => (
  <label className="flex items-center gap-3 cursor-pointer">
    <div className="relative" onClick={() => onChange(!checked)}>
      <div className="w-11 h-6 rounded-full transition-colors" style={{ background: checked ? "#1E6091" : "#D8E6F0" }}></div>
      <div className="absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all" style={{ left: checked ? "24px" : "4px" }}></div>
    </div>
    <span className="text-sm font-medium" style={{ color: checked ? "#1E6091" : "#5B7285" }}>{label ?? (checked ? "Enabled" : "Disabled")}</span>
  </label>
);

const HistoryButton = ({ onClick }) => (
  <button type="button" onClick={onClick} title="Price history" className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ background: "#E2EBF4", color: "#5B7285" }}>
    {historyIcon}
  </button>
);

const PriceInput = ({ value, onChange, disabled = false }) => {
  const tooltip = gstInclusiveTooltip(value);
  return (
    <div className="relative flex items-center gap-1.5 group">
      <span className="text-xs" style={{ color: disabled ? "#cbd5e1" : "#5B7285" }}>₹</span>
      <input
        type="number"
        min="0"
        value={value ?? ""}
        onChange={onChange}
        disabled={disabled}
        placeholder="0"
        className="w-24 px-2 py-1.5 text-sm rounded-lg outline-none disabled:cursor-not-allowed"
        style={disabled ? { background: "#E2EBF4", border: "1px solid #D8E6F0", color: "#cbd5e1" } : { background: "#fff", border: "1px solid #D8E6F0", color: "#1e293b" }}
      />
      {tooltip && (
        <div className="pointer-events-none absolute left-1/2 bottom-full z-30 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[11px] font-semibold opacity-0 shadow-lg transition-opacity group-hover:opacity-100" style={{ background: "#0f172a", color: "#fff" }}>
          {tooltip}
        </div>
      )}
    </div>
  );
};

const toNumberOrNull = (value) => (value === "" || value === null || value === undefined ? null : Number(value));

const LANGUAGE_OPTIONS = ["English", "Hindi", "Kannada", "Marathi"];

// Full list of India's states + union territories, shown in the dropdown
// regardless of which ones the shared `state` table (owned by B2C) already
// has rows for. Only entries with a matching live row are selectable —
// picking one without a real state_id would break saving, since document
// pricing is looked up by that id.
const ALL_INDIA_STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa",
  "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala",
  "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland",
  "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura",
  "Uttar Pradesh", "Uttarakhand", "West Bengal",
  "Andaman and Nicobar Islands", "Chandigarh", "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi", "Jammu and Kashmir", "Ladakh", "Lakshadweep", "Puducherry",
];

const UNAVAILABLE_PREFIX = "unavailable:";

const buildStateOptions = (liveStates) => {
  const byName = new Map(liveStates.map((s) => [s.state_name.trim().toLowerCase(), s]));
  const seen = new Set();
  const options = ALL_INDIA_STATES.map((name) => {
    const live = byName.get(name.trim().toLowerCase());
    if (live) seen.add(live.id);
    return live
      ? { value: live.id, label: name, available: true }
      : { value: UNAVAILABLE_PREFIX + name, label: name, available: false };
  });
  // Any live state not matched to the canonical list (e.g. a typo like
  // "maharastra") still needs to stay usable — append it as-is.
  liveStates.forEach((s) => {
    if (!seen.has(s.id)) options.push({ value: s.id, label: s.state_name, available: true });
  });
  return options;
};

const SERVICE_META = [
  { key: "estamp", label: "eStamp" },
  { key: "esign", label: "eSign" },
  { key: "enotary", label: "eNotary" },
];

// =========================================
// Configure modal — Step 5: base price, languages, checkout add-ons, status
// =========================================

const ConfigModal = ({ row, organizationId, stateId, onClose, onSaved }) => {
  const [form, setForm] = useState({
    base_price: row.base_price ?? "",
    multi_language_enabled: row.multi_language_enabled ?? false,
    available_languages: row.available_languages?.length ? row.available_languages : ["English"],
    estamp_selected: row.estamp_price !== null && row.estamp_price !== undefined,
    esign_selected: row.esign_price !== null && row.esign_price !== undefined,
    enotary_selected: row.enotary_price !== null && row.enotary_price !== undefined,
    estamp_price: row.estamp_price ?? "",
    esign_price: row.esign_price ?? "",
    enotary_price: row.enotary_price ?? "",
    status: row.config_id ? row.status : true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [historyModal, setHistoryModal] = useState(null);

  const toggleLanguage = (lang) => {
    setForm((prev) => ({
      ...prev,
      available_languages: prev.available_languages.includes(lang)
        ? prev.available_languages.filter((l) => l !== lang)
        : [...prev.available_languages, lang],
    }));
  };

  const openHistory = (priceType, label) => {
    if (!row.config_id) return;
    setHistoryModal({
      title: `${row.doc_name} — ${label}`,
      fetchUrl: `/api/document-service/config/${row.config_id}/history?price_type=${priceType}`,
    });
  };

  const availableServices = SERVICE_META.filter((s) => row[`${s.key}_available`]);

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      const result = await apiRequest("/api/document-service/config", {
        method: "PUT",
        body: JSON.stringify({
          organization_id: organizationId,
          state_id: stateId,
          doc_id: row.doc_id,
          base_price: toNumberOrNull(form.base_price),
          multi_language_enabled: form.multi_language_enabled,
          available_languages: form.multi_language_enabled ? form.available_languages : [],
          estamp_price: form.estamp_selected ? toNumberOrNull(form.estamp_price) : null,
          esign_price: form.esign_selected ? toNumberOrNull(form.esign_price) : null,
          enotary_price: form.enotary_selected ? toNumberOrNull(form.enotary_price) : null,
          status: form.status,
        }),
      });
      onSaved(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,0.5)", backdropFilter: "blur(4px)" }}>
      <div className="w-full max-w-lg rounded-2xl overflow-hidden shadow-2xl" style={{ background: "#fff", maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
        <div className="px-6 py-5 border-b flex items-center justify-between shrink-0" style={{ borderColor: "#E2EBF4" }}>
          <div>
            <h2 className="text-lg font-bold" style={{ color: "#0f172a" }}>{row.doc_name}</h2>
            <p className="text-xs mt-0.5" style={{ color: "#5B7285" }}>{row.category_name || "Document configuration"}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors" style={{ background: "#E2EBF4", color: "#5B7285" }}>✕</button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto">
          {error && <div className="rounded-lg px-4 py-3 text-sm font-semibold" style={{ background: "#E8F3FB", color: "#1E6091" }}>{error}</div>}

          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Field label="Base Document Price (₹, excluding GST)">
                <input type="number" min="0" value={form.base_price} onChange={(e) => setForm({ ...form, base_price: e.target.value })} className={inputClass} style={inputStyle} />
              </Field>
            </div>
            {row.config_id && <HistoryButton onClick={() => openHistory("base", "Base Price History")} />}
          </div>

          <div className="rounded-xl p-3" style={{ background: "#F3F8FB", border: "1px solid #D8E6F0" }}>
            <Toggle checked={form.multi_language_enabled} onChange={(v) => setForm({ ...form, multi_language_enabled: v })} label={`Multi Language: ${form.multi_language_enabled ? "Yes" : "No"}`} />
            {form.multi_language_enabled && (
              <div className="mt-3">
                <label className="block text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#5B7285" }}>Languages</label>
                <div className="flex flex-wrap gap-2">
                  {LANGUAGE_OPTIONS.map((lang) => {
                    const checked = form.available_languages.includes(lang);
                    return (
                      <label key={lang} className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer text-sm font-medium" style={{ background: checked ? "#E6F5EA" : "#fff", border: `1px solid ${checked ? "#16A34A" : "#D8E6F0"}`, color: checked ? "#3D7A1F" : "#5B7285" }}>
                        <input type="checkbox" checked={checked} onChange={() => toggleLanguage(lang)} className="accent-[#16A34A]" />
                        {lang}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#5B7285" }}>Checkout Services</label>
            {availableServices.length === 0 ? (
              <p className="text-xs" style={{ color: "#94A3B8" }}>No eStamp/eSign/eNotary add-ons are available for this document in this state.</p>
            ) : (
              <div className="space-y-2">
                {availableServices.map(({ key, label }) => (
                  <div key={key} className="rounded-xl p-3 flex items-center justify-between gap-3" style={{ background: form[`${key}_selected`] ? "#E6F5EA" : "#F3F8FB", border: `1px solid ${form[`${key}_selected`] ? "#16A34A" : "#D8E6F0"}` }}>
                    <label className="flex items-center gap-2 text-sm font-semibold cursor-pointer" style={{ color: form[`${key}_selected`] ? "#3D7A1F" : "#5B7285" }}>
                      <input type="checkbox" checked={form[`${key}_selected`]} onChange={(e) => setForm({ ...form, [`${key}_selected`]: e.target.checked })} className="accent-[#16A34A]" />
                      {label}
                    </label>
                    <div className="flex items-center gap-2">
                      <PriceInput
                        value={form[`${key}_price`]}
                        onChange={(e) => setForm({ ...form, [`${key}_price`]: e.target.value })}
                        disabled={!form[`${key}_selected`]}
                      />
                      {row.config_id && <HistoryButton onClick={() => openHistory(key, `${label} Price History`)} />}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#5B7285" }}>Status</label>
            <Toggle checked={form.status} onChange={(v) => setForm({ ...form, status: v })} label={form.status ? "Active" : "Inactive"} />
          </div>
        </div>

        <div className="px-6 py-4 border-t flex gap-3 justify-end shrink-0" style={{ borderColor: "#E2EBF4", background: "#F3F8FB" }}>
          <button onClick={onClose} className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors" style={{ background: "#fff", border: "1px solid #D8E6F0", color: "#5B7285" }}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving} className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {historyModal && (
        <PriceHistoryModal key={historyModal.fetchUrl} title={historyModal.title} fetchUrl={historyModal.fetchUrl} onClose={() => setHistoryModal(null)} />
      )}
    </div>
  );
};

// =========================================
// Panel — Step 3 (state) + Step 4 (select documents) + Step 5 (configure)
// Embedded inline in Manage Services, shown only while the "Document Service"
// toggle is active for the selected partner (Step 1 + Step 2).
// =========================================

const DocumentServiceConfigPanel = ({ organizationId }) => {
  const [states, setStates] = useState([]);
  const [stateId, setStateId] = useState("");
  const [stateSelectValue, setStateSelectValue] = useState("");
  const [stateError, setStateError] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editingRow, setEditingRow] = useState(null);
  const [toast, setToast] = useState(null);
  const [showSuccess, setShowSuccess] = useState(false);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  useEffect(() => {
    apiRequest("/api/catalog/states").then(setStates).catch(() => setStates([]));
  }, []);

  const loadRows = (id) => {
    if (!id) {
      setRows([]);
      return;
    }
    setLoading(true);
    apiRequest(`/api/document-service/config?organization_id=${organizationId}&state_id=${id}`)
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  };

  const handleStateChange = (value) => {
    setStateSelectValue(value);

    if (value.startsWith(UNAVAILABLE_PREFIX)) {
      setStateError("Service not available for this state");
      setStateId("");
      setRows([]);
      return;
    }

    setStateError("");
    setStateId(value);
    loadRows(value);
  };

  const applyConfigResult = (result) => {
    setRows((prev) =>
      prev.map((r) =>
        r.doc_id === result.doc_id
          ? {
              ...r,
              config_id: result.id,
              selected: result.status,
              status: result.status,
              base_price: result.base_price,
              multi_language_enabled: result.multi_language_enabled,
              available_languages: result.available_languages,
              estamp_price: result.estamp_price,
              esign_price: result.esign_price,
              enotary_price: result.enotary_price,
              updated_at: result.updated_at,
            }
          : r
      )
    );
  };

  const handleQuickToggle = async (row) => {
    try {
      const result = await apiRequest("/api/document-service/config", {
        method: "PUT",
        body: JSON.stringify({
          organization_id: organizationId,
          state_id: stateId,
          doc_id: row.doc_id,
          base_price: row.base_price,
          multi_language_enabled: row.multi_language_enabled,
          available_languages: row.available_languages,
          estamp_price: row.estamp_price,
          esign_price: row.esign_price,
          enotary_price: row.enotary_price,
          status: !row.selected,
        }),
      });
      applyConfigResult(result);
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const enabledAddons = (row) =>
    SERVICE_META.filter((s) => row[`${s.key}_price`] !== null && row[`${s.key}_price`] !== undefined);

  return (
    <section className="rounded-2xl p-6 mb-6" style={card}>
      {toast && (
        <div className="fixed top-5 right-5 z-50 px-5 py-3 rounded-xl text-sm font-semibold shadow-lg text-white transition-all max-w-xl" style={{ background: toast.type === "error" ? "#176B87" : "#16A34A" }}>
          {toast.msg}
        </div>
      )}

      <h2 className="text-base font-bold mb-1" style={{ color: "#0f172a" }}>Document Service Configuration</h2>
      <p className="text-xs mb-4" style={{ color: "#5B7285" }}>Select which documents this partner can sell in a given state, and configure their pricing</p>

      <div className="max-w-sm mb-4">
        <Field label="State *">
          <select value={stateSelectValue} onChange={(e) => handleStateChange(e.target.value)} className={inputClass} style={inputStyle}>
            <option value="">Select a state</option>
            {buildStateOptions(states).map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          {stateError && <p className="text-xs mt-1.5 font-medium" style={{ color: "#C0392B" }}>{stateError}</p>}
        </Field>
      </div>

      {!stateId ? (
        <div className="rounded-xl p-8 text-center" style={{ background: "#F3F8FB", border: "1px solid #D8E6F0" }}>
          <p className="text-sm" style={{ color: "#5B7285" }}>Select a state to choose the documents this partner can sell there.</p>
        </div>
      ) : loading ? (
        <div className="rounded-xl p-8 text-center" style={{ background: "#F3F8FB", border: "1px solid #D8E6F0" }}>
          <p className="text-sm" style={{ color: "#5B7285" }}>Loading document types...</p>
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid #D8E6F0" }}>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr style={{ background: "#F3F8FB" }}>
                  {["Select", "Document", "Base Price", "Add-ons", "Status", "Actions"].map((h) => (
                    <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: "#5B7285" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.doc_id} className="border-t transition-colors hover:bg-slate-50/50" style={{ borderColor: "#E2EBF4" }}>
                    <td className="px-4 py-3">
                      <input type="checkbox" checked={row.selected} onChange={() => handleQuickToggle(row)} className="w-4 h-4 accent-[#16A34A]" />
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm font-semibold" style={{ color: "#1e293b" }}>{row.doc_name}</p>
                      <p className="text-xs" style={{ color: "#5B7285" }}>{row.category_name || "-"}</p>
                    </td>
                    <td className="px-4 py-3 text-sm font-semibold" style={{ color: "#0f172a" }}>
                      {row.base_price !== null && row.base_price !== undefined ? formatCurrency(row.base_price) : <span style={{ color: "#cbd5e1", fontWeight: 400 }}>Not set</span>}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {enabledAddons(row).length === 0 ? (
                        <span style={{ color: "#cbd5e1" }}>—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {enabledAddons(row).map(({ key, label }) => (
                            <span key={key} className="px-2 py-0.5 rounded-full font-semibold" style={{ background: "#E6F5EA", color: "#3D7A1F" }}>{label}</span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {row.selected ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold" style={{ background: "#E6F5EA", color: "#3D7A1F" }}>
                          <span className="w-1.5 h-1.5 rounded-full bg-[#16A34A]"></span>Active
                        </span>
                      ) : (
                        <span className="text-xs font-semibold" style={{ color: "#cbd5e1" }}>Not selected</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => setEditingRow(row)} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: row.config_id ? "#E6F5EA" : "#1E6091", color: row.config_id ? "#3D7A1F" : "#fff" }}>
                        {row.config_id ? "Edit" : "Configure"}
                      </button>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan="6" className="text-center py-10 text-sm" style={{ color: "#5B7285" }}>No document types found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editingRow && (
        <ConfigModal
          row={editingRow}
          organizationId={organizationId}
          stateId={stateId}
          onClose={() => setEditingRow(null)}
          onSaved={(result) => {
            applyConfigResult(result);
            setEditingRow(null);
            setShowSuccess(true);
          }}
        />
      )}

      {showSuccess && (
        <SuccessModal
          title="Saved Successfully"
          onOk={() => {
            setShowSuccess(false);
            setStateId("");
            setRows([]);
          }}
        />
      )}
    </section>
  );
};

export default DocumentServiceConfigPanel;
