import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest } from "../lib/api";
import { isValidMobile, sanitizeMobileInput } from "../lib/validation";
import { useAuth } from "../lib/AuthContext";
import { portalBase } from "../lib/roleHome";
import SuccessModal from "../components/SuccessModal";

const inputClass = "w-full px-4 py-2.5 text-sm rounded-xl outline-none transition-all disabled:cursor-not-allowed";
const inputStyle = { background: "#F3F8FB", border: "1px solid #D8E6F0", color: "#1e293b" };
const disabledStyle = { background: "#E2EBF4", border: "1px solid #D8E6F0", color: "#5B7285" };

const VENDOR_TYPES = ["Internal Team", "Third-Party Vendor"];
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

const Pill = ({ label, checked, onChange }) => (
  <label className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer text-sm font-medium" style={{ background: checked ? "#E6F5EA" : "#fff", border: `1px solid ${checked ? "#16A34A" : "#D8E6F0"}`, color: checked ? "#3D7A1F" : "#5B7285" }}>
    <input type="checkbox" checked={checked} onChange={onChange} className="accent-[#16A34A]" />
    {label}
  </label>
);

const emptyVendorData = {
  vendorName: "", vendorType: "", contactPerson: "", email: "", mobile: "",
  gstNumber: "", address: "", city: "", state: "", paymentMode: "Wallet", status: true,
};

const VendorOnboard = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const base = portalBase(user);
  const [vendorData, setVendorData] = useState(emptyVendorData);
  const [vendorSaved, setVendorSaved] = useState(false);
  const [savedVendorId, setSavedVendorId] = useState(null);
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(false);
  const [states, setStates] = useState([]);
  const [showSuccess, setShowSuccess] = useState(false);

  const [step, setStep] = useState(1);
  const [assignedStates, setAssignedStates] = useState([]);
  const [coverageLoaded, setCoverageLoaded] = useState(false);
  const [savingCoverage, setSavingCoverage] = useState(false);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    apiRequest("/api/catalog/states")
      .then((data) => setStates(data.map((s) => ({ id: s.id, state_name: s.state_name }))))
      .catch(() => setStates([]));
  }, []);

  useEffect(() => {
    if (step !== 2 || coverageLoaded || !savedVendorId) return;
    apiRequest(`/api/vendors/${savedVendorId}/states`)
      .then((statesRes) => {
        setAssignedStates(statesRes.states);
        setCoverageLoaded(true);
      })
      .catch((err) => showToast(err.message, "error"));
  }, [step, coverageLoaded, savedVendorId]);

  const handleVendorChange = (e) => {
    const { name, value, type, checked } = e.target;
    const nextValue = name === "mobile" ? sanitizeMobileInput(value) : type === "checkbox" ? checked : value;
    setVendorData({ ...vendorData, [name]: nextValue });
  };

  const handleSaveVendor = async () => {
    if (!vendorData.vendorName || !vendorData.email || !vendorData.vendorType) {
      showToast("Please fill required fields", "error");
      return;
    }
    if (vendorData.mobile && !isValidMobile(vendorData.mobile)) {
      showToast("Mobile number must be exactly 10 digits", "error");
      return;
    }
    setLoading(true);
    try {
      const result = await apiRequest("/api/vendors", {
        method: "POST",
        body: JSON.stringify({
          vendor_name: vendorData.vendorName,
          vendor_type: vendorData.vendorType,
          contact_person: vendorData.contactPerson || null,
          email: vendorData.email,
          mobile: vendorData.mobile || null,
          gst_number: vendorData.gstNumber || null,
          address: vendorData.address || null,
          city: vendorData.city || null,
          state_id: vendorData.state || null,
          payment_mode: vendorData.paymentMode,
          is_active: vendorData.status,
        }),
      });
      setSavedVendorId(result.id);
      setVendorSaved(true);
      setStep(2);
      setShowSuccess(true);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const toggleState = (stateId) => {
    setAssignedStates((prev) =>
      prev.map((s) => (s.state_id === stateId ? { ...s, is_active: !s.is_active } : s))
    );
  };

  const handleSaveCoverage = async () => {
    setSavingCoverage(true);
    try {
      const statesRes = await apiRequest(`/api/vendors/${savedVendorId}/states`, {
        method: "PUT",
        body: JSON.stringify({ states: assignedStates.map((s) => ({ state_id: s.state_id, is_active: s.is_active })) }),
      });
      setAssignedStates(statesRes.states);
      showToast("Assigned states saved.");
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setSavingCoverage(false);
    }
  };

  const handleNewVendor = () => {
    setVendorData(emptyVendorData);
    setVendorSaved(false);
    setSavedVendorId(null);
    setStep(1);
    setAssignedStates([]);
    setCoverageLoaded(false);
  };

  return (
    <div>
      {toast && (
        <div className="fixed top-5 right-5 z-50 px-5 py-3 rounded-xl text-sm font-semibold shadow-lg text-white transition-all" style={{ background: toast.type === "error" ? "#176B87" : "#16A34A" }}>
          {toast.msg}
        </div>
      )}

      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "#0f172a" }}>Vendor Onboard</h1>
          <p className="text-sm mt-1" style={{ color: "#5B7285" }}>Register a new operational vendor and their coverage</p>
        </div>
        {vendorSaved && (
          <button onClick={handleNewVendor} className="px-4 py-2 rounded-xl text-sm font-semibold" style={{ background: "#E2EBF4", color: "#334155" }}>
            New Vendor
          </button>
        )}
      </div>

      <div className="flex items-center gap-3 mb-6">
        <div className="flex items-center gap-2">
          <span className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: "#1E6091" }}>1</span>
          <span className="text-sm font-semibold" style={{ color: "#1E6091" }}>Vendor Details</span>
        </div>
        <div className="flex-1 h-0.5 rounded-full max-w-16" style={{ background: vendorSaved ? "#1E6091" : "#D8E6F0" }}></div>
        <div className="flex items-center gap-2">
          <span className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: vendorSaved ? "#1E6091" : "#E2EBF4", color: vendorSaved ? "#fff" : "#5B7285" }}>2</span>
          <span className="text-sm font-semibold" style={{ color: vendorSaved ? "#1E6091" : "#5B7285" }}>Assigned States</span>
        </div>
      </div>

      <div className="rounded-2xl p-6 mb-6" style={{ background: "#fff", border: "1px solid #D8E6F0", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        <div className="flex justify-between items-center mb-5">
          <div>
            <h2 className="text-base font-bold" style={{ color: "#0f172a" }}>Vendor Details</h2>
            <p className="text-xs mt-0.5" style={{ color: "#5B7285" }}>Primary vendor information</p>
          </div>
          {vendorSaved && (
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold" style={{ background: "#E6F5EA", color: "#3D7A1F" }}>
              Saved
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Vendor Name *">
            <input type="text" name="vendorName" value={vendorData.vendorName} onChange={handleVendorChange} disabled={vendorSaved} placeholder="e.g. Metro Print & Delivery Co." className={inputClass} style={vendorSaved ? disabledStyle : inputStyle} />
          </Field>
          <Field label="Vendor Type *">
            <select name="vendorType" value={vendorData.vendorType} onChange={handleVendorChange} disabled={vendorSaved} className={inputClass} style={vendorSaved ? disabledStyle : inputStyle}>
              <option value="">Select type</option>
              {VENDOR_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="Contact Person">
            <input type="text" name="contactPerson" value={vendorData.contactPerson} onChange={handleVendorChange} disabled={vendorSaved} placeholder="Full name" className={inputClass} style={vendorSaved ? disabledStyle : inputStyle} />
          </Field>
          <Field label="Email Address *">
            <input type="email" name="email" value={vendorData.email} onChange={handleVendorChange} disabled={vendorSaved} placeholder="contact@vendor.com" className={inputClass} style={vendorSaved ? disabledStyle : inputStyle} />
          </Field>
          <Field label="Mobile Number">
            <input type="text" inputMode="numeric" maxLength={10} name="mobile" value={vendorData.mobile} onChange={handleVendorChange} disabled={vendorSaved} placeholder="9876543210" className={inputClass} style={vendorSaved ? disabledStyle : inputStyle} />
          </Field>
          <Field label="GST Number">
            <input type="text" name="gstNumber" value={vendorData.gstNumber} onChange={handleVendorChange} disabled={vendorSaved} placeholder="22AAAAA0000A1Z5 (optional)" className={inputClass} style={vendorSaved ? disabledStyle : inputStyle} />
          </Field>
          <Field label="City">
            <input type="text" name="city" value={vendorData.city} onChange={handleVendorChange} disabled={vendorSaved} className={inputClass} style={vendorSaved ? disabledStyle : inputStyle} />
          </Field>
          <Field label="State">
            <select name="state" value={vendorData.state} onChange={handleVendorChange} disabled={vendorSaved} className={inputClass} style={vendorSaved ? disabledStyle : inputStyle}>
              <option value="">Select state</option>
              {states.map((s) => (
                <option key={s.id} value={s.id}>{s.state_name}</option>
              ))}
            </select>
          </Field>
          <Field label="Active Status">
            <label className="flex items-center gap-3 py-2 cursor-pointer">
              <div className="relative" onClick={() => !vendorSaved && setVendorData({ ...vendorData, status: !vendorData.status })}>
                <div className="w-11 h-6 rounded-full transition-colors" style={{ background: vendorData.status ? "#1E6091" : "#D8E6F0" }}></div>
                <div className="absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all" style={{ left: vendorData.status ? "24px" : "4px" }}></div>
              </div>
              <span className="text-sm font-medium" style={{ color: vendorData.status ? "#1E6091" : "#5B7285" }}>{vendorData.status ? "Active" : "Inactive"}</span>
            </label>
          </Field>
          <div className="md:col-span-2">
            <Field label="Payment Configuration *">
              <div className="flex items-center gap-6 py-2">
                {PAYMENT_MODES.map((opt) => (
                  <label key={opt.value} className="flex items-center gap-2 cursor-pointer text-sm font-medium" style={{ color: vendorData.paymentMode === opt.value ? "#1E6091" : "#5B7285" }}>
                    <input
                      type="radio"
                      name="paymentMode"
                      value={opt.value}
                      checked={vendorData.paymentMode === opt.value}
                      onChange={handleVendorChange}
                      disabled={vendorSaved}
                      className="accent-[#1E6091]"
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </Field>
          </div>
          <div className="md:col-span-2">
            <Field label="Address">
              <textarea name="address" value={vendorData.address} onChange={handleVendorChange} disabled={vendorSaved} placeholder="Full registered address" rows={2} className={inputClass} style={{ ...(vendorSaved ? disabledStyle : inputStyle), resize: "none" }} />
            </Field>
          </div>
        </div>

        {!vendorSaved && (
          <div className="mt-5 flex justify-end">
            <button onClick={handleSaveVendor} disabled={loading} className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>
              {loading ? "Saving..." : "Save Vendor"}
            </button>
          </div>
        )}
      </div>

      {step === 2 && (
        <div className="rounded-2xl p-6" style={{ background: "#fff", border: "1px solid #D8E6F0", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div className="flex justify-between items-center mb-5">
            <div>
              <h2 className="text-base font-bold" style={{ color: "#0f172a" }}>Assigned States</h2>
              <p className="text-xs mt-0.5" style={{ color: "#5B7285" }}>Assign the states this vendor serves</p>
            </div>
            <button onClick={() => navigate(`${base}/vendor-list`)} className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>
              Create Vendor
            </button>
          </div>

          {!coverageLoaded ? (
            <p className="text-sm" style={{ color: "#5B7285" }}>Loading...</p>
          ) : (
            <>
              <div className="mb-6">
                <div className="flex flex-wrap gap-2">
                  {assignedStates.map((s) => (
                    <Pill key={s.state_id} label={s.state_name} checked={s.is_active} onChange={() => toggleState(s.state_id)} />
                  ))}
                </div>
              </div>

              <div className="flex justify-end">
                <button onClick={handleSaveCoverage} disabled={savingCoverage} className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>
                  {savingCoverage ? "Saving..." : "Save Coverage"}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {showSuccess && (
        <SuccessModal
          title="Vendor Saved Successfully"
          message="Now assign states below."
          onOk={() => setShowSuccess(false)}
        />
      )}
    </div>
  );
};

export default VendorOnboard;
