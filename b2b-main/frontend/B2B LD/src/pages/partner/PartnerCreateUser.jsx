import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest } from "../../lib/api";
import { isValidMobile, sanitizeMobileInput } from "../../lib/validation";

const inputClass = "w-full px-4 py-2.5 text-sm rounded-xl outline-none transition-all disabled:cursor-not-allowed";
const inputStyle = { background: "#F3F8FB", border: "1px solid #D8E6F0", color: "#1e293b" };

const Field = ({ label, children }) => (
  <div>
    <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#5B7285" }}>{label}</label>
    {children}
  </div>
);

const emptyForm = { full_name: "", email: "", mobile: "", is_active: true };

const PartnerCreateUser = () => {
  const navigate = useNavigate();
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    const nextValue = name === "mobile" ? sanitizeMobileInput(value) : type === "checkbox" ? checked : value;
    setForm({ ...form, [name]: nextValue });
  };

  const handleSave = async () => {
    if (!form.full_name || !form.email || !form.mobile) {
      setError("Full name, email and mobile number are required");
      return;
    }
    if (!isValidMobile(form.mobile)) {
      setError("Mobile number must be exactly 10 digits");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await apiRequest("/api/partner/users", {
        method: "POST",
        body: JSON.stringify(form),
      });
      navigate("/partner/users");
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: "#0f172a" }}>Create User</h1>
        <p className="text-sm mt-1" style={{ color: "#5B7285" }}>Add a new user who will serve customers and create documents</p>
      </div>

      <div className="rounded-2xl p-6 max-w-2xl" style={{ background: "#fff", border: "1px solid #D8E6F0", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        {error && (
          <p className="text-xs font-medium mb-4 px-3 py-2 rounded-lg" style={{ background: "#E8F3FB", color: "#1E6091" }}>{error}</p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Full Name *">
            <input
              type="text"
              name="full_name"
              value={form.full_name}
              onChange={handleChange}
              placeholder="e.g. Rahul Sharma"
              className={inputClass}
              style={inputStyle}
            />
          </Field>
          <Field label="Email *">
            <input
              type="email"
              name="email"
              value={form.email}
              onChange={handleChange}
              placeholder="user@company.com"
              className={inputClass}
              style={inputStyle}
            />
          </Field>
          <Field label="Mobile Number *">
            <input
              type="text"
              inputMode="numeric"
              maxLength={10}
              name="mobile"
              value={form.mobile}
              onChange={handleChange}
              placeholder="9876543210"
              className={inputClass}
              style={inputStyle}
            />
          </Field>
          <Field label="Status">
            <label className="flex items-center gap-3 py-2 cursor-pointer">
              <div className="relative" onClick={() => setForm({ ...form, is_active: !form.is_active })}>
                <div className="w-11 h-6 rounded-full transition-colors" style={{ background: form.is_active ? "#1E6091" : "#D8E6F0" }}></div>
                <div className="absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all" style={{ left: form.is_active ? "24px" : "4px" }}></div>
              </div>
              <span className="text-sm font-medium" style={{ color: form.is_active ? "#1E6091" : "#5B7285" }}>{form.is_active ? "Active" : "Inactive"}</span>
            </label>
          </Field>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={() => navigate("/partner/users")} className="px-5 py-2.5 rounded-xl text-sm font-semibold" style={{ background: "#E2EBF4", color: "#334155" }}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving} className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>
            {saving ? "Saving..." : "Save User"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PartnerCreateUser;

