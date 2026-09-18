import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { apiRequest, apiUpload, downloadFile } from "../../lib/api";
import { formatCurrency } from "../../lib/format";
import { isValidEmail, isValidMobile, sanitizeMobileInput } from "../../lib/validation";
import { theme, serif, inputStyle as baseInputStyle } from "../../lib/userPortalTheme";
import { renderableEkycFields } from "../../lib/ekycFields";
import { GST_RATE, calculateGst } from "../../lib/gst";
import {
  DOCUMENT_CATEGORIES,
  ID_TYPES_BY_ENTITY,
  PARTY_ENTITY_TYPES,
  STAMP_STATES,
} from "../../lib/stampConstants";
import { ARTICLE_OPTIONS_BY_STATE, SHCIL_OTF_STATES } from "../../lib/karnatakaArticleCodes";
import KarnatakaArticleCodePicker from "../../components/KarnatakaArticleCodePicker";
import { MAHARASHTRA_DISTRICTS, MAHARASHTRA_DISTRICT_NAMES, PROPERTY_AREA_UNITS } from "../../lib/maharashtraEsbtrDistricts";
import LoanDocumentFlow from "./LoanDocumentFlow";

const inputClass = "w-full px-4 py-2.5 text-sm rounded outline-none transition-all disabled:cursor-not-allowed";
const inputStyle = baseInputStyle;

// Services this component actually has field handling for (see
// isEsign/isEkyc/isEStamp/isDocumentService below). "eStamp Bulk" and
// "Manual eStamp" are real, supported services too, but each has its own
// dedicated page (PartnerUserCreateEstampBulk / PartnerUserCreateManualEstamp
// — see Sidebar.jsx's HANDLED_ORDER_SERVICE_NAMES) rather than living here.
// Anything else is a service Super Admin added to the master catalog that
// nobody has built order collection for yet — it must never fall through to
// the bare generic form below, since that form can't actually collect what
// an arbitrary new service needs.
const LOCALLY_HANDLED_SERVICES = new Set(["eSign", "eKYC", "eStamp", "eStamp On The Fly", "Document Service"]);

// Precomputed once — passed as SuggestInput's fixed `options` list for the
// Document Category field (415 entries, searched by substring as you type).
const DOCUMENT_CATEGORY_LABELS = DOCUMENT_CATEGORIES.map((d) => d.label);

const Field = ({ label, error, children }) => (
  <div>
    {error && <p className="text-xs font-medium mb-1" style={{ color: theme.danger }}>{error}</p>}
    <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: theme.slate }}>{label}</label>
    {children}
  </div>
);

const ORDINAL_SUFFIXES = { 1: "st", 2: "nd", 3: "rd" };
const ordinal = (n) => `${n}${ORDINAL_SUFFIXES[n] || "th"}`;

const SectionLabel = ({ children }) => (
  <h2 className="text-sm font-bold uppercase tracking-wide mb-3" style={{ color: theme.navy, fontFamily: serif }}>{children}</h2>
);

// Per-field "type it once, click it next time" suggestion history for the
// eStamp form — built into the app rather than relying on the browser's own
// autofill dropdown (which depends on browser/profile settings the app
// doesn't control), so it behaves the same everywhere and only ever
// remembers what's actually been typed into these exact fields. Keyed by
// the input's `name`; capped per field so it doesn't grow unbounded.
const FIELD_SUGGESTIONS_KEY = "legaldesk_estamp_field_suggestions";
const MAX_SUGGESTIONS_PER_FIELD = 8;

const loadFieldSuggestions = () => {
  try {
    return JSON.parse(localStorage.getItem(FIELD_SUGGESTIONS_KEY) || "{}");
  } catch {
    return {};
  }
};

const rememberFieldValue = (name, value) => {
  if (!name || !value) return;
  const all = loadFieldSuggestions();
  const existing = (all[name] || []).filter((v) => v !== value);
  all[name] = [value, ...existing].slice(0, MAX_SUGGESTIONS_PER_FIELD);
  try {
    localStorage.setItem(FIELD_SUGGESTIONS_KEY, JSON.stringify(all));
  } catch {
    // Storage full/unavailable — this is a convenience feature only.
  }
};

// A plain <input> plus a dropdown of matching suggestions — click one
// instead of retyping. With no `options` prop, the dropdown is this field's
// own typed history (see rememberFieldValue, saved on blur/selection); pass
// `options` (a fixed string list, e.g. document categories) and
// `remember={false}` to search a known list instead without polluting the
// per-field history.
const SuggestInput = ({ name, value, onChange, options, remember = true, ...inputProps }) => {
  const [focused, setFocused] = useState(false);
  const pool = options || loadFieldSuggestions()[name] || [];
  const text = String(value ?? "");
  const suggestions = focused
    ? pool.filter((s) => s !== text && (!text || s.toLowerCase().includes(text.toLowerCase()))).slice(0, 20)
    : [];

  const commit = (v) => {
    onChange(v);
    if (remember) rememberFieldValue(name, v);
    setFocused(false);
  };

  return (
    <div className="relative">
      <input
        {...inputProps}
        name={name}
        value={value}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          if (remember) rememberFieldValue(name, value);
          // Delay so a click on a suggestion (onMouseDown below) registers before the list unmounts.
          setTimeout(() => setFocused(false), 150);
        }}
      />
      {suggestions.length > 0 && (
        <ul
          className="absolute left-0 right-0 mt-1 rounded shadow-lg max-h-48 overflow-auto text-sm"
          style={{ background: "#fff", border: `1px solid ${theme.border}`, zIndex: 20 }}
        >
          {suggestions.map((s) => (
            <li
              key={s}
              className="px-3 py-2 cursor-pointer hover:bg-gray-100"
              style={{ color: theme.ink }}
              onMouseDown={(e) => {
                e.preventDefault();
                commit(s);
              }}
            >
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

// One "party" block (First Party / Second Party) in the eStamp form —
// name/entity type/ID type/ID number/phone plus a nested address, matching
// SignDesk's first_party_*/second_party_* request fields.
const PartyFields = ({ label, namePrefix, party, onChange, onAddressChange }) => {
  const idTypeOptions = ID_TYPES_BY_ENTITY[party.entity_type] || [];
  return (
    <div className="p-3 rounded space-y-3" style={{ background: theme.bg, border: `1px solid ${theme.border}` }}>
      <p className="text-xs font-semibold uppercase" style={{ color: theme.slate }}>{label}</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Name *">
          <SuggestInput type="text" name={`${namePrefix}_name`} value={party.name} onChange={(v) => onChange("name", v)} placeholder="Full name" className={inputClass} style={{ ...inputStyle, background: "#fff" }} />
        </Field>
        <Field label="Phone">
          <SuggestInput type="text" name={`${namePrefix}_phone`} inputMode="numeric" maxLength={10} value={party.phone} onChange={(v) => onChange("phone", sanitizeMobileInput(v))} placeholder="9876543210" className={inputClass} style={{ ...inputStyle, background: "#fff" }} />
        </Field>
        <Field label="Entity Type *">
          <select value={party.entity_type} onChange={(e) => onChange("entity_type", e.target.value)} className={inputClass} style={{ ...inputStyle, background: "#fff" }}>
            {PARTY_ENTITY_TYPES.map((t) => (<option key={t} value={t}>{t}</option>))}
          </select>
        </Field>
        <Field label="ID Type *">
          <select value={party.id_type} onChange={(e) => onChange("id_type", e.target.value)} className={inputClass} style={{ ...inputStyle, background: "#fff" }}>
            <option value="">Select ID type</option>
            {idTypeOptions.map((t) => (<option key={t.value} value={t.value}>{t.label}</option>))}
          </select>
        </Field>
        <Field label="ID Number *">
          <SuggestInput type="text" name={`${namePrefix}_id_number`} value={party.id_number} onChange={(v) => onChange("id_number", v)} className={inputClass} style={{ ...inputStyle, background: "#fff" }} />
        </Field>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Street Address *">
          <SuggestInput type="text" name={`${namePrefix}_street_address`} value={party.address.street_address} onChange={(v) => onAddressChange("street_address", v)} className={inputClass} style={{ ...inputStyle, background: "#fff" }} />
        </Field>
        <Field label="Locality">
          <SuggestInput type="text" name={`${namePrefix}_locality`} value={party.address.locality} onChange={(v) => onAddressChange("locality", v)} className={inputClass} style={{ ...inputStyle, background: "#fff" }} />
        </Field>
        <Field label="City *">
          <SuggestInput type="text" name={`${namePrefix}_city`} value={party.address.city} onChange={(v) => onAddressChange("city", v)} className={inputClass} style={{ ...inputStyle, background: "#fff" }} />
        </Field>
        <Field label="State *">
          <select value={party.address.state} onChange={(e) => onAddressChange("state", e.target.value)} className={inputClass} style={{ ...inputStyle, background: "#fff" }}>
            <option value="">Select state</option>
            {STAMP_STATES.map((s) => (<option key={s.value} value={s.value}>{s.label}</option>))}
          </select>
        </Field>
        <Field label="Pincode">
          <SuggestInput type="text" name={`${namePrefix}_pincode`} inputMode="numeric" maxLength={6} value={party.address.pincode} onChange={(v) => onAddressChange("pincode", v)} className={inputClass} style={{ ...inputStyle, background: "#fff" }} />
        </Field>
        <Field label="Country">
          <SuggestInput type="text" name={`${namePrefix}_country`} value={party.address.country} onChange={(v) => onAddressChange("country", v)} placeholder="India" className={inputClass} style={{ ...inputStyle, background: "#fff" }} />
        </Field>
      </div>
    </div>
  );
};

const emptyForm = { service_name: "", customer_name: "", customer_email: "", customer_mobile: "" };
const emptySigner = { name: "", email: "", mobile: "", position: "" };

// eStamp — see backend/app/stamp_service.py's StampInitiateRequest, built
// from SignDesk's DSS 2.0 Stamp Request API doc.
const emptyStampAddress = { street_address: "", locality: "", city: "", state: "", pincode: "", country: "" };
const emptyStampParty = { name: "", entity_type: "Individual", id_type: "", id_number: "", phone: "", address: { ...emptyStampAddress } };
const emptyStampDetails = {
  // Full state name (matches STAMP_STATES' label and the backend's
  // STATE_NAME_TO_SIGNDESK_STAMP_CODE keys) — picked per order below.
  stamp_state: "",
  document_category: "",
  document_category_label: "",
  stamp_amount: "",
  consideration_amount: "",
  stamp_duty_paid_by: "First Party",
  duty_payer_phone_number: "",
  duty_payer_email_id: "",
  surcharge: "",
};

// Lets repeated eStamp test submissions reuse the last entered values
// (everything except the uploaded file itself, which browsers never let you
// restore from storage) instead of retyping ~20 fields every time — see
// loadStampDraft/saveStampDraft below and the "Use last entered test data"
// button in the Stamp Paper Details section.
const STAMP_DRAFT_KEY = "legaldesk_estamp_last_test_data";

const loadStampDraft = () => {
  try {
    return JSON.parse(localStorage.getItem(STAMP_DRAFT_KEY) || "null");
  } catch {
    return null;
  }
};

const saveStampDraft = (draft) => {
  try {
    localStorage.setItem(STAMP_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Storage full/unavailable — this is a convenience feature, never worth failing the submit over.
  }
};

// "eStamp On The Fly" — see backend/app/stamp_service.py's
// StampOtfInitiateRequest. Covers Karnataka/Tamil Nadu/Delhi (SHCIL
// mechanism, article-code based — see ARTICLE_OPTIONS_BY_STATE in
// karnatakaArticleCodes.js) and Maharashtra (eSBTR mechanism, document
// category + property details instead of an article code). No surcharge
// field (Rajasthan-only). Own draft key — deliberately not shared with
// STAMP_DRAFT_KEY, so the two stamp flows' remembered test data never
// cross-contaminate.
const emptyStampOtfDetails = {
  // "Karnataka" or "Maharashtra" — the only two states this credential set
  // covers. Karnataka uses digital_article_code; Maharashtra uses the
  // esbtr_* fields below instead (see buildStampOtfPayload).
  stamp_state: "Karnataka",
  document_category: "",
  document_category_label: "",
  digital_article_code: "",
  esbtr_district: "",
  esbtr_sub_registrar_office: "",
  esbtr_addressline_1: "",
  esbtr_road: "",
  esbtr_town_village: "",
  esbtr_pincode: "",
  esbtr_property_area: "",
  esbtr_property_area_unit: "",
  stamp_amount: "",
  consideration_amount: "",
  stamp_duty_paid_by: "First Party",
  duty_payer_phone_number: "",
  duty_payer_email_id: "",
};

const STAMP_OTF_DRAFT_KEY = "legaldesk_estamp_otf_last_test_data";

const loadStampOtfDraft = () => {
  try {
    return JSON.parse(localStorage.getItem(STAMP_OTF_DRAFT_KEY) || "null");
  } catch {
    return null;
  }
};

const saveStampOtfDraft = (draft) => {
  try {
    localStorage.setItem(STAMP_OTF_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Storage full/unavailable — this is a convenience feature, never worth failing the submit over.
  }
};

// Matches SignDesk's supported "appearance" corners (see signdesk_esign.py's
// SIGNER_POSITIONS) — left blank/"" this signer falls back to the backend's
// auto-assigned corner instead of a client choice.
const SIGNATURE_POSITIONS = [
  { value: "", label: "Auto" },
  { value: "top-left", label: "Top Left" },
  { value: "top-right", label: "Top Right" },
  { value: "bottom-left", label: "Bottom Left" },
  { value: "bottom-right", label: "Bottom Right" },
];

// Some configured documents are built on an external drafting tool rather
// than LegalDesk's own order form — matched by keyword against the document
// name (case-insensitive substring). Extend this list as more document
// types move onto that tool; anything not matched here keeps using the
// normal in-app order form below.
const EXTERNAL_DOCUMENT_BUILDER_BASE = "http://187.127.173.22/document";
const EXTERNAL_DOCUMENT_TYPES = [
  { keyword: "affidavit", type: "affidavit" },
  { keyword: "rental", type: "rental" },
];

const externalDocumentType = (docName) => {
  const lower = (docName || "").toLowerCase();
  return EXTERNAL_DOCUMENT_TYPES.find((d) => lower.includes(d.keyword))?.type || null;
};

// SignDesk's General Document Verification API — the payload eKYC orders
// send is { reference_id, source (base64 of the upload), verification, doc_type }.
// These are the only doc_type values it accepts.
const EKYC_DOC_TYPES = [
  { value: "aadhaar_card", label: "Aadhaar Card" },
  { value: "pan_card", label: "PAN Card" },
];

const signerStatusBadge = (status) => {
  const styles = {
    signed: { background: theme.successSoft, color: theme.success, border: `1px solid ${theme.success}33` },
    sent: { background: theme.goldSoft, color: theme.navy, border: `1px solid ${theme.gold}66` },
    failed: { background: theme.dangerSoft, color: theme.danger, border: `1px solid ${theme.danger}33` },
    pending: { background: theme.bg, color: theme.slate, border: `1px solid ${theme.border}` },
  };
  return (
    <span className="inline-flex items-center px-2.5 py-1 rounded text-xs font-semibold capitalize" style={styles[status] || styles.pending}>
      {status}
    </span>
  );
};

const PartnerUserCreateOrder = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { service: serviceParam } = useParams();
  const preselectedService = serviceParam ? decodeURIComponent(serviceParam) : "";
  const [services, setServices] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [servicesLoading, setServicesLoading] = useState(true);
  const [selectedDocument, setSelectedDocument] = useState(null);
  const [form, setForm] = useState({ ...emptyForm, service_name: preselectedService });
  const [signers, setSigners] = useState([{ ...emptySigner }]);
  const [copies, setCopies] = useState("1");
  const [file, setFile] = useState(null);
  const [docType, setDocType] = useState("");
  const [verifyDocument, setVerifyDocument] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [esignError, setEsignError] = useState("");
  // Per-field validation errors for the eSign form, shown directly above
  // each field instead of the general top-of-form `error` banner — see
  // validateEsignFields/submitOrder. Shape: { document?, signers: [{ name?,
  // email?, mobile?, position? }, ...] }.
  const [esignFieldErrors, setEsignFieldErrors] = useState({ signers: [] });
  // Per-field validation errors for the eKYC form, shown directly above each
  // field instead of the general top-of-form `error` banner — see
  // validateEkycFields/submitOrder. Shape: { customerName?, customerEmail?,
  // customerMobile?, docType?, document? }.
  const [ekycFieldErrors, setEkycFieldErrors] = useState({});
  const [stampDetails, setStampDetails] = useState({ ...emptyStampDetails });
  const [firstParty, setFirstParty] = useState({ ...emptyStampParty, address: { ...emptyStampAddress } });
  const [secondParty, setSecondParty] = useState({ ...emptyStampParty, address: { ...emptyStampAddress } });
  const [stampError, setStampError] = useState("");
  const [stampDownloading, setStampDownloading] = useState(false);
  const [stampDraft, setStampDraft] = useState(() => loadStampDraft());
  const [stampOtfDetails, setStampOtfDetails] = useState({ ...emptyStampOtfDetails });
  const [otfFirstParty, setOtfFirstParty] = useState({ ...emptyStampParty, address: { ...emptyStampAddress } });
  const [otfSecondParty, setOtfSecondParty] = useState({ ...emptyStampParty, address: { ...emptyStampAddress } });
  const [stampOtfError, setStampOtfError] = useState("");
  const [stampOtfDownloading, setStampOtfDownloading] = useState(false);
  const [stampOtfDraft, setStampOtfDraft] = useState(() => loadStampOtfDraft());
  const [wantEsignAfterStamp, setWantEsignAfterStamp] = useState(false);
  const [stampEsignSigners, setStampEsignSigners] = useState([{ ...emptySigner }]);
  const [stampEsignError, setStampEsignError] = useState("");
  const [digilockerLoading, setDigilockerLoading] = useState(false);
  const [digilockerError, setDigilockerError] = useState("");
  const [fetchingAadhaar, setFetchingAadhaar] = useState(false);
  const [ekycCharges, setEkycCharges] = useState([]);
  const [ekycRetrying, setEkycRetrying] = useState(false);
  // Set only when this eKYC form was opened from a Bulk eKYC CSV row (see
  // PartnerUserEkycBulk.jsx's "Initiate eKYC" navigate call) — threaded
  // through to submitOrder below so the created order gets linked back to
  // that CSV row (see partner._create_order's bulk_ekyc_record_id param).
  // Stays null for every other entry point, which behaves exactly as before.
  const [bulkRecordId, setBulkRecordId] = useState(null);

  const isEsign = form.service_name === "eSign";
  const isEkyc = form.service_name === "eKYC";
  const isEStamp = form.service_name === "eStamp";
  const isEStampOnTheFly = form.service_name === "eStamp On The Fly";

  // The sidebar's per-service links (/orders/create/:service) and the plain
  // /orders/create route both render this component, so React Router reuses
  // the same instance instead of remounting when you switch between them —
  // without this, clicking a different service in the sidebar changes the
  // URL but leaves the form showing whatever service was selected before.
  useEffect(() => {
    // Bulk eKYC hands off customer data via router state (see
    // PartnerUserEkycBulk.jsx) — only meaningful for the eKYC service;
    // absent for every other entry point (direct sidebar click, other
    // services), which fall back to the plain blank emptyForm exactly as
    // before.
    const prefill = preselectedService === "eKYC" ? location.state?.prefill : null;
    setForm({
      ...emptyForm,
      service_name: preselectedService,
      ...(prefill ? { customer_name: prefill.customer_name || "", customer_email: prefill.customer_email || "", customer_mobile: prefill.customer_mobile || "" } : {}),
    });
    setSigners([{ ...emptySigner }]);
    setCopies("1");
    setFile(null);
    setDocType(prefill?.doc_type || "");
    setVerifyDocument(true);
    setSelectedDocument(null);
    setResult(null);
    setError("");
    setEsignError("");
    setEkycFieldErrors({});
    setStampDetails({ ...emptyStampDetails });
    setFirstParty({ ...emptyStampParty, address: { ...emptyStampAddress } });
    setSecondParty({ ...emptyStampParty, address: { ...emptyStampAddress } });
    setStampError("");
    setWantEsignAfterStamp(false);
    setStampEsignSigners([{ ...emptySigner }]);
    setStampEsignError("");
    setStampOtfDetails({ ...emptyStampOtfDetails });
    setOtfFirstParty({ ...emptyStampParty, address: { ...emptyStampAddress } });
    setOtfSecondParty({ ...emptyStampParty, address: { ...emptyStampAddress } });
    setStampOtfError("");
    setBulkRecordId(prefill ? location.state?.bulk_record_id || null : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselectedService]);

  useEffect(() => {
    apiRequest("/api/partner-user/services")
      .then((data) => {
        // Only what THIS user was actually assigned by their Partner —
        // "Document Service" itself has no flat price (pricing lives on the
        // individual configured documents), so it's synthesized here purely
        // as a selectable option, same as the Partner's own Create Order.
        const assigned = (data.services || []).filter((s) => s.assigned && LOCALLY_HANDLED_SERVICES.has(s.service_name));
        if ((data.documents || []).some((d) => d.assigned)) {
          assigned.unshift({ service_name: "Document Service", price: null });
        }
        setServices(assigned);
        setDocuments((data.documents || []).filter((d) => d.assigned));
      })
      .catch(() => {
        setServices([]);
        setDocuments([]);
      })
      .finally(() => setServicesLoading(false));
  }, []);

  // eKYC's admin-configured additional charges (Delivery Charge, Service
  // Charge, ...) — same organization_service_charge_pricing-backed endpoint
  // PartnerUserCreateEstampBulk.jsx/PartnerUserCreateManualEstamp.jsx
  // already use for their own charges, just scoped to eKYC here. Re-fetched
  // whenever the eKYC form becomes active so switching services (or the
  // sidebar link) always reflects the current org's configuration, never a
  // stale fetch from a previous service.
  useEffect(() => {
    if (!isEkyc) {
      setEkycCharges([]);
      return;
    }
    apiRequest(`/api/partner-user/services/${encodeURIComponent(form.service_name)}/charges`)
      .then((res) => setEkycCharges(res.charges || []))
      .catch(() => setEkycCharges([]));
  }, [isEkyc, form.service_name]);

  const isDocumentService = form.service_name === "Document Service";
  // Reached via a stale link/bookmark or a direct URL to /orders/create/:service
  // for a service this component has no real field handling for (see
  // LOCALLY_HANDLED_SERVICES above) — the sidebar itself no longer links to
  // these, but the route isn't otherwise gated.
  const isUnsupported = !!form.service_name && !isEsign && !isEkyc && !isEStamp && !isEStampOnTheFly && !isDocumentService;

  const selectedService = services.find((s) => s.service_name === form.service_name);
  const copiesCount = parseInt(copies, 10) || 0;
  const totalAmount = selectedService?.price != null ? selectedService.price * copiesCount : null;

  // eKYC's full breakdown — base price + admin-configured additional
  // charges (only the ones with a real amount, matching how order_charge
  // is actually snapshotted server-side in partner._create_order) + GST on
  // the combined total (eKYC has no stamp-value component the way eStamp
  // does, so its entire amount is taxed, same as invoice_service._resolve_
  // order_invoice's generic branch already does at invoice time).
  //
  // "-" only means "eKYC isn't assigned/enabled for this account at all"
  // (selectedService missing) — a blank/0 base Price field must never hide
  // otherwise-configured Delivery/Service charges behind a stray "-", so a
  // present-but-null price is treated as 0 here, not as "unknown".
  const ekycVisibleCharges = ekycCharges.filter((c) => Number(c.price) > 0);
  const ekycChargesTotal = ekycVisibleCharges.reduce((sum, c) => sum + Number(c.price), 0);
  const ekycBaseTotal = selectedService ? Number(selectedService.price || 0) * copiesCount : null;
  const ekycPreTaxTotal = ekycBaseTotal != null ? ekycBaseTotal + ekycChargesTotal : null;
  const ekycGstAmount = ekycPreTaxTotal != null ? calculateGst(ekycPreTaxTotal) : 0;
  const ekycGrandTotal = ekycPreTaxTotal != null ? ekycPreTaxTotal + ekycGstAmount : null;

  // eSign and (single) eStamp have no stamp-value/reimbursement component in
  // this generic flow's own price field — the entire service price is
  // taxable, same as eKYC's whole amount above (see invoice_service.
  // _resolve_order_invoice's generic "Service Charge" fallback branch,
  // which is exactly what these two use). eStamp's separately-shown "Stamp
  // Amount" field above is the stamp duty request itself, priced/taxed
  // through the SignDesk eStamp flow, not through this order's own price.
  const eSignEStampTaxable = totalAmount ?? selectedService?.price ?? null;
  const eSignEStampGst = eSignEStampTaxable != null ? calculateGst(eSignEStampTaxable) : 0;
  const eSignEStampGrandTotal = eSignEStampTaxable != null ? eSignEStampTaxable + eSignEStampGst : null;

  const documentServiceTaxable =
    isDocumentService && selectedDocument && selectedDocument.base_price != null
      ? selectedDocument.base_price * copiesCount
      : null;
  const documentServiceGst = documentServiceTaxable != null ? calculateGst(documentServiceTaxable) : 0;
  const documentServiceGrandTotal = documentServiceTaxable != null ? documentServiceTaxable + documentServiceGst : null;

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm({ ...form, [name]: name === "customer_mobile" ? sanitizeMobileInput(value) : value });
  };

  // Maps the shared customer-detail inputs' `name` to their eKYC fieldErrors
  // key (see validateEkycFields below).
  const EKYC_CUSTOMER_FIELD_ERROR_KEYS = { customer_name: "customerName", customer_email: "customerEmail", customer_mobile: "customerMobile" };

  const updateCustomerField = (name, value) => {
    setForm((prev) => ({ ...prev, [name]: name === "customer_mobile" ? sanitizeMobileInput(value) : value }));
    const key = EKYC_CUSTOMER_FIELD_ERROR_KEYS[name];
    if (key) setEkycFieldErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  };

  const updateSigner = (index, field, value) => {
    const nextValue = field === "mobile" ? sanitizeMobileInput(value) : value;
    const nextSignersList = signers.map((s, i) => (i === index ? { ...s, [field]: nextValue } : s));
    setSigners(nextSignersList);
    setEsignFieldErrors((prev) => {
      if (!prev.signers || prev.signers.length === 0) return prev;
      let nextErrors = prev.signers.map((e, i) => (i === index ? { ...e, [field]: undefined } : e));
      if (field === "position") {
        // Clearing/changing one signer's position can resolve (or move) a
        // duplicate-position conflict with another signer, so re-check every
        // signer's position error rather than only the one just edited.
        const positionCounts = {};
        nextSignersList.forEach((s) => {
          if (s.position) positionCounts[s.position] = (positionCounts[s.position] || 0) + 1;
        });
        nextErrors = nextErrors.map((e, i) => ({
          ...e,
          position: nextSignersList[i].position && positionCounts[nextSignersList[i].position] > 1
            ? "This signature position is already used by another signer."
            : undefined,
        }));
      }
      return { ...prev, signers: nextErrors };
    });
  };

  const handleSignerCountChange = (value) => {
    const count = parseInt(value, 10) || 1;
    setCopies(String(count));
    setSigners((prev) => {
      const next = prev.slice(0, count);
      while (next.length < count) next.push({ ...emptySigner });
      return next;
    });
    setEsignFieldErrors((prev) => ({ ...prev, signers: prev.signers.slice(0, count) }));
  };

  const updateStampEsignSigner = (index, field, value) => {
    setStampEsignSigners((prev) =>
      prev.map((s, i) => (i === index ? { ...s, [field]: field === "mobile" ? sanitizeMobileInput(value) : value } : s))
    );
  };

  const handleStampEsignSignerCountChange = (value) => {
    const count = parseInt(value, 10) || 1;
    setStampEsignSigners((prev) => {
      const next = prev.slice(0, count);
      while (next.length < count) next.push({ ...emptySigner });
      return next;
    });
  };

  const updateStampDetail = (field, value) => setStampDetails((prev) => ({ ...prev, [field]: value }));

  const handleDocumentCategoryChange = (label) => {
    const match = DOCUMENT_CATEGORIES.find((d) => d.label === label);
    setStampDetails((prev) => ({ ...prev, document_category_label: label, document_category: match ? match.value : "" }));
  };

  const updateParty = (which, field, value) => {
    const setter = which === "first" ? setFirstParty : setSecondParty;
    // Changing entity type invalidates whatever ID type was picked for the
    // old entity type (see stampConstants.ID_TYPES_BY_ENTITY).
    setter((prev) => ({ ...prev, [field]: value, ...(field === "entity_type" ? { id_type: "" } : {}) }));
  };

  const updatePartyAddress = (which, field, value) => {
    const setter = which === "first" ? setFirstParty : setSecondParty;
    setter((prev) => ({ ...prev, address: { ...prev.address, [field]: value } }));
  };

  const buildStampPayload = () => ({
    stamp_state: stampDetails.stamp_state,
    document_category: Number(stampDetails.document_category),
    stamp_amount: Number(stampDetails.stamp_amount),
    consideration_amount: Number(stampDetails.consideration_amount),
    stamp_duty_paid_by: stampDetails.stamp_duty_paid_by,
    duty_payer_phone_number: stampDetails.duty_payer_phone_number,
    duty_payer_email_id: stampDetails.duty_payer_email_id || null,
    surcharge: stampDetails.surcharge !== "" ? Number(stampDetails.surcharge) : null,
    first_party: firstParty,
    second_party: secondParty,
  });

  const handleUseLastStampData = () => {
    if (!stampDraft) return;
    setStampDetails({ ...emptyStampDetails, ...stampDraft.stampDetails });
    setFirstParty({ ...emptyStampParty, ...stampDraft.firstParty, address: { ...emptyStampAddress, ...stampDraft.firstParty?.address } });
    setSecondParty({ ...emptyStampParty, ...stampDraft.secondParty, address: { ...emptyStampAddress, ...stampDraft.secondParty?.address } });
    if (stampDraft.customer) {
      setForm((prev) => ({ ...prev, customer_name: stampDraft.customer.name, customer_email: stampDraft.customer.email, customer_mobile: stampDraft.customer.mobile }));
    }
  };

  const updateStampOtfDetail = (field, value) => setStampOtfDetails((prev) => ({ ...prev, [field]: value }));

  // SHCIL states (Karnataka, Tamil Nadu, Delhi): picking an article
  // auto-fills document_category from that state's own
  // ARTICLE_OPTIONS_BY_STATE entry (SignDesk-confirmed for Karnataka, less
  // so for the others — see karnatakaArticleCodes.js) — there's no separate
  // document-category field for these states, unlike Maharashtra (which
  // still needs one picked manually — see buildStampOtfPayload).
  const updateOtfArticleCode = (value) => {
    const match = (ARTICLE_OPTIONS_BY_STATE[stampOtfDetails.stamp_state] || []).find((o) => o.value === value);
    setStampOtfDetails((prev) => ({
      ...prev, digital_article_code: value,
      document_category: match ? match.document_category : "",
      document_category_label: match ? `${match.document_category} – ${match.label}` : "",
    }));
  };

  // Changing state resets the fields the other state's flow owns (article
  // code / eSBTR block) so a stale value from a previous selection is never
  // silently submitted. Changing district resets the office, since offices
  // are scoped to a single district (see MAHARASHTRA_DISTRICTS).
  const updateOtfState = (value) => setStampOtfDetails((prev) => ({
    ...prev, stamp_state: value, digital_article_code: "",
    document_category: "", document_category_label: "",
    esbtr_district: "", esbtr_sub_registrar_office: "",
  }));

  const updateOtfDistrict = (value) => setStampOtfDetails((prev) => ({ ...prev, esbtr_district: value, esbtr_sub_registrar_office: "" }));

  const handleOtfDocumentCategoryChange = (label) => {
    const match = DOCUMENT_CATEGORIES.find((d) => d.label === label);
    setStampOtfDetails((prev) => ({ ...prev, document_category_label: label, document_category: match ? match.value : "" }));
  };

  const updateOtfParty = (which, field, value) => {
    const setter = which === "first" ? setOtfFirstParty : setOtfSecondParty;
    setter((prev) => ({ ...prev, [field]: value, ...(field === "entity_type" ? { id_type: "" } : {}) }));
  };

  const updateOtfPartyAddress = (which, field, value) => {
    const setter = which === "first" ? setOtfFirstParty : setOtfSecondParty;
    setter((prev) => ({ ...prev, address: { ...prev.address, [field]: value } }));
  };

  const buildStampOtfPayload = () => ({
    stamp_state: stampOtfDetails.stamp_state,
    // SHCIL states: document_category is derived server-side from
    // digital_article_code (see stamp_service._build_request_payload_otf)
    // — not sent at all, so there's no chance of sending a mismatched pair.
    document_category: stampOtfDetails.stamp_state === "Maharashtra" ? Number(stampOtfDetails.document_category) : null,
    digital_article_code: SHCIL_OTF_STATES.includes(stampOtfDetails.stamp_state) ? stampOtfDetails.digital_article_code : null,
    esbtr_details: stampOtfDetails.stamp_state === "Maharashtra" ? {
      district: stampOtfDetails.esbtr_district,
      sub_registrar_office: stampOtfDetails.esbtr_sub_registrar_office,
      property_address: {
        addressline_1: stampOtfDetails.esbtr_addressline_1,
        road: stampOtfDetails.esbtr_road,
        town_village: stampOtfDetails.esbtr_town_village,
        district: stampOtfDetails.esbtr_district,
        pincode: stampOtfDetails.esbtr_pincode,
      },
      property_area: stampOtfDetails.esbtr_property_area,
      property_area_unit: stampOtfDetails.esbtr_property_area_unit,
    } : null,
    stamp_amount: Number(stampOtfDetails.stamp_amount),
    consideration_amount: Number(stampOtfDetails.consideration_amount),
    stamp_duty_paid_by: stampOtfDetails.stamp_duty_paid_by,
    duty_payer_phone_number: stampOtfDetails.duty_payer_phone_number,
    duty_payer_email_id: stampOtfDetails.duty_payer_email_id || null,
    first_party: otfFirstParty,
    second_party: otfSecondParty,
  });

  const handleUseLastStampOtfData = () => {
    if (!stampOtfDraft) return;
    setStampOtfDetails({ ...emptyStampOtfDetails, ...stampOtfDraft.stampOtfDetails });
    setOtfFirstParty({ ...emptyStampParty, ...stampOtfDraft.firstParty, address: { ...emptyStampAddress, ...stampOtfDraft.firstParty?.address } });
    setOtfSecondParty({ ...emptyStampParty, ...stampOtfDraft.secondParty, address: { ...emptyStampAddress, ...stampOtfDraft.secondParty?.address } });
    if (stampOtfDraft.customer) {
      setForm((prev) => ({ ...prev, customer_name: stampOtfDraft.customer.name, customer_email: stampOtfDraft.customer.email, customer_mobile: stampOtfDraft.customer.mobile }));
    }
  };

  // Per-field validation for the eSign form — mirrors the eSign rules inside
  // validate() below, but returns every invalid field at once (rather than
  // the first error found) so each one can be shown above its own field.
  const validateEsignFields = () => {
    const errors = { signers: signers.map(() => ({})) };
    if (!file) errors.document = "Please upload a document to send for eSign.";
    else if (file.type !== "application/pdf") errors.document = "eSign documents must be a PDF file.";

    signers.forEach((s, i) => {
      if (!s.name) errors.signers[i].name = "Signer name is required.";
      // Email itself isn't mandatory — a signer with no email gets the
      // signing invitation via SMS instead (see signdesk_esign.py).
      if (s.email && !isValidEmail(s.email)) errors.signers[i].email = "Enter a valid email address.";
      if (!s.mobile) errors.signers[i].mobile = "Signer mobile number is required.";
      else if (!isValidMobile(s.mobile)) errors.signers[i].mobile = "Mobile number must be exactly 10 digits.";
    });

    const positionCounts = {};
    signers.forEach((s) => {
      if (s.position) positionCounts[s.position] = (positionCounts[s.position] || 0) + 1;
    });
    signers.forEach((s, i) => {
      if (s.position && positionCounts[s.position] > 1) {
        errors.signers[i].position = "This signature position is already used by another signer.";
      }
    });

    return errors;
  };

  const hasEsignFieldErrors = (errors) =>
    !!errors.document || (errors.signers || []).some((e) => Object.keys(e).some((k) => e[k]));

  // Per-field validation for the eKYC form — mirrors validateEsignFields'
  // pattern: every invalid field is reported at once so each one can be
  // shown directly above its own field, instead of validate()'s single
  // first-error message.
  const validateEkycFields = () => {
    const errors = {};
    if (!form.customer_name.trim()) errors.customerName = "Please enter the customer name.";
    // No email field for eKYC — SignDesk's eKYC APIs (General Document
    // Verification, DigiLocker, PAN) never take or need a customer email at
    // all, so it isn't collected here (see backend/app/routes/partner.py's
    // _create_order, which only requires it for every OTHER service).
    if (!form.customer_mobile.trim()) errors.customerMobile = "Please enter the customer mobile number.";
    else if (!isValidMobile(form.customer_mobile)) errors.customerMobile = "Please enter a valid mobile number.";
    if (!docType) errors.docType = "Please select a document type.";
    if (!file) errors.document = "Please upload a document.";
    return errors;
  };

  const hasEkycFieldErrors = (errors) => Object.values(errors).some(Boolean);

  // Converts a raw backend/Pydantic validation message (e.g. "field required")
  // into a clean, generic message — a safety net for the rare case something
  // reaches the API that validateEkycFields didn't already catch, since every
  // field the backend requires for an eKYC order is validated above first.
  const friendlyEkycApiError = (message) => {
    if (!message) return "Something went wrong. Please try again.";
    if (/value error,/i.test(message) || /field required/i.test(message)) {
      return "Some required information is missing or invalid. Please review the form and try again.";
    }
    return message;
  };

  // Validation for every non-eSign, non-eKYC service — eSign and eKYC use
  // their own validateEsignFields/validateEkycFields instead, since both
  // need per-field errors rather than a single first-error message.
  const validate = () => {
    if (!form.service_name) return "Please select a service";
    if (!copiesCount || copiesCount < 1) return "Number of copies must be at least 1";
    if (!form.customer_name || !form.customer_email || !form.customer_mobile) return "Customer name, email and mobile are required";
    if (!isValidEmail(form.customer_email)) return "Please enter a valid customer email address";
    if (!isValidMobile(form.customer_mobile)) return "Customer mobile number must be exactly 10 digits";
    if (isEStamp) {
      if (!stampDetails.stamp_state) return "Please select a stamp state";
      if (!stampDetails.document_category) return "Please select a document category";
      if (!stampDetails.stamp_amount || Number(stampDetails.stamp_amount) <= 0) return "Stamp amount must be greater than 0";
      if (!stampDetails.consideration_amount || Number(stampDetails.consideration_amount) <= 0) return "Consideration amount must be greater than 0";
      if (!isValidMobile(stampDetails.duty_payer_phone_number)) return "Duty payer mobile number must be exactly 10 digits";
      if (stampDetails.stamp_duty_paid_by === "Second Party" && !isValidEmail(stampDetails.duty_payer_email_id)) {
        return "Duty payer email is required when the second party pays the stamp duty";
      }
      if (stampDetails.stamp_state === "Rajasthan" && stampDetails.surcharge === "") return "Surcharge is required for Rajasthan (RJ)";
      if (wantEsignAfterStamp) {
        if (stampEsignSigners.length === 0) return "Add at least one eSign signer";
        for (const s of stampEsignSigners) {
          if (!s.name || !s.mobile) return "Every eSign signer needs a name and mobile number";
          // Email itself isn't mandatory — a signer with no email gets the
          // signing invitation via SMS instead, same as validateEsignFields above.
          if (s.email && !isValidEmail(s.email)) return `"${s.email}" is not a valid email address`;
          if (!isValidMobile(s.mobile)) return "eSign signer mobile numbers must be exactly 10 digits";
        }
        const chosenStampEsignPositions = stampEsignSigners.map((s) => s.position).filter(Boolean);
        if (new Set(chosenStampEsignPositions).size !== chosenStampEsignPositions.length) {
          return "Each eSign signer must have a distinct signature position";
        }
      }
      for (const [label, party] of [["First party", firstParty], ["Second party", secondParty]]) {
        if (!party.name || !party.entity_type || !party.id_type || !party.id_number) {
          return `${label}: name, entity type, ID type and ID number are all required`;
        }
        if (!party.address.street_address || !party.address.city || !party.address.state) {
          return `${label}: street address, city and state are required`;
        }
      }
      if (file && file.type !== "application/pdf") return "eStamp documents must be a PDF file";
    }
    if (isEStampOnTheFly) {
      if (SHCIL_OTF_STATES.includes(stampOtfDetails.stamp_state)) {
        if (!stampOtfDetails.digital_article_code) return "Please select an article code";
      } else {
        if (!stampOtfDetails.document_category) return "Please select a document category";
        if (!stampOtfDetails.esbtr_district) return "Please select a district";
        if (!stampOtfDetails.esbtr_sub_registrar_office) return "Please select a sub-registrar office";
        if (!stampOtfDetails.esbtr_addressline_1 || !stampOtfDetails.esbtr_road || !stampOtfDetails.esbtr_town_village || !stampOtfDetails.esbtr_pincode) {
          return "Property address (line 1, road, town/village and pincode) is required";
        }
        if (!stampOtfDetails.esbtr_property_area) return "Please enter the property area";
        if (!stampOtfDetails.esbtr_property_area_unit) return "Please select the property area unit";
      }
      if (!stampOtfDetails.stamp_amount || Number(stampOtfDetails.stamp_amount) <= 0) return "Stamp amount must be greater than 0";
      if (!stampOtfDetails.consideration_amount || Number(stampOtfDetails.consideration_amount) <= 0) return "Consideration amount must be greater than 0";
      if (!isValidMobile(stampOtfDetails.duty_payer_phone_number)) return "Duty payer mobile number must be exactly 10 digits";
      if (stampOtfDetails.stamp_duty_paid_by === "Second Party" && !isValidEmail(stampOtfDetails.duty_payer_email_id)) {
        return "Duty payer email is required when the second party pays the stamp duty";
      }
      for (const [label, party] of [["First party", otfFirstParty], ["Second party", otfSecondParty]]) {
        if (!party.name || !party.entity_type || !party.id_type || !party.id_number) {
          return `${label}: name, entity type, ID type and ID number are all required`;
        }
        if (!party.address.street_address || !party.address.city || !party.address.state) {
          return `${label}: street address, city and state are required`;
        }
      }
      if (file && file.type !== "application/pdf") return "eStamp On The Fly documents must be a PDF file";
    }
    if (!file) return "Please upload a document";
    return "";
  };

  const submitOrder = async (action) => {
    if (isEsign) {
      const fieldErrors = validateEsignFields();
      if (hasEsignFieldErrors(fieldErrors)) {
        setEsignFieldErrors(fieldErrors);
        return;
      }
      setEsignFieldErrors({ signers: signers.map(() => ({})) });
    } else if (isEkyc) {
      const fieldErrors = validateEkycFields();
      if (hasEkycFieldErrors(fieldErrors)) {
        setEkycFieldErrors(fieldErrors);
        return;
      }
      setEkycFieldErrors({});
    } else {
      const validationError = validate();
      if (validationError) {
        setError(validationError);
        return;
      }
    }
    setSaving(true);
    setError("");
    setEsignError("");
    setStampError("");
    setStampEsignError("");
    setStampOtfError("");
    if (isEStamp) {
      // Remember this attempt regardless of whether the order/eStamp call
      // below actually succeeds — validate() already passed, so it's usable
      // test data either way (see handleUseLastStampData).
      const draft = {
        stampDetails, firstParty, secondParty,
        customer: { name: form.customer_name, email: form.customer_email, mobile: form.customer_mobile },
      };
      saveStampDraft(draft);
      setStampDraft(draft);
    }
    if (isEStampOnTheFly) {
      const otfDraft = {
        stampOtfDetails, firstParty: otfFirstParty, secondParty: otfSecondParty,
        customer: { name: form.customer_name, email: form.customer_email, mobile: form.customer_mobile },
      };
      saveStampOtfDraft(otfDraft);
      setStampOtfDraft(otfDraft);
    }
    try {
      const formData = new FormData();
      formData.append("service_name", form.service_name);
      formData.append("customer_name", isEsign ? signers[0].name : form.customer_name);
      // Omitted entirely for eKYC, and now also for an eSign order whose
      // first signer has no email (email is optional per-signer) — the
      // backend's customer_email is Optional[EmailStr], and an empty string
      // would still fail EmailStr's format validation even though None/an
      // absent field is fine.
      const esignCustomerEmail = isEsign ? signers[0].email : form.customer_email;
      if (!isEkyc && esignCustomerEmail) formData.append("customer_email", esignCustomerEmail);
      formData.append("customer_mobile", isEsign ? signers[0].mobile : form.customer_mobile);
      formData.append("quantity", String(copiesCount));
      formData.append("action", action);
      formData.append("document", file);
      if (isEkyc) {
        // Maps directly onto SignDesk's General Document Verification API
        // payload: { doc_type, verification } (source/reference_id are built
        // server-side from `document` and the order id).
        formData.append("doc_type", docType);
        formData.append("verification", String(verifyDocument));
        if (bulkRecordId) formData.append("bulk_ekyc_record_id", bulkRecordId);
      }
      const order = await apiUpload("/api/partner-user/orders", formData);
      // Order creation deducts from the wallet server-side — let the header's
      // balance chip know so it doesn't keep showing the pre-order amount.
      window.dispatchEvent(new Event("wallet:updated"));

      if (isEsign && action === "submit") {
        try {
          const esign = await apiRequest(`/api/partner-user/orders/${order.id}/esign/initiate`, {
            method: "POST",
            // A blank email must reach the backend as absent, not "" — the
            // backend's SignerIn.email is EmailStr | None, which accepts
            // None but still runs EmailStr's format check against an empty
            // string and rejects it.
            body: JSON.stringify({ signers: signers.map((s) => ({ ...s, email: s.email || null })) }),
          });
          setResult({ ...order, esign });
        } catch (esignErr) {
          setEsignError(esignErr.message);
          setResult(order);
        }
      } else if (isEkyc && action === "submit") {
        try {
          await apiRequest(`/api/partner-user/orders/${order.id}/ekyc/verify`, {
            method: "POST",
            body: JSON.stringify({ verification: verifyDocument }),
          });
        } catch {
          // Swallowed deliberately: initiate_ekyc already persists a
          // 'failed' b2b_ekyc_verification row on a SignDeskError, so the
          // fetch below still has something real to show.
        }
        // The verification result is already persisted server-side by the
        // calls above — re-fetch the full order here (rather than trusting
        // only the /ekyc/verify response) so this success screen shows
        // exactly what the backend has on record, same source of truth the
        // Order Detail page (PartnerUserOrderDetails.jsx) reads from.
        try {
          const fullOrder = await apiRequest(`/api/partner-user/orders/${order.id}`);
          setResult(fullOrder);
        } catch {
          setResult(order);
        }
      } else if (isEStamp && action === "submit") {
        try {
          const stamp = await apiRequest(`/api/partner-user/orders/${order.id}/stamp/initiate`, {
            method: "POST",
            body: JSON.stringify(buildStampPayload()),
          });
          let esign = null;
          let esignPending = false;
          if (wantEsignAfterStamp) {
            if (stamp.status === "completed") {
              try {
                esign = await apiRequest(`/api/partner-user/orders/${order.id}/esign/initiate`, {
                  method: "POST",
                  // Same "" -> null fix as the pure eSign path above.
                  body: JSON.stringify({ signers: stampEsignSigners.map((s) => ({ ...s, email: s.email || null })) }),
                });
              } catch (stampEsignErr) {
                setStampEsignError(stampEsignErr.message);
              }
            } else {
              // SignDesk hasn't returned the stamped copy yet (async
              // procurement — see initiate_stamp) — nothing to send for
              // eSign against until that finishes.
              esignPending = true;
            }
          }
          setResult({ ...order, stamp, esign, esignPending });
        } catch (stampErr) {
          setStampError(stampErr.message);
          setResult(order);
        }
      } else if (isEStampOnTheFly && action === "submit") {
        try {
          const stampOtf = await apiRequest(`/api/partner-user/orders/${order.id}/stamp-otf/initiate`, {
            method: "POST",
            body: JSON.stringify(buildStampOtfPayload()),
          });
          setResult({ ...order, stampOtf });
        } catch (stampOtfErr) {
          setStampOtfError(stampOtfErr.message);
          setResult(order);
        }
      } else {
        setResult(order);
      }
    } catch (err) {
      setError(isEkyc ? friendlyEkycApiError(err.message) : err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleCreateAnother = () => {
    setForm({ ...emptyForm, service_name: preselectedService });
    setSigners([{ ...emptySigner }]);
    setCopies("1");
    setFile(null);
    setDocType("");
    setVerifyDocument(true);
    setSelectedDocument(null);
    setResult(null);
    setEsignError("");
    setEkycFieldErrors({});
    setStampDetails({ ...emptyStampDetails });
    setFirstParty({ ...emptyStampParty, address: { ...emptyStampAddress } });
    setSecondParty({ ...emptyStampParty, address: { ...emptyStampAddress } });
    setStampError("");
    setWantEsignAfterStamp(false);
    setStampEsignSigners([{ ...emptySigner }]);
    setStampEsignError("");
    setStampOtfDetails({ ...emptyStampOtfDetails });
    setOtfFirstParty({ ...emptyStampParty, address: { ...emptyStampAddress } });
    setOtfSecondParty({ ...emptyStampParty, address: { ...emptyStampAddress } });
    setStampOtfError("");
  };

  const handleDownloadStampedDocument = async () => {
    if (!result?.id) return;
    setStampDownloading(true);
    try {
      await downloadFile(`/api/partner-user/orders/${result.id}/document/stamped-preview`, `${result.order_no}-stamped.pdf`);
    } catch (err) {
      setStampError(err.message);
    } finally {
      setStampDownloading(false);
    }
  };

  const handleDownloadOtfStampedDocument = async () => {
    if (!result?.id) return;
    setStampOtfDownloading(true);
    try {
      await downloadFile(`/api/partner-user/orders/${result.id}/document/stamp-otf-preview`, `${result.order_no}-stamped.pdf`);
    } catch (err) {
      setStampOtfError(err.message);
    } finally {
      setStampOtfDownloading(false);
    }
  };

  // Re-pulls the full order (same endpoint the Order Detail page reads from)
  // so this success screen's eKYC/DigiLocker sections reflect exactly what's
  // persisted server-side after a DigiLocker action, same pattern as the
  // initial setResult(fullOrder) right after submit.
  const refreshResult = async () => {
    if (!result?.id) return;
    try {
      const fullOrder = await apiRequest(`/api/partner-user/orders/${result.id}`);
      setResult(fullOrder);
    } catch {
      // Leave the existing result on screen if the refresh itself fails.
    }
  };

  // Re-runs the same General Document Verification call submitOrder makes at
  // submit — initiate_ekyc (see ekyc_service.py) explicitly allows re-submitting
  // once the stored status is 'failed', so this is a real, backend-supported
  // retry, not a client-side-only reset.
  const handleRetryEkycVerification = async () => {
    if (!result?.id) return;
    setEkycRetrying(true);
    setError("");
    try {
      await apiRequest(`/api/partner-user/orders/${result.id}/ekyc/verify`, {
        method: "POST",
        body: JSON.stringify({ verification: verifyDocument }),
      });
      await refreshResult();
    } catch (err) {
      setError(friendlyEkycApiError(err.message));
    } finally {
      setEkycRetrying(false);
    }
  };

  const handleDigilockerVerify = async () => {
    setDigilockerLoading(true);
    setDigilockerError("");
    try {
      const digilocker = await apiRequest(`/api/partner-user/orders/${result.id}/digilocker/verify`, { method: "POST" });
      await refreshResult();
      if (digilocker.status === "link_generated" && digilocker.link) {
        window.open(digilocker.link, "_blank", "noopener,noreferrer");
      }
    } catch (err) {
      setDigilockerError(err.message);
    } finally {
      setDigilockerLoading(false);
    }
  };

  const handleFetchAadhaarDetails = async () => {
    setFetchingAadhaar(true);
    setDigilockerError("");
    try {
      await apiRequest(`/api/partner-user/orders/${result.id}/digilocker/fetch-aadhaar`, { method: "POST" });
      await refreshResult();
    } catch (err) {
      setDigilockerError(err.message);
    } finally {
      setFetchingAadhaar(false);
    }
  };

  // An Aadhaar eKYC order's General Document Verification pass (run
  // automatically at submit, see submitOrder above) only ever extracts —
  // real verification for aadhaar_card needs the DigiLocker step below (see
  // ekyc_service._sync_ekyc_order_status: aadhaar_card lands on
  // "Verification Pending" until DigiLocker confirms it). The fee is only
  // ever charged once that finishes (see
  // ekyc_service._charge_ekyc_fee_on_verification), so this screen must not
  // tell the partner user the order is "placed" until then either — showing
  // a false "submitted successfully" before DigiLocker runs is exactly the
  // confusion this guards against.
  const needsDigilockerFirst = isEkyc && result?.document_type === "aadhaar_card" && result?.digilocker?.status !== "verified";

  // The single "is this eKYC order actually done, and did it pass?" signal —
  // aadhaar_card orders are only ever concluded by the DigiLocker step (the
  // initial upload pass never counts as final, see needsDigilockerFirst's
  // comment above); every other doc type (pan_card, the only other option
  // this form offers) is concluded by the General Document Verification call
  // made at submit. null means "still in progress" (e.g. aadhaar_card
  // awaiting a DigiLocker action) — the existing step-by-step UI keeps
  // showing in that case instead of a premature success/failure screen.
  const ekycOutcome = !isEkyc || !result?.ekyc
    ? null
    : result.document_type === "aadhaar_card"
      ? (result.digilocker?.status === "verified" ? "success" : result.digilocker?.status === "failed" ? "failed" : null)
      : (result.ekyc.status === "success" && result.ekyc.verified ? "success" : "failed");
  const ekycFailureReason = result?.document_type === "aadhaar_card" ? result?.digilocker?.error : result?.ekyc?.error;
  // Both initiate_digilocker and initiate_ekyc (see the respective service
  // modules) only allow re-submitting when the stored status is literally
  // 'failed' — a pan_card order that extracted successfully but didn't match
  // government records (status: success, verified: false) would be rejected
  // with a confusing "already submitted" error if retried the same way, so
  // Try Again is only offered when the underlying call would actually work.
  const ekycCanRetry = ekycOutcome === "failed" && (result?.document_type === "aadhaar_card" || result?.ekyc?.status === "failed");

  // Dedicated result screen for eKYC — the generic shared result screen
  // below (all other services) grew a lot of eKYC/DigiLocker-specific
  // branches over time and became hard to read as a single flow; every
  // field/handler used here (ekycOutcome, handleDigilockerVerify, etc.) is
  // unchanged from what the generic screen already used, this only
  // reorganizes the presentation into the requested
  // heading -> order info -> DigiLocker status -> actions -> result ->
  // navigation layout.
  if (result && isEkyc) {
    const isAadhaar = result.document_type === "aadhaar_card";
    const digilockerStatus = result.digilocker?.status; // undefined | link_generated | verified | failed
    const digilockerStatusLabel =
      digilockerStatus === "verified" ? "Verified"
      : digilockerStatus === "failed" ? "Failed"
      : digilockerStatus === "link_generated" ? "Link Generated"
      : "Pending";
    const digilockerStatusStyle =
      digilockerStatus === "verified" ? { background: theme.successSoft, color: theme.success, border: `1px solid ${theme.success}33` }
      : digilockerStatus === "failed" ? { background: theme.dangerSoft, color: theme.danger, border: `1px solid ${theme.danger}33` }
      : digilockerStatus === "link_generated" ? { background: theme.goldSoft, color: theme.navy, border: `1px solid ${theme.gold}66` }
      : { background: theme.bg, color: theme.slate, border: `1px solid ${theme.border}` };
    const resultFields = isAadhaar
      ? renderableEkycFields(result.digilocker?.aadhaar_data)
      : renderableEkycFields(result.ekyc?.extracted_data);
    // Backend-computed via the same _organization_bill_to/_is_karnataka/
    // _tax_split path get_or_create_invoice_for_order uses for the real
    // invoice (see get_partner_order_with_esign's eKYC branch) — so
    // total_amount here is guaranteed to match what actually gets debited
    // from the wallet, not a separately-reimplemented estimate.
    const gst = result.gst_breakup;

    return (
      <div>
        <div className="mb-6 pb-4 border-b" style={{ borderColor: theme.border }}>
          <button
            type="button"
            onClick={() => navigate("/user/orders/create/eKYC-bulk")}
            className="mb-3 text-sm font-semibold flex items-center gap-1"
            style={{ color: theme.navy }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
            Back
          </button>
          <h1 className="text-2xl font-bold" style={{ color: theme.ink, fontFamily: serif }}>eKYC Verification</h1>
          <p className="text-sm mt-1" style={{ color: theme.slate }}>
            {isAadhaar
              ? "Complete DigiLocker verification to fetch the customer's Aadhaar details."
              : "Verify the customer's PAN details."}
          </p>
        </div>

        <div className="rounded-lg p-6 max-w-2xl" style={{ background: theme.card, border: `1px solid ${theme.border}`, boxShadow: "0 1px 2px rgba(15,23,42,0.04)" }}>
          <div className="mb-6">
            <h2 className="text-xs font-semibold uppercase mb-3" style={{ color: theme.slate }}>Order Information</h2>
            <div className="rounded overflow-hidden" style={{ border: `1px solid ${theme.border}` }}>
              <div className="grid grid-cols-2 gap-4 text-sm p-4" style={{ background: theme.bg, borderBottom: `1px solid ${theme.border}` }}>
                <div><p className="text-xs font-semibold uppercase" style={{ color: theme.slate }}>Order ID</p><p style={{ color: theme.ink }}>{result.order_no}</p></div>
                <div><p className="text-xs font-semibold uppercase" style={{ color: theme.slate }}>Service</p><p style={{ color: theme.ink }}>{result.service_name}</p></div>
              </div>
              <div className="px-4">
                <div className="flex justify-between py-2.5 text-sm border-b" style={{ borderColor: theme.border }}>
                  <span style={{ color: theme.slate }}>Service Amount</span>
                  <span style={{ color: theme.ink }}>{formatCurrency(gst?.service_amount ?? result.amount)}</span>
                </div>
                {gst && (
                  <div className="flex justify-between py-2.5 text-sm border-b" style={{ borderColor: theme.border }}>
                    <span style={{ color: theme.slate }}>GST ({gst.gst_percentage}%)</span>
                    <span style={{ color: theme.ink }}>{formatCurrency(gst.cgst_amount + gst.sgst_amount + gst.igst_amount)}</span>
                  </div>
                )}
                <div className="flex justify-between py-2.5 text-sm">
                  <span className="font-semibold" style={{ color: theme.ink }}>Total Amount</span>
                  <span className="font-bold" style={{ color: theme.navy }}>{formatCurrency(gst?.total_amount ?? result.amount)}</span>
                </div>
              </div>
            </div>
          </div>

          {isAadhaar && (
            <div className="mb-6 rounded p-4" style={{ border: `1px solid ${theme.border}` }}>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-xs font-semibold uppercase" style={{ color: theme.slate }}>DigiLocker Verification</h2>
                <span className="inline-flex items-center px-2.5 py-1 rounded text-xs font-semibold" style={digilockerStatusStyle}>
                  {digilockerStatusLabel}
                </span>
              </div>

              <p className="text-sm mb-4" style={{ color: theme.ink }}>
                {!result.digilocker
                  ? "Complete DigiLocker verification to continue."
                  : digilockerStatus === "link_generated"
                    ? "Ask the customer to complete authentication on DigiLocker, then fetch their verified details."
                    : digilockerStatus === "verified"
                      ? "DigiLocker verification is complete."
                      : "The DigiLocker verification did not succeed — see the error below."}
              </p>

              {!result.digilocker ? (
                <button
                  type="button"
                  onClick={handleDigilockerVerify}
                  disabled={digilockerLoading}
                  className="px-5 py-2.5 rounded text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                  style={{ background: theme.navy }}
                >
                  {digilockerLoading ? "Generating link..." : "Start DigiLocker Verification"}
                </button>
              ) : digilockerStatus === "link_generated" ? (
                <div className="flex items-center gap-3">
                  <a
                    href={result.digilocker.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-5 py-2.5 rounded text-sm font-semibold text-white transition-opacity hover:opacity-90"
                    style={{ background: theme.navy }}
                  >
                    Reopen DigiLocker Login
                  </a>
                  <button
                    type="button"
                    onClick={handleFetchAadhaarDetails}
                    disabled={fetchingAadhaar}
                    className="px-5 py-2.5 rounded text-sm font-semibold disabled:opacity-60"
                    style={{ background: "#fff", color: theme.navy, border: `1px solid ${theme.navy}` }}
                  >
                    {fetchingAadhaar ? "Fetching..." : "Fetch Aadhaar Details"}
                  </button>
                </div>
              ) : null}

              {digilockerError && (
                <p className="text-sm mt-3 px-3 py-2 rounded" style={{ background: theme.dangerSoft, color: theme.danger, border: `1px solid ${theme.danger}33` }}>
                  {digilockerError}
                </p>
              )}
            </div>
          )}

          {ekycOutcome === "failed" && (
            <div className="mb-6 rounded p-4" style={{ background: theme.dangerSoft, border: `1px solid ${theme.danger}33` }}>
              <h2 className="text-sm font-bold mb-1" style={{ color: theme.danger, fontFamily: serif }}>Verification Failed</h2>
              <p className="text-sm" style={{ color: theme.ink }}>{ekycFailureReason || "Verification could not be completed."}</p>
              {error && <p className="text-xs mt-2" style={{ color: theme.danger }}>{error}</p>}
              {ekycCanRetry && (
                <button
                  type="button"
                  onClick={result.document_type === "aadhaar_card" ? handleDigilockerVerify : handleRetryEkycVerification}
                  disabled={result.document_type === "aadhaar_card" ? digilockerLoading : ekycRetrying}
                  className="mt-3 px-5 py-2.5 rounded text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                  style={{ background: theme.navy }}
                >
                  {(result.document_type === "aadhaar_card" ? digilockerLoading : ekycRetrying) ? "Retrying..." : "Try Again"}
                </button>
              )}
            </div>
          )}

          {ekycOutcome === "success" && (
            <div className="mb-6 text-center py-6 px-4 rounded-lg" style={{ background: theme.successSoft, border: `1px solid ${theme.success}33` }}>
              <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3" style={{ background: theme.success }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              </div>
              <h2 className="text-lg font-bold mb-1" style={{ color: theme.success, fontFamily: serif }}>Verification Successful</h2>
              <p className="text-sm" style={{ color: theme.ink }}>The customer's identity has been successfully verified.</p>
            </div>
          )}

          {resultFields.length > 0 && (
            <div className="mb-6">
              <h2 className="text-xs font-semibold uppercase mb-3" style={{ color: theme.slate }}>Verification Result</h2>
              <div className="rounded p-4" style={{ background: theme.bg, border: `1px solid ${theme.border}` }}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                  {resultFields.map(({ key, label, value }) => (
                    <div key={key} className="min-w-0">
                      <p className="text-xs font-semibold uppercase" style={{ color: theme.slate }}>{label}</p>
                      <p style={{ color: theme.ink, wordBreak: "break-all" }}>{value}</p>
                    </div>
                  ))}
                </div>
                {isAadhaar && result.digilocker?.aadhaar_last4 && (
                  <p className="text-xs mt-2" style={{ color: theme.slate }}>Aadhaar ending in {result.digilocker.aadhaar_last4}</p>
                )}
              </div>
            </div>
          )}

          <div className="pt-4 border-t flex justify-end gap-2" style={{ borderColor: theme.border }}>
            <button onClick={() => navigate("/user/orders")} className="px-5 py-2.5 rounded text-sm font-semibold" style={{ background: "#fff", color: theme.ink, border: `1px solid ${theme.border}` }}>
              View My Orders
            </button>
            <button onClick={handleCreateAnother} className="px-6 py-2.5 rounded text-sm font-semibold text-white" style={{ background: theme.navy }}>
              Create Another Order
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (result) {
    return (
      <div>
        <div className="mb-6 pb-4 border-b" style={{ borderColor: theme.border }}>
          {isEkyc && (
            <button
              type="button"
              onClick={() => navigate("/user/orders/create/eKYC-bulk")}
              className="mb-3 text-sm font-semibold flex items-center gap-1"
              style={{ color: theme.navy }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
              Back
            </button>
          )}
          <h1 className="text-2xl font-bold" style={{ color: theme.ink, fontFamily: serif }}>Create Order</h1>
        </div>
        <div className="rounded-lg p-6 max-w-2xl" style={{ background: theme.card, border: `1px solid ${theme.border}`, boxShadow: "0 1px 2px rgba(15,23,42,0.04)" }}>
          {ekycOutcome ? (
            <div className="mb-6 text-center py-6 px-4 rounded-lg" style={ekycOutcome === "success"
              ? { background: theme.successSoft, border: `1px solid ${theme.success}33` }
              : { background: theme.dangerSoft, border: `1px solid ${theme.danger}33` }}
            >
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3"
                style={{ background: ekycOutcome === "success" ? theme.success : theme.danger }}
              >
                {ekycOutcome === "success" ? (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                ) : (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                )}
              </div>
              <h2 className="text-lg font-bold mb-1" style={{ color: ekycOutcome === "success" ? theme.success : theme.danger, fontFamily: serif }}>
                eKYC Verification {ekycOutcome === "success" ? "Successful" : "Failed"}
              </h2>
              <p className="text-sm" style={{ color: theme.ink }}>
                {ekycOutcome === "success"
                  ? "Your identity has been successfully verified."
                  : "Your identity verification could not be completed. Please try again."}
              </p>
              {ekycOutcome === "failed" && ekycFailureReason && (
                <p className="text-xs mt-2" style={{ color: theme.slate }}>Reason: {ekycFailureReason}</p>
              )}
              {error && (
                <p className="text-xs mt-3 px-3 py-2 rounded inline-block" style={{ background: "#fff", color: theme.danger, border: `1px solid ${theme.danger}33` }}>{error}</p>
              )}
              <div className="mt-4 flex items-center justify-center gap-3">
                {ekycCanRetry && (
                  <button
                    type="button"
                    onClick={result.document_type === "aadhaar_card" ? handleDigilockerVerify : handleRetryEkycVerification}
                    disabled={result.document_type === "aadhaar_card" ? digilockerLoading : ekycRetrying}
                    className="px-5 py-2.5 rounded text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                    style={{ background: theme.navy }}
                  >
                    {(result.document_type === "aadhaar_card" ? digilockerLoading : ekycRetrying) ? "Retrying..." : "Try Again"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => navigate(`/user/orders/${result.id}`)}
                  className="px-5 py-2.5 rounded text-sm font-semibold text-white transition-opacity hover:opacity-90"
                  style={{ background: ekycOutcome === "success" ? theme.success : "#fff", color: ekycOutcome === "success" ? "#fff" : theme.ink, border: ekycOutcome === "success" ? "none" : `1px solid ${theme.border}` }}
                >
                  Continue
                </button>
              </div>
            </div>
          ) : needsDigilockerFirst ? (
            <p className="text-sm font-medium mb-5 px-4 py-3 rounded" style={{ background: theme.goldSoft, color: theme.navy, border: `1px solid ${theme.gold}66` }}>
              Document uploaded for {result.order_no} — complete DigiLocker verification below to place this order.
            </p>
          ) : (
            <p className="text-sm font-medium mb-5 px-4 py-3 rounded" style={{ background: theme.successSoft, color: theme.success, border: `1px solid ${theme.success}33` }}>
              Order {result.order_no} {result.status === "Draft" ? "saved as draft" : "placed"} successfully.
            </p>
          )}
          {esignError && (
            <p className="text-sm font-medium mb-5 px-4 py-3 rounded" style={{ background: theme.dangerSoft, color: theme.danger, border: `1px solid ${theme.danger}33` }}>
              Order was created, but sending it for eSign failed: {esignError}
            </p>
          )}
          {stampError && (
            <p className="text-sm font-medium mb-5 px-4 py-3 rounded" style={{ background: theme.dangerSoft, color: theme.danger, border: `1px solid ${theme.danger}33` }}>
              Order was created, but the eStamp request failed: {stampError}
            </p>
          )}
          {stampEsignError && (
            <p className="text-sm font-medium mb-5 px-4 py-3 rounded" style={{ background: theme.dangerSoft, color: theme.danger, border: `1px solid ${theme.danger}33` }}>
              The document was stamped, but sending it for eSign failed: {stampEsignError}
            </p>
          )}
          {stampOtfError && (
            <p className="text-sm font-medium mb-5 px-4 py-3 rounded" style={{ background: theme.dangerSoft, color: theme.danger, border: `1px solid ${theme.danger}33` }}>
              Order was created, but the eStamp On The Fly request failed: {stampOtfError}
            </p>
          )}
          {result.esignPending && (
            <p className="text-sm font-medium mb-5 px-4 py-3 rounded" style={{ background: theme.goldSoft, color: theme.navy, border: `1px solid ${theme.gold}66` }}>
              SignDesk is still procuring the stamp paper, so eSign wasn't sent — this can take up to 5–6 hours. Contact support once the stamp is ready to have it sent for signature.
            </p>
          )}
          {result.ekyc && (result.document_type === "aadhaar_card" || result.document_type === "pan_card") && (
            <div className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-semibold uppercase" style={{ color: theme.slate }}>DigiLocker Verification</h2>
                {result.digilocker && (
                  <span
                    className="inline-flex items-center px-2.5 py-1 rounded text-xs font-semibold capitalize"
                    style={result.digilocker.status === "verified"
                      ? { background: theme.successSoft, color: theme.success, border: `1px solid ${theme.success}33` }
                      : result.digilocker.status === "failed"
                        ? { background: theme.dangerSoft, color: theme.danger, border: `1px solid ${theme.danger}33` }
                        : { background: theme.goldSoft, color: theme.navy, border: `1px solid ${theme.gold}66` }}
                  >
                    {result.digilocker.status.replace(/_/g, " ")}
                  </span>
                )}
              </div>

              {digilockerError && (
                <p className="text-sm px-4 py-3 rounded mb-3" style={{ background: theme.dangerSoft, color: theme.danger, border: `1px solid ${theme.danger}33` }}>
                  {digilockerError}
                </p>
              )}

              {!result.digilocker ? (
                <>
                  <p className="text-xs mb-3" style={{ color: theme.slate }}>
                    Alternatively, verify the customer's Aadhaar directly through DigiLocker — no document upload needed.
                  </p>
                  <button
                    type="button"
                    onClick={handleDigilockerVerify}
                    disabled={digilockerLoading}
                    className="px-5 py-2.5 rounded text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                    style={{ background: theme.navy }}
                  >
                    {digilockerLoading ? "Generating link..." : "Verify with DigiLocker"}
                  </button>
                </>
              ) : result.digilocker.status === "link_generated" ? (
                <div className="space-y-3">
                  <p className="text-sm font-medium px-4 py-3 rounded" style={{ background: theme.successSoft, color: theme.success, border: `1px solid ${theme.success}33` }}>
                    DigiLocker login link generated. Ask the customer to complete authentication there, then fetch their details.
                  </p>
                  <div className="flex items-center gap-3">
                    <a href={result.digilocker.link} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold" style={{ color: theme.navy }}>
                      Reopen DigiLocker Login
                    </a>
                    <button
                      type="button"
                      onClick={handleFetchAadhaarDetails}
                      disabled={fetchingAadhaar}
                      className="px-4 py-2 rounded text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                      style={{ background: theme.navy }}
                    >
                      {fetchingAadhaar ? "Fetching..." : "Fetch Aadhaar Details"}
                    </button>
                  </div>
                </div>
              ) : result.digilocker.status === "verified" ? (
                // The "eKYC Verification Successful" banner above already
                // states the outcome — this is just the supplementary,
                // human-readable detail behind it, not a duplicate message.
                renderableEkycFields(result.digilocker.aadhaar_data).length > 0 && (
                  <div className="rounded p-4" style={{ background: theme.bg, border: `1px solid ${theme.border}` }}>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                      {renderableEkycFields(result.digilocker.aadhaar_data).map(({ key, label, value }) => (
                        <div key={key} className="min-w-0">
                          <p className="text-xs font-semibold uppercase" style={{ color: theme.slate }}>{label}</p>
                          <p style={{ color: theme.ink, wordBreak: "break-all" }}>{value}</p>
                        </div>
                      ))}
                    </div>
                    {result.digilocker.aadhaar_last4 && (
                      <p className="text-xs mt-2" style={{ color: theme.slate }}>Aadhaar ending in {result.digilocker.aadhaar_last4}</p>
                    )}
                  </div>
                )
              ) : null /* failed — already covered by the "eKYC Verification Failed" banner above, with its own Try Again action */}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div><p className="text-xs font-semibold uppercase" style={{ color: theme.slate }}>Order ID</p><p style={{ color: theme.ink }}>{result.order_no}</p></div>
            <div><p className="text-xs font-semibold uppercase" style={{ color: theme.slate }}>Service</p><p style={{ color: theme.ink }}>{result.service_name}</p></div>
            <div><p className="text-xs font-semibold uppercase" style={{ color: theme.slate }}>Copies</p><p style={{ color: theme.ink }}>{result.quantity}</p></div>
            <div><p className="text-xs font-semibold uppercase" style={{ color: theme.slate }}>Amount</p><p style={{ color: theme.ink }}>{formatCurrency(result.amount)}</p></div>
            <div><p className="text-xs font-semibold uppercase" style={{ color: theme.slate }}>Status</p><p style={{ color: theme.ink }}>{result.status}</p></div>
          </div>

          {result.wallet_balance_after !== undefined && (
            <div className="mt-5 rounded overflow-hidden" style={{ border: `1px solid ${theme.border}` }}>
              <div className="flex justify-between px-4 py-2.5 text-sm border-b" style={{ borderColor: theme.border }}>
                <span style={{ color: theme.slate }}>Deducted from Wallet</span>
                <span className="font-semibold" style={{ color: theme.danger }}>− {formatCurrency(result.amount)}</span>
              </div>
              <div className="flex justify-between px-4 py-2.5 text-sm" style={{ background: theme.bg }}>
                <span className="font-semibold" style={{ color: theme.ink }}>Remaining Wallet Balance</span>
                <span className="font-bold" style={{ color: theme.navy }}>{formatCurrency(result.wallet_balance_after)}</span>
              </div>
            </div>
          )}

          {result.ekyc && (
            <div className="mt-6">
              {result.document_type !== "pan_card" && (
                // For pan_card the "eKYC Verification Successful/Failed"
                // banner above already states the outcome in plain language
                // — this raw status chip would only repeat it in technical
                // (lowercase, API-status-string) form, so it's skipped there.
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-xs font-semibold uppercase" style={{ color: theme.slate }}>Verification Result</h2>
                  <span
                    className="inline-flex items-center px-2.5 py-1 rounded text-xs font-semibold capitalize"
                    style={result.ekyc.status === "success"
                      ? { background: theme.successSoft, color: theme.success, border: `1px solid ${theme.success}33` }
                      : { background: theme.dangerSoft, color: theme.danger, border: `1px solid ${theme.danger}33` }}
                  >
                    {result.ekyc.status}
                  </span>
                </div>
              )}
              {result.document_type === "pan_card" ? (
                // pan_card's General Document Verification result IS the
                // order's final outcome — already stated by the "eKYC
                // Verification Successful/Failed" banner above (with its own
                // Try Again on failure), so only the supplementary,
                // human-readable extracted fields go here, not another
                // status message.
                renderableEkycFields(result.ekyc.extracted_data).length > 0 && (
                  <div className="rounded p-4" style={{ background: theme.bg, border: `1px solid ${theme.border}` }}>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                      {renderableEkycFields(result.ekyc.extracted_data).map(({ key, label, value }) => (
                        <div key={key} className="min-w-0">
                          <p className="text-xs font-semibold uppercase" style={{ color: theme.slate }}>{label}</p>
                          <p style={{ color: theme.ink, wordBreak: "break-all" }}>{value}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              ) : result.ekyc.status !== "success" ? (
                <p className="text-sm px-4 py-3 rounded" style={{ background: theme.dangerSoft, color: theme.danger, border: `1px solid ${theme.danger}33` }}>
                  {result.ekyc.error || "Document verification failed."}
                </p>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm font-medium px-4 py-3 rounded" style={result.ekyc.verified
                    ? { background: theme.successSoft, color: theme.success, border: `1px solid ${theme.success}33` }
                    : { background: theme.bg, color: theme.slate, border: `1px solid ${theme.border}` }}>
                    {result.ekyc.verified ? "Document verified successfully." : "Document extracted, but was not verified against government records."}
                  </p>
                  {renderableEkycFields(result.ekyc.extracted_data).length > 0 && (
                    <div className="rounded p-4" style={{ background: theme.bg, border: `1px solid ${theme.border}` }}>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                        {renderableEkycFields(result.ekyc.extracted_data).map(({ key, label, value }) => (
                          <div key={key} className="min-w-0">
                            <p className="text-xs font-semibold uppercase" style={{ color: theme.slate }}>{label}</p>
                            <p style={{ color: theme.ink, wordBreak: "break-all" }}>{value}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {result.esign && (
            <div className="mt-6">
              <h2 className="text-xs font-semibold uppercase mb-2" style={{ color: theme.slate }}>Signers</h2>
              <div className="space-y-2">
                {result.esign.signers.map((s) => (
                  <div key={s.id} className="flex items-center justify-between gap-3 px-4 py-3 rounded" style={{ background: theme.bg, border: `1px solid ${theme.border}` }}>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate" style={{ color: theme.ink }}>{s.signer_name}</p>
                      <p className="text-xs truncate" style={{ color: theme.slate }}>{s.signer_email}</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {s.invitation_link && (
                        <a href={s.invitation_link} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold" style={{ color: theme.navy }}>
                          Invitation Link
                        </a>
                      )}
                      {signerStatusBadge(s.status)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {result.stamp && (
            <div className="mt-6">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-semibold uppercase" style={{ color: theme.slate }}>eStamp Request</h2>
                <span
                  className="inline-flex items-center px-2.5 py-1 rounded text-xs font-semibold capitalize"
                  style={result.stamp.status === "completed"
                    ? { background: theme.successSoft, color: theme.success, border: `1px solid ${theme.success}33` }
                    : result.stamp.status === "failed"
                      ? { background: theme.dangerSoft, color: theme.danger, border: `1px solid ${theme.danger}33` }
                      : { background: theme.goldSoft, color: theme.navy, border: `1px solid ${theme.gold}66` }}
                >
                  {result.stamp.status}
                </span>
              </div>
              {result.stamp.status === "completed" ? (
                <div className="space-y-3">
                  <p className="text-sm font-medium px-4 py-3 rounded" style={{ background: theme.successSoft, color: theme.success, border: `1px solid ${theme.success}33` }}>
                    Stamp paper attached{result.stamp.stamp_paper_number ? ` — number ${result.stamp.stamp_paper_number}` : ""}.
                  </p>
                  <button
                    type="button"
                    onClick={handleDownloadStampedDocument}
                    disabled={stampDownloading}
                    className="px-5 py-2.5 rounded text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                    style={{ background: theme.navy }}
                  >
                    {stampDownloading ? "Downloading..." : "Download Stamped Document"}
                  </button>
                </div>
              ) : result.stamp.status === "failed" ? (
                <p className="text-sm px-4 py-3 rounded" style={{ background: theme.dangerSoft, color: theme.danger, border: `1px solid ${theme.danger}33` }}>
                  {result.stamp.message || "The eStamp request failed."}
                </p>
              ) : (
                <p className="text-sm px-4 py-3 rounded" style={{ background: theme.bg, color: theme.slate, border: `1px solid ${theme.border}` }}>
                  SignDesk has accepted the request and is procuring the stamp paper — this can take up to 5–6 hours.
                  Reference ID: {result.stamp.reference_id}.
                </p>
              )}
            </div>
          )}

          {result.stampOtf && (
            <div className="mt-6">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-semibold uppercase" style={{ color: theme.slate }}>eStamp On The Fly Request</h2>
                <span
                  className="inline-flex items-center px-2.5 py-1 rounded text-xs font-semibold capitalize"
                  style={result.stampOtf.status === "completed"
                    ? { background: theme.successSoft, color: theme.success, border: `1px solid ${theme.success}33` }
                    : result.stampOtf.status === "failed"
                      ? { background: theme.dangerSoft, color: theme.danger, border: `1px solid ${theme.danger}33` }
                      : { background: theme.goldSoft, color: theme.navy, border: `1px solid ${theme.gold}66` }}
                >
                  {result.stampOtf.status}
                </span>
              </div>
              {result.stampOtf.status === "completed" ? (
                <div className="space-y-3">
                  <p className="text-sm font-medium px-4 py-3 rounded" style={{ background: theme.successSoft, color: theme.success, border: `1px solid ${theme.success}33` }}>
                    Stamp paper attached{result.stampOtf.stamp_paper_number ? ` — number ${result.stampOtf.stamp_paper_number}` : ""}.
                  </p>
                  <button
                    type="button"
                    onClick={handleDownloadOtfStampedDocument}
                    disabled={stampOtfDownloading}
                    className="px-5 py-2.5 rounded text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                    style={{ background: theme.navy }}
                  >
                    {stampOtfDownloading ? "Downloading..." : "Download Stamped Document"}
                  </button>
                </div>
              ) : result.stampOtf.status === "failed" ? (
                <p className="text-sm px-4 py-3 rounded" style={{ background: theme.dangerSoft, color: theme.danger, border: `1px solid ${theme.danger}33` }}>
                  {result.stampOtf.message || "The eStamp On The Fly request failed."}
                </p>
              ) : (
                <p className="text-sm px-4 py-3 rounded" style={{ background: theme.bg, color: theme.slate, border: `1px solid ${theme.border}` }}>
                  SignDesk has accepted the request and is procuring the stamp paper — this can take up to 5–6 hours.
                  Reference ID: {result.stampOtf.reference_id}.
                </p>
              )}
            </div>
          )}

          <div className="mt-6 flex justify-end gap-2">
            <button onClick={() => navigate("/user/orders")} className="px-5 py-2.5 rounded text-sm font-semibold" style={{ background: "#fff", color: theme.ink, border: `1px solid ${theme.border}` }}>
              View My Orders
            </button>
            <button onClick={handleCreateAnother} className="px-6 py-2.5 rounded text-sm font-semibold text-white" style={{ background: theme.navy }}>
              Create Another Order
            </button>
          </div>
        </div>
      </div>
    );
  }

  // The Loan Document flow collects a lot of fields (per-type sections,
  // borrower details, repayment & security) — render it full width instead
  // of the compact max-w-2xl used by every other order form.
  const isLoanFlowView = (isDocumentService && selectedDocument && (selectedDocument.category_name === 'Loan Documents' || selectedDocument.doc_name.toLowerCase().includes('loan'))) || (form.service_name && form.service_name.toLowerCase().includes('loan'));

  return (
    <div>
      <div className="mb-6 pb-4 border-b" style={{ borderColor: theme.border }}>
        {isEkyc && (
          <button
            type="button"
            onClick={() => navigate("/user/orders/create/eKYC-bulk")}
            className="mb-3 text-sm font-semibold flex items-center gap-1"
            style={{ color: theme.navy }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
            Back
          </button>
        )}
        <h1 className="text-2xl font-bold" style={{ color: theme.ink, fontFamily: serif }}>{isEkyc ? "eKYC Verification" : "Create Order"}</h1>
        <p className="text-sm mt-1" style={{ color: theme.slate }}>
          {isEkyc ? "Enter the customer's details to begin eKYC verification." : "Submit a new order using the services assigned to you"}
        </p>
      </div>

      <div className={"rounded-lg p-6 " + (isLoanFlowView ? "w-full max-w-none" : "max-w-2xl")} style={{ background: theme.card, border: `1px solid ${theme.border}`, boxShadow: "0 1px 2px rgba(15,23,42,0.04)" }}>
        {error && <p className="text-xs font-medium mb-4 px-3 py-2 rounded" style={{ background: theme.goldSoft, color: theme.navy, border: `1px solid ${theme.gold}66` }}>{error}</p>}

        {!servicesLoading && services.length === 0 && (
          <p className="text-xs font-medium mb-4 px-3 py-2 rounded" style={{ background: theme.dangerSoft, color: theme.danger, border: `1px solid ${theme.danger}33` }}>
            No services have been assigned to you yet. Contact your Partner admin.
          </p>
        )}

        {isUnsupported ? (
          <p className="text-sm font-medium px-4 py-3 rounded" style={{ background: theme.dangerSoft, color: theme.danger, border: `1px solid ${theme.danger}33` }}>
            "{form.service_name}" isn't set up for ordering yet — contact support to get it configured before placing an order for it.
          </p>
        ) : isDocumentService && !selectedDocument ? (
          <>
            <SectionLabel>Select a Document</SectionLabel>
            <p className="text-xs mb-4" style={{ color: theme.slate }}>Choose the document you want to create an order for.</p>
            {documents.length === 0 ? (
              <p className="text-xs font-medium px-3 py-2 rounded" style={{ background: theme.dangerSoft, color: theme.danger, border: `1px solid ${theme.danger}33` }}>
                No documents have been configured for you yet. Contact your Partner admin.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                {documents.map((d) => {
                  const externalType = externalDocumentType(d.doc_name);
                  return (
                    <button
                      key={d.document_config_id}
                      type="button"
                      onClick={() => {
                        if (externalType) {
                          window.open(`${EXTERNAL_DOCUMENT_BUILDER_BASE}?type=${externalType}`, "_blank", "noopener,noreferrer");
                        } else {
                          setSelectedDocument(d);
                        }
                      }}
                      className="text-left p-4 rounded-lg transition-all hover:shadow-md"
                      style={{ background: theme.bg, border: `1px solid ${theme.border}` }}
                    >
                      <p className="text-sm font-semibold mb-1" style={{ color: theme.ink }}>{d.doc_name}</p>
                      {d.state_name && <p className="text-xs mb-2" style={{ color: theme.slate }}>{d.state_name}</p>}
                      <p className="text-sm font-semibold" style={{ color: theme.navy }}>{d.base_price != null ? formatCurrency(d.base_price) : "-"}</p>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        ) : (isDocumentService && selectedDocument && (selectedDocument.category_name === 'Loan Documents' || selectedDocument.doc_name.toLowerCase().includes('loan'))) || (form.service_name && form.service_name.toLowerCase().includes('loan')) ? (
          <LoanDocumentFlow
            document={selectedDocument || { doc_name: form.service_name, config_id: null, doc_id: null, available_languages: ["English", "Hindi", "Kannada", "Marathi"] }}
            ekycService={services.find((s) => s.service_name === "eKYC")}
            onCancel={() => {
              if (selectedDocument) setSelectedDocument(null);
              else setForm(prev => ({ ...prev, service_name: "" }));
            }}
            onSubmitOrder={async (loanData) => {
              setSaving(true);
              setError("");
              setEsignError("");
              try {
                const fd = new FormData();
                fd.append("service_name", form.service_name);
                fd.append("customer_name", loanData.customer_name);
                if (loanData.customer_email) fd.append("customer_email", loanData.customer_email);
                fd.append("customer_mobile", loanData.customer_mobile || "9999999999");
                fd.append("document", loanData.file);
                if (loanData.loan_details) {
                  fd.append("loan_details", JSON.stringify(loanData.loan_details));
                }

                const order = await apiUpload("/api/partner-user/orders", fd);
                window.dispatchEvent(new Event("wallet:updated"));

                if (loanData.requireEsign) {
                  try {
                    // Loan Application flow may pass one signer per party
                    // (Applicant/Co-Applicant(s)/Guarantor(s) — see
                    // LoanDocumentFlow.jsx's `signers` array); any other
                    // Document Service caller falls back to the single
                    // customer signer, as before.
                    const signers = loanData.signers?.length ? loanData.signers : [{
                      name: loanData.customer_name,
                      mobile: loanData.customer_mobile,
                      email: loanData.customer_email || null,
                      position: "bottom-right"
                    }];
                    const esign = await apiRequest(`/api/partner-user/orders/${order.id}/esign/initiate`, {
                      method: "POST",
                      body: JSON.stringify({ signers }),
                    });
                    setResult({ ...order, esign });
                  } catch (esignErr) {
                    setEsignError(esignErr.message);
                    setResult(order);
                  }
                } else {
                  setResult(order);
                }
              } catch (err) {
                setError(err.message);
              } finally {
                setSaving(false);
              }
            }} 
          />
        ) : (
          <>
        <SectionLabel>Order Details</SectionLabel>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {preselectedService ? (
            <Field label="Service">
              <p className="text-sm font-semibold py-2.5" style={{ color: theme.ink }}>{isDocumentService && selectedDocument ? selectedDocument.doc_name : form.service_name}</p>
              {isDocumentService && selectedDocument && (
                <button type="button" onClick={() => setSelectedDocument(null)} className="text-xs font-semibold mt-1" style={{ color: theme.navy }}>
                  Change document
                </button>
              )}
            </Field>
          ) : (
            <Field label="Select Service *">
              <select name="service_name" value={form.service_name} onChange={handleChange} disabled={servicesLoading} className={inputClass} style={inputStyle}>
                <option value="">{servicesLoading ? "Loading..." : "Select a service"}</option>
                {services.map((s) => (
                  <option key={s.service_name} value={s.service_name}>{s.service_name}</option>
                ))}
              </select>
            </Field>
          )}
          {!isEsign && !isEStamp && !isEStampOnTheFly && !isEkyc && (
            <Field label="Number of Copies *">
              <input type="number" min="1" step="1" value={copies} onChange={(e) => setCopies(e.target.value)} className={inputClass} style={inputStyle} />
            </Field>
          )}
          {!isEsign && !isEkyc && (
            <Field label="Price">
              <p className="text-sm font-semibold py-2.5" style={{ color: theme.ink }}>
                {isEStamp || isEStampOnTheFly
                  ? (selectedService?.price == null ? "-" : formatCurrency(selectedService.price))
                  : isDocumentService && selectedDocument
                    ? (selectedDocument.base_price == null
                        ? "-"
                        : `${formatCurrency(selectedDocument.base_price)} × ${copiesCount || 0} = ${formatCurrency(selectedDocument.base_price * copiesCount)}`)
                    : selectedService?.price == null
                      ? "-"
                      : `${formatCurrency(selectedService.price)} × ${copiesCount || 0} = ${formatCurrency(totalAmount ?? 0)}`}
              </p>
            </Field>
          )}
        </div>

        {!isEsign && (
          <>
            <div className="mt-6 pt-5 border-t" style={{ borderColor: theme.border }}>
              <SectionLabel>Customer Details</SectionLabel>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Customer Name *" error={isEkyc ? ekycFieldErrors.customerName : undefined}>
                  <SuggestInput type="text" name="customer_name" value={form.customer_name} onChange={(v) => updateCustomerField("customer_name", v)} placeholder="e.g. Rahul Sharma" className={inputClass} style={inputStyle} />
                </Field>
                {!isEkyc && (
                  <Field label="Customer Email *">
                    <SuggestInput type="email" name="customer_email" value={form.customer_email} onChange={(v) => updateCustomerField("customer_email", v)} placeholder="customer@email.com" className={inputClass} style={inputStyle} />
                  </Field>
                )}
                <Field label="Customer Mobile *" error={isEkyc ? ekycFieldErrors.customerMobile : undefined}>
                  <SuggestInput type="text" inputMode="numeric" maxLength={10} name="customer_mobile" value={form.customer_mobile} onChange={(v) => updateCustomerField("customer_mobile", v)} placeholder="9876543210" className={inputClass} style={inputStyle} />
                </Field>
              </div>
            </div>
          </>
        )}

        <div className="mt-6 pt-5 border-t" style={{ borderColor: theme.border }}>
          <SectionLabel>Document</SectionLabel>
          {isEkyc && (
            <div className="mb-4">
              <Field label="Document Type *" error={ekycFieldErrors.docType}>
                <select
                  value={docType}
                  onChange={(e) => {
                    setDocType(e.target.value);
                    setEkycFieldErrors((prev) => (prev.docType ? { ...prev, docType: undefined } : prev));
                  }}
                  className={inputClass} style={inputStyle}
                >
                  <option value="">Select document type</option>
                  {EKYC_DOC_TYPES.map((d) => (
                    <option key={d.value} value={d.value}>{d.label}</option>
                  ))}
                </select>
              </Field>
            </div>
          )}
          <Field label="Upload Document *" error={isEsign ? esignFieldErrors.document : isEkyc ? ekycFieldErrors.document : undefined}>
            <input
              type="file"
              accept={isEsign || isEStamp || isEStampOnTheFly ? "application/pdf" : isEkyc ? "image/jpeg,image/png,application/pdf" : undefined}
              onChange={(e) => {
                setFile(e.target.files?.[0] || null);
                if (isEsign) setEsignFieldErrors((prev) => ({ ...prev, document: undefined }));
                if (isEkyc) setEkycFieldErrors((prev) => (prev.document ? { ...prev, document: undefined } : prev));
              }}
              className={inputClass}
              style={inputStyle}
            />
          </Field>
          {isEsign && <p className="text-xs mt-1.5" style={{ color: theme.slate }}>PDF only — this is the document each signer below will e-sign.</p>}
          {isEkyc && <p className="text-xs mt-1.5" style={{ color: theme.slate }}>JPG, PNG or PDF — this is verified against the document type selected above.</p>}
          {(isEStamp || isEStampOnTheFly) && <p className="text-xs mt-1.5" style={{ color: theme.slate }}>PDF only — the requested stamp paper is attached to this document.</p>}
        </div>

        {isEStamp && (
          <div className="mt-6 pt-5 border-t space-y-4" style={{ borderColor: theme.border }}>
            <div className="flex items-center justify-between">
              <SectionLabel>Stamp Paper Details</SectionLabel>
              {stampDraft && (
                <button
                  type="button"
                  onClick={handleUseLastStampData}
                  className="text-xs font-semibold mb-3"
                  style={{ color: theme.navy }}
                >
                  Use last entered test data
                </button>
              )}
            </div>

            <Field label="Stamp State *">
              <select value={stampDetails.stamp_state} onChange={(e) => updateStampDetail("stamp_state", e.target.value)} className={inputClass} style={inputStyle}>
                <option value="">Select state</option>
                {STAMP_STATES.map((s) => (<option key={s.value} value={s.label}>{s.label}</option>))}
              </select>
            </Field>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Document Category *">
                <SuggestInput
                  type="text"
                  name="estamp_document_category"
                  value={stampDetails.document_category_label}
                  onChange={handleDocumentCategoryChange}
                  options={DOCUMENT_CATEGORY_LABELS}
                  remember={false}
                  placeholder="Type to search..."
                  className={inputClass}
                  style={inputStyle}
                />
              </Field>
              <Field label="Stamp Amount (₹) *">
                <SuggestInput type="number" name="estamp_stamp_amount" min="1" step="1" value={stampDetails.stamp_amount} onChange={(v) => updateStampDetail("stamp_amount", v)} className={inputClass} style={inputStyle} />
              </Field>
              <Field label="Consideration Amount (₹) *">
                <SuggestInput type="number" name="estamp_consideration_amount" min="1" step="1" value={stampDetails.consideration_amount} onChange={(v) => updateStampDetail("consideration_amount", v)} className={inputClass} style={inputStyle} />
              </Field>
              <Field label="Stamp Duty Paid By *">
                <select value={stampDetails.stamp_duty_paid_by} onChange={(e) => updateStampDetail("stamp_duty_paid_by", e.target.value)} className={inputClass} style={inputStyle}>
                  <option value="First Party">First Party</option>
                  <option value="Second Party">Second Party</option>
                </select>
              </Field>
              <Field label="Duty Payer Mobile *">
                <SuggestInput type="text" name="estamp_duty_payer_mobile" inputMode="numeric" maxLength={10} value={stampDetails.duty_payer_phone_number} onChange={(v) => updateStampDetail("duty_payer_phone_number", sanitizeMobileInput(v))} placeholder="9876543210" className={inputClass} style={inputStyle} />
              </Field>
              <Field label={stampDetails.stamp_duty_paid_by === "Second Party" ? "Duty Payer Email *" : "Duty Payer Email"}>
                <SuggestInput type="email" name="estamp_duty_payer_email" value={stampDetails.duty_payer_email_id} onChange={(v) => updateStampDetail("duty_payer_email_id", v)} placeholder="payer@email.com" className={inputClass} style={inputStyle} />
              </Field>
              {stampDetails.stamp_state === "Rajasthan" && (
                <Field label="Surcharge (₹) *">
                  <SuggestInput type="number" name="estamp_surcharge" min="0" step="1" value={stampDetails.surcharge} onChange={(v) => updateStampDetail("surcharge", v)} className={inputClass} style={inputStyle} />
                </Field>
              )}
            </div>

            <PartyFields
              label="First Party *"
              namePrefix="estamp_first_party"
              party={firstParty}
              onChange={(field, value) => updateParty("first", field, value)}
              onAddressChange={(field, value) => updatePartyAddress("first", field, value)}
            />
            <PartyFields
              label="Second Party *"
              namePrefix="estamp_second_party"
              party={secondParty}
              onChange={(field, value) => updateParty("second", field, value)}
              onAddressChange={(field, value) => updatePartyAddress("second", field, value)}
            />

            <div className="pt-4 border-t" style={{ borderColor: theme.border }}>
              <SectionLabel>eSign Option</SectionLabel>
              <Field label="Do you require eSign after stamping?">
                <div className="flex gap-2">
                  {[{ value: false, label: "No" }, { value: true, label: "Yes" }].map((opt) => (
                    <button
                      key={String(opt.value)}
                      type="button"
                      onClick={() => setWantEsignAfterStamp(opt.value)}
                      className="px-4 py-2 rounded text-sm font-semibold border transition-colors"
                      style={
                        wantEsignAfterStamp === opt.value
                          ? { background: theme.navy, color: "#fff", borderColor: theme.navy }
                          : { background: "#fff", color: theme.ink, borderColor: theme.border }
                      }
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </Field>

              {wantEsignAfterStamp && (
                <div className="mt-4 space-y-3">
                  <p className="text-xs" style={{ color: theme.slate }}>
                    Once the stamp paper is attached, the stamped document is sent straight to these signers for eSign.
                  </p>
                  <Field label="Number of Signers *">
                    <select
                      value={String(stampEsignSigners.length)}
                      onChange={(e) => handleStampEsignSignerCountChange(e.target.value)}
                      className={inputClass}
                      style={{ ...inputStyle, maxWidth: 160 }}
                    >
                      {[1, 2, 3, 4].map((n) => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                  </Field>
                  {stampEsignSigners.map((signer, index) => (
                    <div key={index} className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end p-3 rounded" style={{ background: theme.bg, border: `1px solid ${theme.border}` }}>
                      <Field label={`Signer ${index + 1} Name`}>
                        <input type="text" autoComplete="off" value={signer.name} onChange={(e) => updateStampEsignSigner(index, "name", e.target.value)} placeholder="Full name" className={inputClass} style={{ ...inputStyle, background: "#fff" }} />
                      </Field>
                      <Field label="Email">
                        {/* type="text" (not "email") deliberately — Chrome
                            uses type="email" as a strong signal to offer its
                            own contact-info autofill and ignores
                            autoComplete="off" for that case; format is still
                            enforced by isValidEmail on change/submit. */}
                        <input type="text" inputMode="email" autoComplete="off" name={`stamp-esign-signer-email-${index}`} value={signer.email} onChange={(e) => updateStampEsignSigner(index, "email", e.target.value)} placeholder="signer@email.com" className={inputClass} style={{ ...inputStyle, background: "#fff" }} />
                      </Field>
                      <Field label="Mobile">
                        <input type="text" inputMode="numeric" maxLength={10} autoComplete="off" value={signer.mobile} onChange={(e) => updateStampEsignSigner(index, "mobile", e.target.value)} placeholder="9876543210" className={inputClass} style={{ ...inputStyle, background: "#fff" }} />
                      </Field>
                      <Field label="Signature Position">
                        <select value={signer.position} onChange={(e) => updateStampEsignSigner(index, "position", e.target.value)} className={inputClass} style={{ ...inputStyle, background: "#fff" }}>
                          {SIGNATURE_POSITIONS.map((p) => (
                            <option key={p.value} value={p.value}>{p.label}</option>
                          ))}
                        </select>
                      </Field>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {isEStampOnTheFly && (
          <div className="mt-6 pt-5 border-t space-y-4" style={{ borderColor: theme.border }}>
            <div className="flex items-center justify-between">
              <SectionLabel>Stamp Paper Details (On The Fly)</SectionLabel>
              {/* {stampOtfDraft && (
                <button
                  type="button"
                  onClick={handleUseLastStampOtfData}
                  className="text-xs font-semibold mb-3"
                  style={{ color: theme.navy }}
                >
                  Use last entered test data
                </button>
              )} */}
            </div>

            <Field label="State *">
              <select value={stampOtfDetails.stamp_state} onChange={(e) => updateOtfState(e.target.value)} className={inputClass} style={inputStyle}>
                <option value="Karnataka">Karnataka</option>
                <option value="Tamil Nadu">Tamil Nadu</option>
                <option value="Delhi">Delhi</option>
                <option value="Maharashtra">Maharashtra (eSBTR)</option>
              </select>
            </Field>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {stampOtfDetails.stamp_state === "Maharashtra" ? (
                <Field label="Document Category *">
                  <SuggestInput
                    type="text"
                    name="estamp_otf_document_category"
                    value={stampOtfDetails.document_category_label}
                    onChange={handleOtfDocumentCategoryChange}
                    options={DOCUMENT_CATEGORY_LABELS}
                    remember={false}
                    placeholder="Type to search..."
                    className={inputClass}
                    style={inputStyle}
                  />
                </Field>
              ) : (
                <>
                  <Field label="Article Code *">
                    <KarnatakaArticleCodePicker
                      state={stampOtfDetails.stamp_state}
                      value={stampOtfDetails.digital_article_code}
                      onChange={updateOtfArticleCode}
                      className={inputClass}
                      style={inputStyle}
                    />
                  </Field>
                  <Field label="Document Category (auto-filled)">
                    <p className="text-sm py-2.5" style={{ color: theme.slate }}>
                      {stampOtfDetails.document_category_label || "Select an article code first"}
                    </p>
                  </Field>
                </>
              )}
              <Field label="Stamp Amount (₹) *">
                <SuggestInput type="number" name="estamp_otf_stamp_amount" min="1" step="1" value={stampOtfDetails.stamp_amount} onChange={(v) => updateStampOtfDetail("stamp_amount", v)} className={inputClass} style={inputStyle} />
              </Field>
              <Field label="Consideration Amount (₹) *">
                <SuggestInput type="number" name="estamp_otf_consideration_amount" min="1" step="1" value={stampOtfDetails.consideration_amount} onChange={(v) => updateStampOtfDetail("consideration_amount", v)} className={inputClass} style={inputStyle} />
              </Field>
              <Field label="Stamp Duty Paid By *">
                <select value={stampOtfDetails.stamp_duty_paid_by} onChange={(e) => updateStampOtfDetail("stamp_duty_paid_by", e.target.value)} className={inputClass} style={inputStyle}>
                  <option value="First Party">First Party</option>
                  <option value="Second Party">Second Party</option>
                </select>
              </Field>
              <Field label="Duty Payer Mobile *">
                <SuggestInput type="text" name="estamp_otf_duty_payer_mobile" inputMode="numeric" maxLength={10} value={stampOtfDetails.duty_payer_phone_number} onChange={(v) => updateStampOtfDetail("duty_payer_phone_number", sanitizeMobileInput(v))} placeholder="9876543210" className={inputClass} style={inputStyle} />
              </Field>
              <Field label={stampOtfDetails.stamp_duty_paid_by === "Second Party" ? "Duty Payer Email *" : "Duty Payer Email"}>
                <SuggestInput type="email" name="estamp_otf_duty_payer_email" value={stampOtfDetails.duty_payer_email_id} onChange={(v) => updateStampOtfDetail("duty_payer_email_id", v)} placeholder="payer@email.com" className={inputClass} style={inputStyle} />
              </Field>
            </div>

            {stampOtfDetails.stamp_state === "Maharashtra" && (
              <div className="p-3 rounded space-y-3" style={{ background: theme.bg, border: `1px solid ${theme.border}` }}>
                <p className="text-xs font-semibold uppercase" style={{ color: theme.slate }}>eSBTR Property Details</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Field label="District *">
                    <select value={stampOtfDetails.esbtr_district} onChange={(e) => updateOtfDistrict(e.target.value)} className={inputClass} style={{ ...inputStyle, background: "#fff" }}>
                      <option value="">Select district</option>
                      {MAHARASHTRA_DISTRICT_NAMES.map((d) => (<option key={d} value={d}>{d}</option>))}
                    </select>
                  </Field>
                  <Field label="Sub Registrar Office *">
                    <select
                      value={stampOtfDetails.esbtr_sub_registrar_office}
                      onChange={(e) => updateStampOtfDetail("esbtr_sub_registrar_office", e.target.value)}
                      disabled={!stampOtfDetails.esbtr_district}
                      className={inputClass}
                      style={{ ...inputStyle, background: "#fff" }}
                    >
                      <option value="">{stampOtfDetails.esbtr_district ? "Select office" : "Select a district first"}</option>
                      {(MAHARASHTRA_DISTRICTS[stampOtfDetails.esbtr_district] || []).map((o) => (<option key={o} value={o}>{o}</option>))}
                    </select>
                  </Field>
                  <Field label="Property Address Line 1 *">
                    <SuggestInput type="text" name="esbtr_addressline_1" value={stampOtfDetails.esbtr_addressline_1} onChange={(v) => updateStampOtfDetail("esbtr_addressline_1", v)} className={inputClass} style={{ ...inputStyle, background: "#fff" }} />
                  </Field>
                  <Field label="Road *">
                    <SuggestInput type="text" name="esbtr_road" value={stampOtfDetails.esbtr_road} onChange={(v) => updateStampOtfDetail("esbtr_road", v)} className={inputClass} style={{ ...inputStyle, background: "#fff" }} />
                  </Field>
                  <Field label="Town / Village *">
                    <SuggestInput type="text" name="esbtr_town_village" value={stampOtfDetails.esbtr_town_village} onChange={(v) => updateStampOtfDetail("esbtr_town_village", v)} className={inputClass} style={{ ...inputStyle, background: "#fff" }} />
                  </Field>
                  <Field label="Pincode *">
                    <SuggestInput type="text" name="esbtr_pincode" inputMode="numeric" maxLength={6} value={stampOtfDetails.esbtr_pincode} onChange={(v) => updateStampOtfDetail("esbtr_pincode", v)} className={inputClass} style={{ ...inputStyle, background: "#fff" }} />
                  </Field>
                  <Field label="Property Area *">
                    <SuggestInput type="number" name="esbtr_property_area" min="0" value={stampOtfDetails.esbtr_property_area} onChange={(v) => updateStampOtfDetail("esbtr_property_area", v)} className={inputClass} style={{ ...inputStyle, background: "#fff" }} />
                  </Field>
                  <Field label="Property Area Unit *">
                    <select value={stampOtfDetails.esbtr_property_area_unit} onChange={(e) => updateStampOtfDetail("esbtr_property_area_unit", e.target.value)} className={inputClass} style={{ ...inputStyle, background: "#fff" }}>
                      <option value="">Select unit</option>
                      {PROPERTY_AREA_UNITS.map((u) => (<option key={u} value={u}>{u}</option>))}
                    </select>
                  </Field>
                </div>
              </div>
            )}

            <PartyFields
              label="First Party *"
              namePrefix="estamp_otf_first_party"
              party={otfFirstParty}
              onChange={(field, value) => updateOtfParty("first", field, value)}
              onAddressChange={(field, value) => updateOtfPartyAddress("first", field, value)}
            />
            <PartyFields
              label="Second Party *"
              namePrefix="estamp_otf_second_party"
              party={otfSecondParty}
              onChange={(field, value) => updateOtfParty("second", field, value)}
              onAddressChange={(field, value) => updateOtfPartyAddress("second", field, value)}
            />
          </div>
        )}

        {isEsign && (
          <div className="mt-6 pt-5 border-t" style={{ borderColor: theme.border }}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Number of Signers *">
                <select value={copies} onChange={(e) => handleSignerCountChange(e.target.value)} className={inputClass} style={inputStyle}>
                  {[1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </Field>
              <Field label="Price">
                <p className="text-sm font-semibold py-2.5" style={{ color: theme.ink }}>
                  {selectedService?.price == null ? "-" : `${formatCurrency(selectedService.price)} × ${copiesCount || 0} = ${formatCurrency(totalAmount ?? 0)}`}
                </p>
              </Field>
            </div>
          </div>
        )}

        {isEsign && (
          <div className="mt-6 pt-5 border-t" style={{ borderColor: theme.border }}>
            <SectionLabel>Signers *</SectionLabel>
            <div className="space-y-3">
              {signers.map((signer, index) => {
                const signerErrors = esignFieldErrors.signers?.[index] || {};
                return (
                <div key={index} className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end p-3 rounded" style={{ background: theme.bg, border: `1px solid ${theme.border}` }}>
                  <Field label={`${ordinal(index + 1)} Signer`} error={signerErrors.name}>
                    <input type="text" autoComplete="off" value={signer.name} onChange={(e) => updateSigner(index, "name", e.target.value)} placeholder="Full name" className={inputClass} style={{ ...inputStyle, background: "#fff" }} />
                  </Field>
                  <Field label="Email" error={signerErrors.email}>
                    {/* type="text" (not "email") deliberately — Chrome uses
                        type="email" as a strong signal to offer its own
                        contact-info autofill and ignores autoComplete="off"
                        for that case; format is still enforced by
                        isValidEmail on change/submit. */}
                    <input type="text" inputMode="email" autoComplete="off" name={`esign-signer-email-${index}`} value={signer.email} onChange={(e) => updateSigner(index, "email", e.target.value)} placeholder="signer@email.com" className={inputClass} style={{ ...inputStyle, background: "#fff" }} />
                  </Field>
                  <Field label="Mobile" error={signerErrors.mobile}>
                    <input type="text" inputMode="numeric" maxLength={10} autoComplete="off" value={signer.mobile} onChange={(e) => updateSigner(index, "mobile", e.target.value)} placeholder="9876543210" className={inputClass} style={{ ...inputStyle, background: "#fff" }} />
                  </Field>
                  <Field label="Signature Position" error={signerErrors.position}>
                    <select value={signer.position} onChange={(e) => updateSigner(index, "position", e.target.value)} className={inputClass} style={{ ...inputStyle, background: "#fff" }}>
                      {SIGNATURE_POSITIONS.map((p) => (
                        <option key={p.value} value={p.value}>{p.label}</option>
                      ))}
                    </select>
                  </Field>
                </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="mt-6 pt-5 border-t" style={{ borderColor: theme.border }}>
          <SectionLabel>Order Summary</SectionLabel>
          <div className="rounded p-4 space-y-2 text-sm" style={{ background: theme.bg, border: `1px solid ${theme.border}` }}>
            {isEsign && (
              <>
                <div className="flex justify-between"><span style={{ color: theme.slate }}>Number of Signers</span><span className="font-semibold" style={{ color: theme.ink }}>{copiesCount || "-"}</span></div>
                {eSignEStampGst > 0 && (
                  <div className="flex justify-between"><span style={{ color: theme.slate }}>GST ({GST_RATE}%)</span><span className="font-semibold" style={{ color: theme.ink }}>{formatCurrency(eSignEStampGst)}</span></div>
                )}
              </>
            )}

            {isEkyc && (
              <>
                <div className="flex justify-between"><span style={{ color: theme.slate }}>Document Type</span><span className="font-semibold" style={{ color: theme.ink }}>{EKYC_DOC_TYPES.find((d) => d.value === docType)?.label || "-"}</span></div>
                {ekycBaseTotal != null && (
                  <div className="flex justify-between"><span style={{ color: theme.slate }}>eKYC Service Charge</span><span className="font-semibold" style={{ color: theme.ink }}>{formatCurrency(ekycBaseTotal)}</span></div>
                )}
                {ekycVisibleCharges.map((c) => (
                  <div className="flex justify-between" key={c.charge_name}>
                    <span style={{ color: theme.slate }}>{c.charge_name}</span>
                    <span className="font-semibold" style={{ color: theme.ink }}>{formatCurrency(c.price)}</span>
                  </div>
                ))}
                {ekycGstAmount > 0 && (
                  <div className="flex justify-between"><span style={{ color: theme.slate }}>GST ({GST_RATE}%)</span><span className="font-semibold" style={{ color: theme.ink }}>{formatCurrency(ekycGstAmount)}</span></div>
                )}
              </>
            )}

            {isEStamp && (
              <>
                <div className="flex justify-between"><span style={{ color: theme.slate }}>Document Category</span><span className="font-semibold" style={{ color: theme.ink }}>{stampDetails.document_category_label || "-"}</span></div>
                <div className="flex justify-between"><span style={{ color: theme.slate }}>Stamp Amount</span><span className="font-semibold" style={{ color: theme.ink }}>{stampDetails.stamp_amount ? formatCurrency(Number(stampDetails.stamp_amount)) : "-"}</span></div>
                <div className="flex justify-between"><span style={{ color: theme.slate }}>eSign After Stamping</span><span className="font-semibold" style={{ color: theme.ink }}>{wantEsignAfterStamp ? "Yes" : "No"}</span></div>
                {wantEsignAfterStamp && (
                  <div className="flex justify-between"><span style={{ color: theme.slate }}>Number of eSign Signers</span><span className="font-semibold" style={{ color: theme.ink }}>{stampEsignSigners.length}</span></div>
                )}
                {eSignEStampGst > 0 && (
                  <div className="flex justify-between"><span style={{ color: theme.slate }}>GST ({GST_RATE}%)</span><span className="font-semibold" style={{ color: theme.ink }}>{formatCurrency(eSignEStampGst)}</span></div>
                )}
              </>
            )}

            {isEStampOnTheFly && (
              <>
                <div className="flex justify-between"><span style={{ color: theme.slate }}>State</span><span className="font-semibold" style={{ color: theme.ink }}>{stampOtfDetails.stamp_state}</span></div>
                <div className="flex justify-between"><span style={{ color: theme.slate }}>Document Category</span><span className="font-semibold" style={{ color: theme.ink }}>{stampOtfDetails.document_category_label || "-"}</span></div>
                {SHCIL_OTF_STATES.includes(stampOtfDetails.stamp_state) ? (
                  <div className="flex justify-between"><span style={{ color: theme.slate }}>Article Code</span><span className="font-semibold" style={{ color: theme.ink }}>{(ARTICLE_OPTIONS_BY_STATE[stampOtfDetails.stamp_state] || []).find((o) => o.value === stampOtfDetails.digital_article_code)?.label || "-"}</span></div>
                ) : (
                  <div className="flex justify-between"><span style={{ color: theme.slate }}>eSBTR District / Office</span><span className="font-semibold text-right" style={{ color: theme.ink }}>{stampOtfDetails.esbtr_district || "-"}{stampOtfDetails.esbtr_sub_registrar_office ? ` / ${stampOtfDetails.esbtr_sub_registrar_office}` : ""}</span></div>
                )}
                <div className="flex justify-between"><span style={{ color: theme.slate }}>Stamp Amount</span><span className="font-semibold" style={{ color: theme.ink }}>{stampOtfDetails.stamp_amount ? formatCurrency(Number(stampOtfDetails.stamp_amount)) : "-"}</span></div>
                {eSignEStampGst > 0 && (
                  <div className="flex justify-between"><span style={{ color: theme.slate }}>GST ({GST_RATE}%)</span><span className="font-semibold" style={{ color: theme.ink }}>{formatCurrency(eSignEStampGst)}</span></div>
                )}
              </>
            )}

            {isDocumentService && selectedDocument && (
              <>
                <div className="flex justify-between"><span style={{ color: theme.slate }}>Number of Copies</span><span className="font-semibold" style={{ color: theme.ink }}>{copiesCount || "-"}</span></div>
                {documentServiceGst > 0 && (
                  <div className="flex justify-between"><span style={{ color: theme.slate }}>GST ({GST_RATE}%)</span><span className="font-semibold" style={{ color: theme.ink }}>{formatCurrency(documentServiceGst)}</span></div>
                )}
              </>
            )}

            <div className="flex justify-between pt-2 border-t" style={{ borderColor: theme.border }}>
              <span style={{ color: theme.slate }}>{isEkyc ? "Total" : "Price"}</span>
              <span className="font-semibold" style={{ color: theme.navy }}>
                {isEkyc
                  ? (!selectedService ? "-" : formatCurrency(ekycGrandTotal))
                  : isDocumentService && selectedDocument
                    ? (documentServiceTaxable == null ? "-" : formatCurrency(documentServiceGrandTotal))
                    : (eSignEStampTaxable == null ? "-" : formatCurrency(eSignEStampGrandTotal))}
              </span>
            </div>
          </div>
        </div>

        <div className="mt-6 pt-5 border-t flex justify-end gap-2" style={{ borderColor: theme.border }}>
          <button onClick={() => navigate("/user/orders")} className="px-5 py-2.5 rounded text-sm font-semibold" style={{ background: "#fff", color: theme.ink, border: `1px solid ${theme.border}` }}>
            Cancel
          </button>
          <button onClick={() => submitOrder("submit")} disabled={saving} className="px-6 py-2.5 rounded text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60" style={{ background: theme.navy }}>
            {saving ? "Submitting..." : isEsign ? "Send for eSign" : "Submit Order"}
          </button>
        </div>
          </>
        )}
      </div>
    </div>
  );
};

export default PartnerUserCreateOrder;
