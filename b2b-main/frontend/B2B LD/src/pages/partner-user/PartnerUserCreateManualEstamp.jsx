import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest, apiUpload } from "../../lib/api";
import { formatFileSize } from "../../lib/format";
import { theme, serif } from "../../lib/userPortalTheme";
import { isValidEmail, isValidMobile, sanitizeMobileInput } from "../../lib/validation";
import { STAMP_STATES } from "../../lib/stampConstants";
import { GST_RATE, calculateGst } from "../../lib/gst";

const SERVICE_NAME = "Manual eStamp";

const inputClass = "w-full px-4 py-2.5 text-sm rounded outline-none transition-all";
const inputStyle = { background: theme.bg, border: `1px solid ${theme.border}`, color: "#1e293b" };

const Field = ({ label, children }) => (
  <div>
    <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: theme.slate }}>{label}</label>
    {children}
  </div>
);

const SectionLabel = ({ children }) => (
  <h2 className="text-sm font-bold uppercase tracking-wide mb-3" style={{ color: theme.navy, fontFamily: serif }}>{children}</h2>
);

const emptySigner = { name: "", email: "", mobile: "" };
const emptyDeliveryAddress = { full_name: "", mobile: "", address_line1: "", address_line2: "", city: "", state: "", pincode: "" };

const PartnerUserCreateManualEstamp = () => {
  const navigate = useNavigate();

  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerMobile, setCustomerMobile] = useState("");
  const [file, setFile] = useState(null);
  const [stampAmountChoice, setStampAmountChoice] = useState("");
  const [stampAmount, setStampAmount] = useState("");
  const [esignRequired, setEsignRequired] = useState(false);
  const [numSigners, setNumSigners] = useState("1");
  const [signers, setSigners] = useState([{ ...emptySigner }]);
  const [deliveryAddress, setDeliveryAddress] = useState({ ...emptyDeliveryAddress });
  const [partnerCharges, setPartnerCharges] = useState([]);
  const [servicePrice, setServicePrice] = useState(null);
  // Picked per order rather than resolved from the organization's onboarding
  // state (see backend/app/organization_state.py's resolve_stamp_state_code).
  const [states, setStates] = useState([]);
  const [stampStateId, setStampStateId] = useState("");
  const [denominations, setDenominations] = useState([]);
  const [loadingDenominations, setLoadingDenominations] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Charges (Delivery/Documentation/Service Charge, ...) are per-service
  // config set by Super Admin under Manual eStamp's own "Additional Charges"
  // panel — whatever's enabled just applies and shows here, no separate
  // per-order question. See GET /api/partner-user/services/{name}/charges.
  useEffect(() => {
    apiRequest(`/api/partner-user/services/${encodeURIComponent(SERVICE_NAME)}/charges`)
      .then((res) => setPartnerCharges(res.charges || []))
      .catch(() => setPartnerCharges([]));
  }, []);

  // Manual eStamp's own service price — same Services & Pricing config as
  // every other service (eStamp, eKYC, ...), just fetched here directly
  // rather than through the generic Create Order form since this flow has
  // its own dedicated page.
  useEffect(() => {
    apiRequest("/api/partner-user/services")
      .then((res) => {
        const svc = (res.services || []).find((s) => s.service_name === SERVICE_NAME);
        setServicePrice(svc ? svc.price : null);
      })
      .catch(() => setServicePrice(null));
  }, []);

  useEffect(() => {
    apiRequest("/api/catalog/states").then(setStates).catch(() => setStates([]));
  }, []);

  // Real per-state stamp denominations (same master data + endpoint eStamp
  // Bulk uses — see /api/partner-user/stamp-denominations), scoped to
  // whichever state was picked above rather than a hardcoded list.
  useEffect(() => {
    if (!stampStateId) {
      setDenominations([]);
      return;
    }
    setLoadingDenominations(true);
    apiRequest(`/api/partner-user/stamp-denominations?state_id=${stampStateId}`)
      .then(setDenominations)
      .catch(() => setDenominations([]))
      .finally(() => setLoadingDenominations(false));
  }, [stampStateId]);

  const hasDeliveryCharge = partnerCharges.some((c) => c.charge_name === "Delivery Charge");

  // Taxable amount is the Base Price plus per-partner charges (Delivery,
  // Documentation, ...) — never the stamp face value itself (0% GST, same
  // rule invoice_service._stamp_item applies) and never the eSign portion
  // (billed/taxed separately once signing actually completes, not estimated
  // here — see invoice_service._resolve_order_invoice's "Manual eStamp"
  // branch). Flat 18% for every state (see lib/gst.js).
  const taxableTotal = servicePrice != null
    ? Number(servicePrice) + partnerCharges.reduce((sum, c) => sum + (c.price != null ? Number(c.price) : 0), 0)
    : null;
  const gstAmount = taxableTotal != null ? calculateGst(taxableTotal) : 0;

  // Grand total: the stamp paper's own face value (Stamp Denomination) plus
  // the taxable amount plus its GST — null (rather than a partial total)
  // when the service charge itself isn't configured, so the summary keeps
  // flagging that instead of quietly showing an incomplete number.
  const manualEstampTotal = servicePrice != null
    ? (Number(stampAmount) || 0) + taxableTotal + gstAmount
    : null;

  const handleStampAmountChoice = (value) => {
    setStampAmountChoice(value);
    setStampAmount(value === "custom" ? "" : value);
  };

  const handleSignerCountChange = (value) => {
    const count = Math.max(1, parseInt(value, 10) || 1);
    setNumSigners(String(count));
    setSigners((prev) => {
      const next = prev.slice(0, count);
      while (next.length < count) next.push({ ...emptySigner });
      return next;
    });
  };

  const updateSigner = (index, field, value) => {
    setSigners((prev) => prev.map((s, i) => (i === index ? { ...s, [field]: field === "mobile" ? sanitizeMobileInput(value) : value } : s)));
  };

  // Prefills the address' name/mobile from the customer details already
  // entered above the first time the Delivery Address section appears —
  // still editable, since the delivery recipient isn't always the customer
  // of record.
  useEffect(() => {
    if (!hasDeliveryCharge) return;
    setDeliveryAddress((prev) => ({
      ...prev,
      full_name: prev.full_name || customerName,
      mobile: prev.mobile || customerMobile,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasDeliveryCharge]);

  const updateDeliveryAddress = (field, value) => {
    setDeliveryAddress((prev) => ({ ...prev, [field]: field === "mobile" ? sanitizeMobileInput(value) : field === "pincode" ? value.replace(/\D/g, "").slice(0, 6) : value }));
  };

  const validate = () => {
    if (!customerName || !customerEmail || !customerMobile) return "Customer name, email and mobile are required";
    if (!isValidEmail(customerEmail)) return "Please enter a valid customer email address";
    if (!isValidMobile(customerMobile)) return "Customer mobile number must be exactly 10 digits";
    if (!file) return "Please upload a document";
    if (file.type !== "application/pdf") return "Document must be a PDF file";
    if (!stampStateId) return "Please select a stamp state";
    if (!stampAmount) return "Please enter a stamp amount";
    if (!(Number(stampAmount) > 0)) return "Stamp amount must be a positive number";
    if (esignRequired) {
      for (const s of signers) {
        if (!s.name || !s.mobile) return "Every signer needs a name and mobile number";
        // Email itself isn't mandatory — a signer with no email gets the
        // signing invitation via SMS instead (see signdesk_esign.py).
        if (s.email && !isValidEmail(s.email)) return `"${s.email}" is not a valid email address`;
        if (!isValidMobile(s.mobile)) return "Signer mobile numbers must be exactly 10 digits";
      }
    }
    if (hasDeliveryCharge) {
      const a = deliveryAddress;
      if (!a.full_name || !a.mobile || !a.address_line1 || !a.city || !a.state || !a.pincode) {
        return "Delivery address needs full name, mobile, address line 1, city, state and pincode";
      }
      if (!isValidMobile(a.mobile)) return "Delivery mobile number must be exactly 10 digits";
      if (!/^\d{6}$/.test(a.pincode)) return "Delivery pincode must be exactly 6 digits";
    }
    return "";
  };

  const handleSubmit = async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append("customer_name", customerName);
      formData.append("customer_email", customerEmail);
      formData.append("customer_mobile", customerMobile);
      formData.append("document", file);
      formData.append("stamp_state_id", stampStateId);
      formData.append("stamp_amount", stampAmount);
      formData.append("esign_required", String(esignRequired));
      // A blank email must reach the backend as absent, not "" — the
      // backend's ManualEstampSignerIn.email is EmailStr | None, which
      // accepts None but still runs EmailStr's format check against an
      // empty string and rejects it (same fix as PartnerUserCreateOrder.jsx).
      formData.append("esign_signers", JSON.stringify(esignRequired ? signers.map((s) => ({ ...s, email: s.email || null })) : []));
      if (hasDeliveryCharge) {
        formData.append("delivery_address", JSON.stringify({
          ...deliveryAddress,
          state_label: STAMP_STATES.find((s) => s.value === deliveryAddress.state)?.label || deliveryAddress.state,
        }));
      }
      const order = await apiUpload("/api/partner-user/orders/manual-estamp", formData);
      navigate(`/user/orders/manual-estamp/${order.id}`);
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className="mb-6 pb-4 border-b" style={{ borderColor: theme.border }}>
        <h1 className="text-2xl font-bold" style={{ color: theme.ink, fontFamily: serif }}>Create Manual eStamp Order</h1>
        <p className="text-sm mt-1" style={{ color: theme.slate }}>Upload a document to request manual stamp processing.</p>
      </div>

      <div className="rounded-lg p-6 max-w-2xl" style={{ background: theme.card, border: `1px solid ${theme.border}`, boxShadow: "0 1px 2px rgba(15,23,42,0.04)" }}>
        {error && <p className="text-xs font-medium mb-4 px-3 py-2 rounded" style={{ background: theme.dangerSoft, color: theme.danger, border: `1px solid ${theme.danger}33` }}>{error}</p>}

        <SectionLabel>Customer Details</SectionLabel>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Customer Name *">
            <input type="text" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="e.g. Rahul Sharma" className={inputClass} style={inputStyle} />
          </Field>
          <Field label="Customer Email *">
            <input type="email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} placeholder="customer@email.com" className={inputClass} style={inputStyle} />
          </Field>
          <Field label="Customer Mobile *">
            <input type="text" inputMode="numeric" maxLength={10} value={customerMobile} onChange={(e) => setCustomerMobile(sanitizeMobileInput(e.target.value))} placeholder="9876543210" className={inputClass} style={inputStyle} />
          </Field>
        </div>

        <div className="mt-6 pt-5 border-t" style={{ borderColor: theme.border }}>
          <SectionLabel>Document</SectionLabel>
          {!file ? (
            <Field label="Upload Document *">
              <input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} className={inputClass} style={inputStyle} />
              <p className="text-xs mt-1.5" style={{ color: theme.slate }}>PDF only — this is the document that needs to be stamped.</p>
            </Field>
          ) : (
            <div className="flex items-center justify-between p-3 rounded" style={{ background: theme.bg, border: `1px solid ${theme.border}` }}>
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate" style={{ color: theme.ink }}>{file.name}</p>
                <p className="text-xs" style={{ color: theme.slate }}>{formatFileSize(file.size)}</p>
              </div>
              <button type="button" onClick={() => setFile(null)} className="text-xs font-semibold shrink-0 ml-3" style={{ color: theme.danger }}>
                Remove
              </button>
            </div>
          )}
        </div>

        <div className="mt-6 pt-5 border-t" style={{ borderColor: theme.border }}>
          <SectionLabel>Stamp Details</SectionLabel>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Stamp State *">
              <select
                value={stampStateId}
                onChange={(e) => {
                  setStampStateId(e.target.value);
                  setStampAmountChoice("");
                  setStampAmount("");
                }}
                className={inputClass}
                style={inputStyle}
              >
                <option value="">Select state</option>
                {states.map((s) => (<option key={s.id} value={s.id}>{s.state_name}</option>))}
              </select>
            </Field>
            <Field label="Stamp Amount / Denomination *">
              <select
                value={stampAmountChoice}
                onChange={(e) => handleStampAmountChoice(e.target.value)}
                disabled={!stampStateId || loadingDenominations}
                className={inputClass}
                style={inputStyle}
              >
                <option value="">{loadingDenominations ? "Loading..." : "Select amount"}</option>
                {denominations.map((d) => (<option key={d.id} value={d.stamp_value}>₹{d.stamp_value}</option>))}
                <option value="custom">Other (type amount)</option>
              </select>
              {!loadingDenominations && stampStateId && denominations.length === 0 && (
                <p className="text-xs mt-1.5" style={{ color: theme.slate }}>No stamp denominations are configured for this state yet — use "Other" to enter one.</p>
              )}
              {stampAmountChoice === "custom" && (
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={stampAmount}
                  onChange={(e) => setStampAmount(e.target.value)}
                  placeholder="Enter amount"
                  className={`${inputClass} mt-2`}
                  style={inputStyle}
                />
              )}
            </Field>
          </div>
        </div>

        <div className="mt-6 pt-5 border-t" style={{ borderColor: theme.border }}>
          <SectionLabel>eSign Option</SectionLabel>
          <p className="text-sm mb-3" style={{ color: theme.ink }}>Do you require eSign after stamping?</p>
          <div className="flex items-center gap-6 mb-4">
            <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: theme.ink }}>
              <input type="radio" name="esign_required" checked={!esignRequired} onChange={() => setEsignRequired(false)} /> No
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: theme.ink }}>
              <input type="radio" name="esign_required" checked={esignRequired} onChange={() => setEsignRequired(true)} /> Yes
            </label>
          </div>

          {esignRequired && (
            <div className="space-y-3">
              <Field label="Number of Signers *">
                <select value={numSigners} onChange={(e) => handleSignerCountChange(e.target.value)} className={inputClass} style={{ ...inputStyle, maxWidth: 160 }}>
                  {[1, 2, 3, 4, 5].map((n) => (<option key={n} value={n}>{n}</option>))}
                </select>
              </Field>
              {signers.map((signer, index) => (
                <div key={index} className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3 rounded" style={{ background: theme.bg, border: `1px solid ${theme.border}` }}>
                  <Field label={`Signer ${index + 1} Name *`}>
                    <input type="text" value={signer.name} onChange={(e) => updateSigner(index, "name", e.target.value)} placeholder="Full name" className={inputClass} style={{ ...inputStyle, background: "#fff" }} />
                  </Field>
                  <Field label="Email">
                    <input type="email" value={signer.email} onChange={(e) => updateSigner(index, "email", e.target.value)} placeholder="signer@email.com" className={inputClass} style={{ ...inputStyle, background: "#fff" }} />
                  </Field>
                  <Field label="Mobile *">
                    <input type="text" inputMode="numeric" maxLength={10} value={signer.mobile} onChange={(e) => updateSigner(index, "mobile", e.target.value)} placeholder="9876543210" className={inputClass} style={{ ...inputStyle, background: "#fff" }} />
                  </Field>
                </div>
              ))}
            </div>
          )}
        </div>

        {hasDeliveryCharge && (
          <div className="mt-6 pt-5 border-t" style={{ borderColor: theme.border }}>
            <SectionLabel>Delivery Address</SectionLabel>
            <p className="text-xs mb-3" style={{ color: theme.slate }}>Delivery Charge is enabled for your account, so the stamped document will be physically delivered — enter the delivery address below.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Full Name *">
                <input type="text" value={deliveryAddress.full_name} onChange={(e) => updateDeliveryAddress("full_name", e.target.value)} placeholder="Recipient's full name" className={inputClass} style={inputStyle} />
              </Field>
              <Field label="Mobile *">
                <input type="text" inputMode="numeric" maxLength={10} value={deliveryAddress.mobile} onChange={(e) => updateDeliveryAddress("mobile", e.target.value)} placeholder="9876543210" className={inputClass} style={inputStyle} />
              </Field>
              <Field label="Address Line 1 *">
                <input type="text" value={deliveryAddress.address_line1} onChange={(e) => updateDeliveryAddress("address_line1", e.target.value)} placeholder="House/Flat no., Street" className={inputClass} style={inputStyle} />
              </Field>
              <Field label="Address Line 2">
                <input type="text" value={deliveryAddress.address_line2} onChange={(e) => updateDeliveryAddress("address_line2", e.target.value)} placeholder="Landmark, area (optional)" className={inputClass} style={inputStyle} />
              </Field>
              <Field label="City *">
                <input type="text" value={deliveryAddress.city} onChange={(e) => updateDeliveryAddress("city", e.target.value)} placeholder="e.g. Bengaluru" className={inputClass} style={inputStyle} />
              </Field>
              <Field label="State *">
                <select value={deliveryAddress.state} onChange={(e) => updateDeliveryAddress("state", e.target.value)} className={inputClass} style={inputStyle}>
                  <option value="">Select state</option>
                  {STAMP_STATES.map((s) => (<option key={s.value} value={s.value}>{s.label}</option>))}
                </select>
              </Field>
              <Field label="Pincode *">
                <input type="text" inputMode="numeric" maxLength={6} value={deliveryAddress.pincode} onChange={(e) => updateDeliveryAddress("pincode", e.target.value)} placeholder="560001" className={inputClass} style={inputStyle} />
              </Field>
            </div>
          </div>
        )}

        <div className="mt-6 pt-5 border-t" style={{ borderColor: theme.border }}>
          <SectionLabel>Order Summary</SectionLabel>
          <div className="rounded p-4 space-y-2 text-sm" style={{ background: theme.bg, border: `1px solid ${theme.border}` }}>
            <div className="flex justify-between"><span style={{ color: theme.slate }}>Stamp Denomination</span><span className="font-semibold" style={{ color: theme.ink }}>{stampAmount ? `₹${stampAmount}` : "-"}</span></div>
            <div className="flex justify-between">
              <span style={{ color: theme.slate }}>Manual eStamp's Base Price (excluding GST)</span>
              <span className="font-semibold" style={{ color: theme.ink }}>
                {servicePrice != null ? `₹${servicePrice}` : "Not configured for your account"}
              </span>
            </div>
            {esignRequired && (
              <div className="flex justify-between"><span style={{ color: theme.slate }}>Number of Signers</span><span className="font-semibold" style={{ color: theme.ink }}>{numSigners}</span></div>
            )}
            {partnerCharges.map((c) => (
              <div key={c.charge_name} className="flex justify-between"><span style={{ color: theme.slate }}>{c.charge_name}</span><span className="font-semibold" style={{ color: theme.ink }}>{c.price != null ? `₹${c.price}` : "-"}</span></div>
            ))}
            {servicePrice != null && (
              <div className="flex justify-between"><span style={{ color: theme.slate }}>GST ({GST_RATE}%)</span><span className="font-semibold" style={{ color: theme.ink }}>₹{gstAmount.toFixed(2)}</span></div>
            )}
            <div className="flex justify-between pt-2 border-t" style={{ borderColor: theme.border }}>
              <span style={{ color: theme.slate }}>Price</span>
              <span className="font-semibold" style={{ color: theme.navy }}>
                {manualEstampTotal != null ? `₹${manualEstampTotal}` : "Not configured for your account"}
              </span>
            </div>
          </div>
        </div>

        <div className="mt-6 pt-5 border-t flex justify-end gap-2" style={{ borderColor: theme.border }}>
          <button onClick={() => navigate("/user/orders")} className="px-5 py-2.5 rounded text-sm font-semibold" style={{ background: "#fff", color: theme.ink, border: `1px solid ${theme.border}` }}>
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={submitting} className="px-6 py-2.5 rounded text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60" style={{ background: theme.navy }}>
            {submitting ? "Submitting..." : "Submit Request"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PartnerUserCreateManualEstamp;
