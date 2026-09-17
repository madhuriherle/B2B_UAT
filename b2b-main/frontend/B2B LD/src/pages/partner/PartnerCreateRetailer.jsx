import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest } from "../../lib/api";
import { isValidMobile, sanitizeMobileInput } from "../../lib/validation";

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

const emptyForm = {
  organization_name: "", retailer_category: "", payment_mode: "Wallet",
  contact_person: "", email: "", mobile: "", state_id: "", gst_number: "",
  address_line1: "", address_line2: "", city: "", pincode: "",
};

const PartnerCreateRetailer = () => {
  const navigate = useNavigate();
  const [form, setForm] = useState(emptyForm);
  const [states, setStates] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    apiRequest("/api/catalog/states").then(setStates).catch(() => setStates([]));
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    const nextValue =
      name === "mobile" ? sanitizeMobileInput(value)
      : name === "pincode" ? value.replace(/\D/g, "").slice(0, 6)
      : value;
    setForm({ ...form, [name]: nextValue });
  };

  const handleSave = async () => {
    if (!form.organization_name || !form.email || !form.retailer_category) {
      setError("Retailer name, email and category are required");
      return;
    }
    if (form.mobile && !isValidMobile(form.mobile)) {
      setError("Mobile number must be exactly 10 digits");
      return;
    }
    if (form.pincode && !/^\d{6}$/.test(form.pincode)) {
      setError("Pincode must be exactly 6 digits");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await apiRequest("/api/partner/retailers", {
        method: "POST",
        body: JSON.stringify({ ...form, state_id: form.state_id || null }),
      });
      setSuccess(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleCreateAnother = () => {
    setForm(emptyForm);
    setSuccess(false);
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: "#0f172a" }}>Add Retailer</h1>
        <p className="text-sm mt-1" style={{ color: "#5B7285" }}>Onboard a new retailer under your dealership</p>
      </div>

      <div className="rounded-2xl p-6 max-w-2xl" style={{ background: "#fff", border: "1px solid #D8E6F0", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        {success && (
          <p className="text-sm font-medium mb-5 px-4 py-3 rounded-xl" style={{ background: "#E6F5EA", color: "#3D7A1F" }}>
            Retailer created successfully.
          </p>
        )}
        {error && (
          <p className="text-xs font-medium mb-4 px-3 py-2 rounded-lg" style={{ background: "#E8F3FB", color: "#1E6091" }}>{error}</p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Retailer Name *">
            <input type="text" name="organization_name" value={form.organization_name} onChange={handleChange} disabled={success} placeholder="e.g. XYZ Enterprises" className={inputClass} style={success ? disabledStyle : inputStyle} />
          </Field>
          <Field label="Retailer Category *">
            <select name="retailer_category" value={form.retailer_category} onChange={handleChange} disabled={success} className={inputClass} style={success ? disabledStyle : inputStyle}>
              <option value="">Select category</option>
              {RETAILER_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="Contact Person">
            <input type="text" name="contact_person" value={form.contact_person} onChange={handleChange} disabled={success} placeholder="Full name" className={inputClass} style={success ? disabledStyle : inputStyle} />
          </Field>
          <Field label="Email *">
            <input type="email" name="email" value={form.email} onChange={handleChange} disabled={success} placeholder="contact@retailer.com" className={inputClass} style={success ? disabledStyle : inputStyle} />
          </Field>
          <Field label="Mobile">
            <input type="text" inputMode="numeric" maxLength={10} name="mobile" value={form.mobile} onChange={handleChange} disabled={success} placeholder="9876543210" className={inputClass} style={success ? disabledStyle : inputStyle} />
          </Field>
          <Field label="State">
            <select name="state_id" value={form.state_id} onChange={handleChange} disabled={success} className={inputClass} style={success ? disabledStyle : inputStyle}>
              <option value="">Select state</option>
              {states.map((s) => (
                <option key={s.id} value={s.id}>{s.state_name}</option>
              ))}
            </select>
          </Field>
          <Field label="GST Number">
            <input type="text" name="gst_number" value={form.gst_number} onChange={handleChange} disabled={success} placeholder="22AAAAA0000A1Z5" className={inputClass} style={success ? disabledStyle : inputStyle} />
          </Field>
          <div className="md:col-span-2">
            <Field label="Payment Configuration *">
              <div className="flex items-center gap-6 py-2">
                {PAYMENT_MODES.map((opt) => (
                  <label key={opt.value} className="flex items-center gap-2 cursor-pointer text-sm font-medium" style={{ color: form.payment_mode === opt.value ? "#1E6091" : "#5B7285" }}>
                    <input type="radio" name="payment_mode" value={opt.value} checked={form.payment_mode === opt.value} onChange={handleChange} disabled={success} className="accent-[#1E6091]" />
                    {opt.label}
                  </label>
                ))}
              </div>
            </Field>
          </div>
          <Field label="Address Line 1">
            <input type="text" name="address_line1" value={form.address_line1} onChange={handleChange} disabled={success} placeholder="Building, street" className={inputClass} style={success ? disabledStyle : inputStyle} />
          </Field>
          <Field label="Address Line 2">
            <input type="text" name="address_line2" value={form.address_line2} onChange={handleChange} disabled={success} placeholder="Area, landmark (optional)" className={inputClass} style={success ? disabledStyle : inputStyle} />
          </Field>
          <Field label="City">
            <input type="text" name="city" value={form.city} onChange={handleChange} disabled={success} placeholder="e.g. Bengaluru" className={inputClass} style={success ? disabledStyle : inputStyle} />
          </Field>
          <Field label="Pincode">
            <input type="text" inputMode="numeric" maxLength={6} name="pincode" value={form.pincode} onChange={handleChange} disabled={success} placeholder="560001" className={inputClass} style={success ? disabledStyle : inputStyle} />
          </Field>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          {success ? (
            <>
              <button onClick={() => navigate("/partner/retailers")} className="px-5 py-2.5 rounded-xl text-sm font-semibold" style={{ background: "#E2EBF4", color: "#334155" }}>
                Go to My Retailers
              </button>
              <button onClick={handleCreateAnother} className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>
                Add Another Retailer
              </button>
            </>
          ) : (
            <>
              <button onClick={() => navigate("/partner/retailers")} className="px-5 py-2.5 rounded-xl text-sm font-semibold" style={{ background: "#E2EBF4", color: "#334155" }}>
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving} className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>
                {saving ? "Saving..." : "Save Retailer"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default PartnerCreateRetailer;
