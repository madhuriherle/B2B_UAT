import { useEffect, useState } from "react";
import { apiRequest } from "../../lib/api";
import { formatCurrency } from "../../lib/format";
import Modal from "../../components/Modal";

const inputClass = "w-full px-4 py-2.5 text-sm rounded-xl outline-none";
const inputStyle = { background: "#F3F8FB", border: "1px solid #D8E6F0", color: "#1e293b" };

const Field = ({ label, children }) => (
  <div>
    <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#5B7285" }}>{label}</label>
    {children}
  </div>
);

const EditModal = ({ service, states, denomCatalog, onClose, onSaved }) => {
  const [form, setForm] = useState({
    state_id: service?.state_id || "",
    document_type: service?.document_type || "",
    service_charge: service?.service_charge ?? "",
    per_copy_price: service?.per_copy_price ?? "",
    esign_price: service?.esign_price ?? "",
    enotary_price: service?.enotary_price ?? "",
    stamp_denomination_ids: (service?.stamp_denominations || []).map((d) => d.id),
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Dedupe catalog rows by denomination value — the shared stamp_denom table
  // holds one physical-stock row per denomination per state, not a catalog.
  const uniqueDenoms = Object.values(
    denomCatalog.reduce((acc, d) => {
      if (!acc[d.denomvalue]) acc[d.denomvalue] = d;
      return acc;
    }, {})
  );

  const toggleDenom = (id) => {
    setForm((f) => ({
      ...f,
      stamp_denomination_ids: f.stamp_denomination_ids.includes(id)
        ? f.stamp_denomination_ids.filter((x) => x !== id)
        : [...f.stamp_denomination_ids, id],
    }));
  };

  const handleSave = async () => {
    if (!form.state_id) {
      setError("State is required");
      return;
    }
    setLoading(true);
    setError("");
    const payload = {
      state_id: form.state_id,
      document_type: form.document_type || null,
      service_charge: form.service_charge === "" ? 0 : Number(form.service_charge),
      per_copy_price: form.per_copy_price === "" ? null : Number(form.per_copy_price),
      esign_price: form.esign_price === "" ? null : Number(form.esign_price),
      enotary_price: form.enotary_price === "" ? null : Number(form.enotary_price),
      stamp_denomination_ids: form.stamp_denomination_ids,
    };
    try {
      if (service?.id) {
        delete payload.state_id;
        await apiRequest(`/api/admin/print-delivery-service/${service.id}`, { method: "PUT", body: JSON.stringify(payload) });
      } else {
        await apiRequest("/api/admin/print-delivery-service", { method: "POST", body: JSON.stringify(payload) });
      }
      onSaved();
    } catch (err) {
      setError(err.message || "Save failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal title={service?.id ? "Edit Print & Delivery Service" : "New Print & Delivery Service"} onClose={onClose} width="max-w-2xl">
      {error && <p className="text-xs font-medium mb-3 px-3 py-2 rounded-lg" style={{ background: "#FDECEC", color: "#C0392B" }}>{error}</p>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="State *">
          <select disabled={!!service?.id} value={form.state_id} onChange={(e) => setForm({ ...form, state_id: e.target.value })} className={inputClass} style={inputStyle}>
            <option value="">Select state</option>
            {states.map((s) => <option key={s.id} value={s.id}>{s.state_name}</option>)}
          </select>
        </Field>
        <Field label="Document Type (optional)">
          <input value={form.document_type} onChange={(e) => setForm({ ...form, document_type: e.target.value })} className={inputClass} style={inputStyle} />
        </Field>
        <Field label="Service Charge">
          <input type="number" value={form.service_charge} onChange={(e) => setForm({ ...form, service_charge: e.target.value })} className={inputClass} style={inputStyle} />
        </Field>
        <Field label="Per Copy Price">
          <input type="number" value={form.per_copy_price} onChange={(e) => setForm({ ...form, per_copy_price: e.target.value })} className={inputClass} style={inputStyle} />
        </Field>
        <Field label="eSign Price">
          <input type="number" value={form.esign_price} onChange={(e) => setForm({ ...form, esign_price: e.target.value })} className={inputClass} style={inputStyle} />
        </Field>
        <Field label="eNotary Price">
          <input type="number" value={form.enotary_price} onChange={(e) => setForm({ ...form, enotary_price: e.target.value })} className={inputClass} style={inputStyle} />
        </Field>
        <div className="md:col-span-2">
          <Field label="Stamp Denominations">
            <div className="flex flex-wrap gap-2 mt-1">
              {uniqueDenoms.map((d) => (
                <label key={d.id} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm cursor-pointer" style={{ background: form.stamp_denomination_ids.includes(d.id) ? "#E6F5EA" : "#F3F8FB", border: "1px solid #D8E6F0", color: form.stamp_denomination_ids.includes(d.id) ? "#3D7A1F" : "#5B7285" }}>
                  <input type="checkbox" checked={form.stamp_denomination_ids.includes(d.id)} onChange={() => toggleDenom(d.id)} className="accent-[#16A34A]" />
                  {d.display}
                </label>
              ))}
            </div>
          </Field>
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="px-5 py-2.5 rounded-xl text-sm font-semibold" style={{ background: "#E2EBF4", color: "#334155" }}>Cancel</button>
        <button onClick={handleSave} disabled={loading} className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>
          {loading ? "Saving..." : "Save"}
        </button>
      </div>
    </Modal>
  );
};

const AdminPrintDeliveryTab = () => {
  const [services, setServices] = useState([]);
  const [states, setStates] = useState([]);
  const [denomCatalog, setDenomCatalog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);

  const loadServices = () => {
    setLoading(true);
    apiRequest("/api/admin/print-delivery-service")
      .then((data) => setServices(data || []))
      .catch(() => setServices([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadServices();
    apiRequest("/api/admin/states").then(setStates).catch(() => setStates([]));
    apiRequest("/api/admin/print-delivery-service/catalog/stamp-denominations").then(setDenomCatalog).catch(() => setDenomCatalog([]));
  }, []);

  const handleDelete = async (id) => {
    try {
      await apiRequest(`/api/admin/print-delivery-service/${id}`, { method: "DELETE" });
      loadServices();
    } catch {
      // no-op — row stays visible, admin can retry
    }
  };

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "#0f172a" }}>Print & Delivery</h1>
          <p className="text-sm mt-1" style={{ color: "#5B7285" }}>Per-state print & delivery pricing and stamp denominations</p>
        </div>
        <button onClick={() => setModal({ type: "edit", service: null })} className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>
          New Service
        </button>
      </div>

      <div className="rounded-2xl overflow-hidden" style={{ background: "#fff", border: "1px solid #D8E6F0", boxShadow: "0 8px 24px rgba(30,96,145,0.1)" }}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ background: "#F3F8FB" }}>
                {["State", "Service Charge", "Per Copy", "eSign", "eNotary", "Denominations", "Actions"].map((h) => (
                  <th key={h} className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: "#5B7285" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="text-center py-12 text-sm" style={{ color: "#5B7285" }}>Loading...</td></tr>
              ) : services.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-12 text-sm" style={{ color: "#5B7285" }}>No services configured yet.</td></tr>
              ) : (
                services.map((s) => (
                  <tr key={s.id} className="border-t" style={{ borderColor: "#EEF3F8" }}>
                    <td className="px-5 py-3 text-sm font-semibold" style={{ color: "#1e293b" }}>{s.state_name}</td>
                    <td className="px-5 py-3 text-sm" style={{ color: "#5B7285" }}>{formatCurrency(s.service_charge)}</td>
                    <td className="px-5 py-3 text-sm" style={{ color: "#5B7285" }}>{s.per_copy_price !== null ? formatCurrency(s.per_copy_price) : "-"}</td>
                    <td className="px-5 py-3 text-sm" style={{ color: "#5B7285" }}>{s.esign_price !== null ? formatCurrency(s.esign_price) : "-"}</td>
                    <td className="px-5 py-3 text-sm" style={{ color: "#5B7285" }}>{s.enotary_price !== null ? formatCurrency(s.enotary_price) : "-"}</td>
                    <td className="px-5 py-3 text-sm" style={{ color: "#5B7285" }}>{s.stamp_denominations.map((d) => d.display).join(", ") || "-"}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => setModal({ type: "edit", service: s })} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: "#E6F5EA", color: "#3D7A1F" }}>Edit</button>
                        <button onClick={() => handleDelete(s.id)} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: "#FDECEC", color: "#C0392B" }}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modal?.type === "edit" && (
        <EditModal service={modal.service} states={states} denomCatalog={denomCatalog} onClose={() => setModal(null)} onSaved={() => { setModal(null); loadServices(); }} />
      )}
    </div>
  );
};

export default AdminPrintDeliveryTab;
