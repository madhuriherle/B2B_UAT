import { useEffect, useState } from "react";
import { apiRequest } from "../lib/api";
import Modal from "./Modal";

const inputClass = "w-full px-4 py-2.5 text-sm rounded-xl outline-none transition-all disabled:cursor-not-allowed";
const inputStyle = { background: "#F3F8FB", border: "1px solid #D8E6F0", color: "#1e293b" };

const Field = ({ label, children }) => (
  <div>
    <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#5B7285" }}>{label}</label>
    {children}
  </div>
);

// Reused from both VendorList.jsx ("Assign Orders" action) and
// VendorProfile.jsx's Orders tab — same admin-wide order picker either way.
const AssignOrderModal = ({ vendor, onClose, onAssigned }) => {
  const [orders, setOrders] = useState([]);
  const [states, setStates] = useState([]);
  const [services, setServices] = useState([]);
  const [orderId, setOrderId] = useState("");
  const [stateId, setStateId] = useState("");
  const [serviceName, setServiceName] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    apiRequest("/api/reports/orders").then(setOrders).catch(() => setOrders([]));
    apiRequest("/api/catalog/states").then(setStates).catch(() => setStates([]));
    // The real service master (same list Manage Services/Edit Partner use) —
    // this dropdown used to be a hardcoded set of made-up placeholder names
    // (Print & Delivery, Document Verification, ...) unrelated to any real
    // service ever configured on this platform.
    apiRequest("/api/services").then((rows) => setServices(rows.filter((s) => s.status))).catch(() => setServices([]));
  }, []);

  const handleSubmit = async () => {
    if (!orderId) {
      setError("Select an order to assign");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await apiRequest(`/api/vendors/${vendor.id}/order-assignments`, {
        method: "POST",
        body: JSON.stringify({
          order_id: orderId,
          state_id: stateId || null,
          service_name: serviceName || null,
          notes: notes || null,
        }),
      });
      onAssigned();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Assign Order" subtitle={vendor.vendor_name} onClose={onClose}>
      {error && <p className="text-xs font-medium mb-3 px-3 py-2 rounded-lg" style={{ background: "#E8F3FB", color: "#1E6091" }}>{error}</p>}
      <div className="grid grid-cols-1 gap-4">
        <Field label="Order *">
          <select value={orderId} onChange={(e) => setOrderId(e.target.value)} className={inputClass} style={inputStyle}>
            <option value="">Select an order</option>
            {orders.map((o) => (
              <option key={o.id} value={o.id}>
                {o.order_no} — {o.customer_name || "Unknown"} ({o.partner_name})
              </option>
            ))}
          </select>
        </Field>
        <Field label="State">
          <select value={stateId} onChange={(e) => setStateId(e.target.value)} className={inputClass} style={inputStyle}>
            <option value="">Select state</option>
            {states.map((s) => (
              <option key={s.id} value={s.id}>{s.state_name}</option>
            ))}
          </select>
        </Field>
        <Field label="Service">
          <select value={serviceName} onChange={(e) => setServiceName(e.target.value)} className={inputClass} style={inputStyle}>
            <option value="">Select service</option>
            {services.map((s) => (
              <option key={s.id} value={s.service_name}>{s.service_name}</option>
            ))}
          </select>
        </Field>
        <Field label="Notes">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Optional note" className={inputClass} style={{ ...inputStyle, resize: "none" }} />
        </Field>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="px-5 py-2.5 rounded-xl text-sm font-semibold" style={{ background: "#E2EBF4", color: "#334155" }}>Cancel</button>
        <button onClick={handleSubmit} disabled={saving} className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>
          {saving ? "Assigning..." : "Assign Order"}
        </button>
      </div>
    </Modal>
  );
};

export default AssignOrderModal;
