import { useState, useEffect } from 'react';
import { theme, serif, inputStyle as baseInputStyle } from "../../lib/userPortalTheme";
import { apiUrl, apiRequest, apiUpload, getStoredToken } from "../../lib/api";
import { isValidMobile, isValidEmail } from "../../lib/validation";
import { renderableEkycFields } from "../../lib/ekycFields";

const inputClass = "w-full px-4 py-2.5 text-sm rounded outline-none transition-all disabled:cursor-not-allowed";

const EKYC_DOC_TYPES = [
  { value: "aadhaar_card", label: "Aadhaar Card" },
  { value: "pan_card", label: "PAN Card" },
];

const REPAYMENT_FREQUENCIES = ["Monthly", "Quarterly", "Half-Yearly", "Yearly"];

const ROLE_LABELS = { applicant: "Applicant", co_applicant: "Co-Applicant", guarantor: "Guarantor" };
const MAX_CO_APPLICANTS = 3;
const MAX_GUARANTORS = 2;
const SIGNER_POSITIONS = ["bottom-right", "bottom-left", "top-right", "top-left"];

// Every loan-TYPE-specific field the backend can render (vehicle/property/
// farm details — these describe the loan itself, not a party), keyed by its
// dynamic_fields key — mirrors app/loan_i18n.py's FIELD_LABELS /
// LOAN_TYPE_CONFIG 1:1, so what the form collects lands under the right PDF
// heading. Per-party fields (personal/address/employment/income/existing
// loans/bank accounts/assets/references) are handled separately below by
// PartyCard, since they repeat once per Applicant/Co-Applicant/Guarantor.
const FIELD_TYPES = {
  property_address: { label: "Property Address", type: "text" },
  property_type: { label: "Property Type", type: "select", options: ["Residential", "Commercial", "Plot / Land", "Under Construction"] },
  property_value: { label: "Property Value", type: "number" },
  purchase_price: { label: "Purchase Price", type: "number" },
  down_payment: { label: "Down Payment", type: "number" },
  seller_builder_name: { label: "Seller / Builder Name", type: "text" },
  seller_builder_contact: { label: "Seller / Builder Contact", type: "text" },
  survey_property_number: { label: "Survey / Property Number", type: "text" },
  registration_details: { label: "Registration Details", type: "text" },
  construction_status: { label: "Construction Status", type: "text" },
  existing_property_loan: { label: "Existing Property Loan", type: "text" },
  mortgage_security_details: { label: "Mortgage / Security Details", type: "text" },
  insurance_details: { label: "Insurance Details", type: "text" },

  vehicle_type: { label: "Vehicle Type", type: "text" },
  new_or_used: { label: "New / Used", type: "select", options: ["New", "Used"] },
  manufacturer: { label: "Manufacturer / Make", type: "text" },
  brand_model: { label: "Brand / Model", type: "text" },
  variant: { label: "Variant", type: "text" },
  manufacturing_year: { label: "Manufacturing Year", type: "text" },
  registration_number: { label: "Registration Number", type: "text" },
  chassis_number: { label: "Chassis Number", type: "text" },
  engine_number: { label: "Engine Number", type: "text" },
  ex_showroom_price: { label: "Ex-Showroom Price", type: "number" },
  on_road_price: { label: "On-Road Price", type: "number" },
  dealer_name: { label: "Dealer Name", type: "text" },
  dealer_address: { label: "Dealer Address", type: "text" },
  dealer_contact: { label: "Dealer Contact", type: "text" },
  hypothecation_details: { label: "Vehicle Hypothecation Details", type: "text" },

  existing_emi_amount: { label: "Existing EMI Amount", type: "number" },
  monthly_expenses: { label: "Monthly Expenses", type: "number" },
  other_income: { label: "Other Income", type: "number" },
  required_loan_amount: { label: "Required Loan Amount", type: "number" },
  prepayment_terms: { label: "Prepayment Terms", type: "text" },
  security_collateral: { label: "Security / Collateral", type: "text" },

  farm_location: { label: "Farm Location", type: "text" },
  village: { label: "Village", type: "text" },
  taluk: { label: "Taluk", type: "text" },
  district: { label: "District", type: "text" },
  state: { label: "State", type: "text" },
  land_ownership: { label: "Land Ownership", type: "select", options: ["Owned", "Leased", "Co-owned / Family"] },
  total_land_area: { label: "Total Land Area / Acreage", type: "text" },
  cultivated_area: { label: "Cultivated Area", type: "text" },
  survey_number: { label: "Survey Number", type: "text" },
  land_registration_details: { label: "Land Registration Details", type: "text" },
  lease_details: { label: "Lease Details", type: "text" },
  crop_type: { label: "Crop Type", type: "text" },
  crop_season: { label: "Crop Season", type: "text" },
  cultivation_area: { label: "Cultivation Area", type: "text" },
  irrigation_type: { label: "Irrigation Type", type: "select", options: ["Rainfed", "Canal", "Borewell", "Drip", "Sprinkler"] },
  expected_yield: { label: "Expected Yield", type: "text" },
  estimated_crop_value: { label: "Estimated Crop Value", type: "number" },
  expected_harvest_date: { label: "Expected Harvest Date", type: "date" },
  sanctioned_loan_amount: { label: "Sanctioned Loan Amount", type: "number" },
  existing_agri_loans: { label: "Existing Agricultural Loans", type: "text" },
  other_agri_income: { label: "Other Agricultural Income", type: "number" },
  collateral_details: { label: "Collateral Details", type: "text" },
};

// Long free-text fields stretch across the entire row on desktop layouts;
// every other field packs into a single grid column.
const FULL_WIDTH_FIELDS = new Set([
  "property_address", "dealer_address", "registration_details", "land_registration_details",
  "lease_details", "mortgage_security_details", "hypothecation_details", "security_collateral",
  "prepayment_terms", "insurance_details", "farm_location",
]);

const fieldWrapClass = (k) => (FULL_WIDTH_FIELDS.has(k) ? "col-span-full" : "");

// Matches the backend's get_loan_type_config() in loan_i18n.py: car/bike ->
// vehicle, then housing/agriculture/personal, personal as the fallback.
const LOAN_TYPE_CONFIG = {
  vehicle: {
    match: (name) => name.includes("car") || name.includes("bike") || name.includes("wheeler"),
    sections: [
      { title: "Vehicle Details", fields: ["vehicle_type", "new_or_used", "manufacturer", "brand_model", "variant", "manufacturing_year", "registration_number", "chassis_number", "engine_number", "ex_showroom_price", "on_road_price", "down_payment", "dealer_name", "dealer_address", "dealer_contact"] },
    ],
    repaymentSecurity: ["hypothecation_details", "insurance_details"],
  },
  housing: {
    match: (name) => name.includes("housing"),
    sections: [
      { title: "Property Details", fields: ["property_address", "property_type", "property_value", "purchase_price", "down_payment", "seller_builder_name", "seller_builder_contact", "survey_property_number", "registration_details", "construction_status", "existing_property_loan"] },
    ],
    repaymentSecurity: ["mortgage_security_details", "insurance_details"],
  },
  personal: {
    match: (name) => name.includes("personal"),
    sections: [
      { title: "Financial Details", fields: ["existing_emi_amount", "monthly_expenses", "other_income", "required_loan_amount"] },
    ],
    repaymentSecurity: ["prepayment_terms", "security_collateral"],
  },
  agriculture: {
    match: (name) => name.includes("agriculture"),
    sections: [
      { title: "Farm Details", fields: ["farm_location", "village", "taluk", "district", "state", "land_ownership", "total_land_area", "cultivated_area", "survey_number", "land_registration_details", "lease_details"] },
      { title: "Crop Details", fields: ["crop_type", "crop_season", "cultivation_area", "irrigation_type", "expected_yield", "estimated_crop_value", "expected_harvest_date"] },
      { title: "Financial Details", fields: ["required_loan_amount", "sanctioned_loan_amount", "existing_agri_loans", "other_agri_income"] },
    ],
    repaymentSecurity: ["collateral_details"],
  },
};

const getLoanTypeConfig = (docName) => {
  const name = (docName || "").toLowerCase();
  for (const cfg of Object.values(LOAN_TYPE_CONFIG)) {
    if (cfg.match(name)) return cfg;
  }
  return LOAN_TYPE_CONFIG.personal;
};

// =========================================================================
// Per-party field metadata (Personal/KYC, Address, Employment, and the four
// repeatable-row tables) — mirrors app/routes/partner_user.py's
// PartyPersonal / PartyAddressBlock / PartyEmployment / *Row Pydantic
// models and app/loan_i18n.py's matching FIELD_LABELS keys.
// =========================================================================

const PARTY_PERSONAL_FIELDS = [
  { key: "full_name", label: "Full Name", type: "text" },
  { key: "gender", label: "Gender", type: "select", options: ["Male", "Female", "Third Gender"] },
  { key: "date_of_birth", label: "Date of Birth", type: "date" },
  { key: "marital_status", label: "Marital Status", type: "select", options: ["Single", "Married", "Divorced", "Widowed"] },
  { key: "spouse_name", label: "Spouse Name", type: "text" },
  { key: "father_name", label: "Father's Name", type: "text" },
  { key: "mother_maiden_name", label: "Mother's Maiden Name", type: "text" },
  { key: "category", label: "Category", type: "select", options: ["General", "SC", "ST", "OBC", "Other"] },
  { key: "religion", label: "Religion", type: "text" },
  { key: "nationality", label: "Nationality", type: "text" },
  { key: "residential_status", label: "Residential Status", type: "select", options: ["Resident Indian", "NRI", "PIO", "Foreign Citizen"] },
  { key: "no_of_dependents", label: "No. of Dependents", type: "number" },
  { key: "occupation", label: "Occupation", type: "text" },
  { key: "pan_number", label: "PAN Number", type: "text" },
  { key: "aadhaar_number", label: "Aadhaar Number", type: "text" },
  { key: "voter_id", label: "Voter ID Number", type: "text" },
  { key: "driving_license", label: "Driving Licence Number", type: "text" },
  { key: "passport_number", label: "Passport Number", type: "text" },
  { key: "passport_valid_upto", label: "Passport Valid Upto", type: "date" },
];

const PARTY_ADDRESS_FIELDS = [
  { key: "house_no", label: "House / Flat / Building No.", type: "text" },
  { key: "street", label: "Street / Area / Locality", type: "text" },
  { key: "landmark", label: "Landmark", type: "text" },
  { key: "city", label: "City", type: "text" },
  { key: "district", label: "District", type: "text" },
  { key: "state", label: "State", type: "text" },
  { key: "pincode", label: "Pincode", type: "text" },
  { key: "country", label: "Country", type: "text" },
  { key: "mobile", label: "Mobile Number", type: "text" },
  { key: "email", label: "Email", type: "email" },
];

const PARTY_EMPLOYMENT_FIELDS = [
  { key: "occupation_type", label: "Occupation Type", type: "select", options: ["Salaried", "Self-Employed Professional", "Business", "Agriculturist", "Pensioner", "Other"] },
  { key: "employer_name", label: "Employer Name", type: "text" },
  { key: "designation", label: "Designation", type: "text" },
  { key: "department", label: "Department", type: "text" },
  { key: "employee_no", label: "Employee Number", type: "text" },
  { key: "employment_status", label: "Employment Status", type: "select", options: ["Regular", "Probationary", "Contractual", "Retainership", "Part-Time"] },
  { key: "organization_type", label: "Organization Type", type: "select", options: ["Public Sector", "Private Company", "MNC", "Government", "Local Body", "Other"] },
  { key: "total_experience", label: "Total Work Experience", type: "text" },
  { key: "years_present_job", label: "Years in Present Job", type: "text" },
  { key: "business_name", label: "Business Name", type: "text" },
  { key: "business_type", label: "Business Type", type: "select", options: ["Proprietorship", "Partnership", "Private Limited", "Public Limited", "Other"] },
  { key: "monthly_income", label: "Monthly Income", type: "number" },
];

const INCOME_ROW_FIELDS = [
  { key: "income_head", label: "Income Head", type: "text" },
  { key: "gross_income", label: "Gross Income", type: "number" },
  { key: "net_income", label: "Net Income", type: "number" },
  { key: "frequency", label: "Frequency", type: "select", options: ["Monthly", "Quarterly", "Half-Yearly", "Yearly"] },
];

const LOAN_ROW_FIELDS = [
  { key: "loan_bank", label: "Bank / Financier", type: "text" },
  { key: "loan_type", label: "Loan Type", type: "text" },
  { key: "loan_emi", label: "EMI", type: "number" },
  { key: "loan_tenure", label: "Tenure", type: "text" },
  { key: "loan_outstanding", label: "Outstanding Balance", type: "number" },
];

const BANK_ROW_FIELDS = [
  { key: "bank_name", label: "Bank Name", type: "text" },
  { key: "bank_branch", label: "Branch", type: "text" },
  { key: "account_type", label: "Account Type", type: "select", options: ["Savings", "Current", "Salary", "Other"] },
  { key: "account_number", label: "Account Number", type: "text" },
];

const ASSET_ROW_FIELDS = [
  { key: "asset_type", label: "Asset Type", type: "select", options: ["Movable", "Immovable", "Liquid", "Other"] },
  { key: "asset_description", label: "Description", type: "text" },
  { key: "asset_value", label: "Value", type: "number" },
];

const REFERENCE_ROW_FIELDS = [
  { key: "reference_name", label: "Name", type: "text" },
  { key: "reference_address", label: "Address", type: "text" },
  { key: "reference_phone", label: "Phone Number", type: "text" },
];

const emptyAddressBlock = () => ({
  house_no: "", street: "", landmark: "", city: "", district: "", state: "", pincode: "", country: "", mobile: "", email: "",
});

const emptyPersonal = () => ({
  full_name: "", gender: "", date_of_birth: "", marital_status: "", spouse_name: "", father_name: "",
  mother_maiden_name: "", category: "", religion: "", nationality: "", residential_status: "",
  no_of_dependents: "", occupation: "", pan_number: "", aadhaar_number: "", voter_id: "",
  driving_license: "", passport_number: "", passport_valid_upto: "",
});

const emptyEmployment = () => ({
  occupation_type: "", employer_name: "", designation: "", department: "", employee_no: "",
  employment_status: "", organization_type: "", total_experience: "", years_present_job: "",
  business_name: "", business_type: "", monthly_income: "",
});

const emptyIncomeRow = () => ({ income_head: "", gross_income: "", net_income: "", frequency: "" });
const emptyLoanRow = () => ({ loan_bank: "", loan_type: "", loan_emi: "", loan_tenure: "", loan_outstanding: "" });
const emptyBankRow = () => ({ bank_name: "", bank_branch: "", account_type: "", account_number: "" });
const emptyAssetRow = () => ({ asset_type: "", asset_description: "", asset_value: "" });
const emptyReferenceRow = () => ({ reference_name: "", reference_address: "", reference_phone: "" });

const emptyParty = (role) => ({
  role,
  personal: emptyPersonal(),
  address: { present: emptyAddressBlock(), permanent_same_as_present: true, permanent: null, office: null },
  employment: emptyEmployment(),
  income_sources: [],
  existing_loans: [],
  bank_accounts: [],
  assets: [],
  references: [],
});

const FieldInput = ({ fieldKey, value, onChange }) => {
  const cfg = FIELD_TYPES[fieldKey];
  if (cfg.type === "select") {
    return (
      <select value={value || ""} onChange={(e) => onChange(e.target.value)} className={inputClass} style={baseInputStyle}>
        <option value="">Select {cfg.label.toLowerCase()}</option>
        {cfg.options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  const inputType = cfg.type === "number" ? "number" : cfg.type === "date" ? "date" : "text";
  if (cfg.type === "text" && FULL_WIDTH_FIELDS.has(fieldKey)) {
    return <textarea rows={2} value={value || ""} onChange={(e) => onChange(e.target.value)} className={inputClass} style={baseInputStyle} />;
  }
  return <input type={inputType} value={value || ""} onChange={(e) => onChange(e.target.value)} className={inputClass} style={baseInputStyle} />;
};

const SectionFieldGrid = ({ title, fields, values, onChange }) => (
  <div className="pt-3 mt-3 border-t" style={{ borderColor: theme.border }}>
    <h3 className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: theme.navy }}>{title}</h3>
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
      {fields.map((k) => (
        <div key={k} className={fieldWrapClass(k)}>
          <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: theme.slate }}>{FIELD_TYPES[k].label}</label>
          <FieldInput fieldKey={k} value={values[k]} onChange={(v) => onChange(k, v)} />
        </div>
      ))}
    </div>
  </div>
);

// Generic input for a small field descriptor ({key,label,type,options}) —
// used everywhere inside PartyCard (Personal/Address/Employment/row tables),
// as opposed to FieldInput above which looks up loan-type-specific fields by
// key in the module-level FIELD_TYPES dict.
const SimpleInput = ({ field, value, onChange }) => {
  if (field.type === "select") {
    return (
      <select value={value || ""} onChange={(e) => onChange(e.target.value)} className={inputClass} style={baseInputStyle}>
        <option value="">Select</option>
        {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  const inputType = field.type === "number" ? "number" : field.type === "date" ? "date" : field.type === "email" ? "email" : "text";
  return <input type={inputType} value={value || ""} onChange={(e) => onChange(e.target.value)} className={inputClass} style={baseInputStyle} />;
};

const FieldGrid = ({ fields, values, onChange }) => (
  <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
    {fields.map((f) => (
      <div key={f.key}>
        <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: theme.slate }}>{f.label}</label>
        <SimpleInput field={f} value={values?.[f.key]} onChange={(v) => onChange(f.key, v)} />
      </div>
    ))}
  </div>
);

// One repeatable-row section (Income Sources / Existing Loans / Bank
// Accounts / Assets / References) — same add/remove-row idiom used
// elsewhere in this app (see CustomerOnboard.jsx's `users` array / a
// denomination-rows table): an "empty row" template, append on Add, filter
// on Remove.
const RepeatingRowsSection = ({ title, fields, rows, onChange, emptyRow }) => {
  const addRow = () => onChange([...rows, emptyRow()]);
  const removeRow = (i) => onChange(rows.filter((_, idx) => idx !== i));
  const updateRow = (i, key, value) => onChange(rows.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)));

  return (
    <div className="pt-3 border-t" style={{ borderColor: theme.border }}>
      <h4 className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: theme.navy }}>{title}</h4>
      {rows.length === 0 && <p className="text-xs mb-2" style={{ color: theme.slate }}>None added.</p>}
      {rows.map((row, i) => (
        <div key={i} className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-3 mb-2 items-end">
          {fields.map((f) => (
            <div key={f.key}>
              <label className="block text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: theme.slate }}>{f.label}</label>
              <SimpleInput field={f} value={row[f.key]} onChange={(v) => updateRow(i, f.key, v)} />
            </div>
          ))}
          <button type="button" onClick={() => removeRow(i)} className="text-xs font-semibold text-red-600 justify-self-start pb-2.5">Remove</button>
        </div>
      ))}
      <button type="button" onClick={addRow} className="text-xs font-semibold" style={{ color: theme.navy }}>+ Add row</button>
    </div>
  );
};

const PartyCard = ({ party, roleLabel, removable, onRemove, onChange }) => {
  const updatePersonal = (key, value) => onChange({ ...party, personal: { ...party.personal, [key]: value } });
  const updateEmployment = (key, value) => onChange({ ...party, employment: { ...party.employment, [key]: value } });
  const updatePresent = (key, value) => onChange({ ...party, address: { ...party.address, present: { ...party.address.present, [key]: value } } });
  const updatePermanent = (key, value) => onChange({ ...party, address: { ...party.address, permanent: { ...(party.address.permanent || emptyAddressBlock()), [key]: value } } });
  const updateOffice = (key, value) => onChange({ ...party, address: { ...party.address, office: { ...(party.address.office || emptyAddressBlock()), [key]: value } } });
  const togglePermanentSame = (same) => onChange({ ...party, address: { ...party.address, permanent_same_as_present: same, permanent: same ? null : emptyAddressBlock() } });
  const toggleOffice = (has) => onChange({ ...party, address: { ...party.address, office: has ? emptyAddressBlock() : null } });
  const setRows = (key, rows) => onChange({ ...party, [key]: rows });

  return (
    <details open className="rounded-lg border mb-4 overflow-hidden" style={{ borderColor: theme.border, background: "#fff" }}>
      <summary className="cursor-pointer list-none px-4 py-3 flex items-center justify-between" style={{ background: "#F3F8FB" }}>
        <span className="text-sm font-bold uppercase tracking-wide" style={{ color: theme.navy }}>{roleLabel}</span>
        {removable && (
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemove(); }}
            className="text-xs font-semibold text-red-600"
          >
            Remove
          </button>
        )}
      </summary>
      <div className="p-4 space-y-4">
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: theme.navy }}>Personal / KYC</h4>
          <FieldGrid fields={PARTY_PERSONAL_FIELDS} values={party.personal} onChange={updatePersonal} />
        </div>

        <div className="pt-3 border-t" style={{ borderColor: theme.border }}>
          <h4 className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: theme.navy }}>Address</h4>
          <p className="text-[11px] font-semibold uppercase mb-1.5" style={{ color: theme.slate }}>Present Address</p>
          <FieldGrid fields={PARTY_ADDRESS_FIELDS} values={party.address.present} onChange={updatePresent} />

          <label className="flex items-center gap-2 mt-3 text-xs font-semibold" style={{ color: theme.ink }}>
            <input type="checkbox" checked={party.address.permanent_same_as_present} onChange={(e) => togglePermanentSame(e.target.checked)} />
            Permanent address same as present
          </label>
          {!party.address.permanent_same_as_present && (
            <div className="mt-2">
              <p className="text-[11px] font-semibold uppercase mb-1.5" style={{ color: theme.slate }}>Permanent Address</p>
              <FieldGrid fields={PARTY_ADDRESS_FIELDS} values={party.address.permanent} onChange={updatePermanent} />
            </div>
          )}

          <label className="flex items-center gap-2 mt-3 text-xs font-semibold" style={{ color: theme.ink }}>
            <input type="checkbox" checked={!!party.address.office} onChange={(e) => toggleOffice(e.target.checked)} />
            Add office / business address
          </label>
          {party.address.office && (
            <div className="mt-2">
              <p className="text-[11px] font-semibold uppercase mb-1.5" style={{ color: theme.slate }}>Office / Business Address</p>
              <FieldGrid fields={PARTY_ADDRESS_FIELDS} values={party.address.office} onChange={updateOffice} />
            </div>
          )}
        </div>

        <div className="pt-3 border-t" style={{ borderColor: theme.border }}>
          <h4 className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: theme.navy }}>Employment / Business</h4>
          <FieldGrid fields={PARTY_EMPLOYMENT_FIELDS} values={party.employment} onChange={updateEmployment} />
        </div>

        <RepeatingRowsSection title="Income Sources" fields={INCOME_ROW_FIELDS} rows={party.income_sources} onChange={(rows) => setRows("income_sources", rows)} emptyRow={emptyIncomeRow} />
        <RepeatingRowsSection title="Existing Loans" fields={LOAN_ROW_FIELDS} rows={party.existing_loans} onChange={(rows) => setRows("existing_loans", rows)} emptyRow={emptyLoanRow} />
        <RepeatingRowsSection title="Bank Accounts" fields={BANK_ROW_FIELDS} rows={party.bank_accounts} onChange={(rows) => setRows("bank_accounts", rows)} emptyRow={emptyBankRow} />
        <RepeatingRowsSection title="Assets" fields={ASSET_ROW_FIELDS} rows={party.assets} onChange={(rows) => setRows("assets", rows)} emptyRow={emptyAssetRow} />
        <RepeatingRowsSection title="References" fields={REFERENCE_ROW_FIELDS} rows={party.references} onChange={(rows) => setRows("references", rows)} emptyRow={emptyReferenceRow} />
      </div>
    </details>
  );
};

export default function LoanDocumentFlow({ document, onCancel, onSubmitOrder, ekycService }) {
  // The org's already-configured eKYC price (organization_service_pricing) —
  // never re-entered or hardcoded here. undefined/not assigned means the org
  // has no eKYC pricing set up at all, so the option is disabled instead of
  // letting a partner user click through to a guaranteed backend failure.
  const ekycAvailable = !!ekycService;
  const loanType = getLoanTypeConfig(document?.doc_name);
  const [step, setStep] = useState(1);
  const [language, setLanguage] = useState("English");
  const [useEkyc, setUseEkyc] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatedPdfBytes, setGeneratedPdfBytes] = useState(null);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState(null);

  // Revoke the previous blob URL whenever a new one is created or the
  // component unmounts — otherwise each redraft leaks the old one.
  useEffect(() => () => { if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl); }, [pdfPreviewUrl]);

  // Application-level fields (not per-party).
  const [formData, setFormData] = useState({
    loanAmount: "",
    tenure: "",
    interestRate: "12",
    repaymentFrequency: "Monthly",
  });

  // Applicant Management — always exactly one "applicant" (index 0, never
  // removable), plus any number of Co-Applicants/Guarantors the partner user
  // adds. Same add/remove-array idiom used elsewhere in this app (see
  // CustomerOnboard.jsx's `users` state).
  const [parties, setParties] = useState([emptyParty("applicant")]);
  const addParty = (role) => setParties((prev) => [...prev, emptyParty(role)]);
  const removeParty = (index) => setParties((prev) => prev.filter((_, i) => i !== index));
  const updateParty = (index, updated) => setParties((prev) => prev.map((p, i) => (i === index ? updated : p)));

  const coApplicantCount = parties.filter((p) => p.role === "co_applicant").length;
  const guarantorCount = parties.filter((p) => p.role === "guarantor").length;
  const partyRows = (() => {
    const seen = { applicant: 0, co_applicant: 0, guarantor: 0 };
    const totals = { applicant: 0, co_applicant: 0, guarantor: 0 };
    parties.forEach((p) => { totals[p.role] += 1; });
    return parties.map((party, idx) => {
      seen[party.role] += 1;
      const label = totals[party.role] > 1 ? `${ROLE_LABELS[party.role]} ${seen[party.role]}` : ROLE_LABELS[party.role];
      return { party, idx, label };
    });
  })();

  // Loan-type-specific dynamic fields, keyed by the backend's dynamic_fields
  // keys (what gets returned to the API unchanged).
  const [typeFields, setTypeFields] = useState({});
  // Snapshot of exactly what was sent when the draft was generated —
  // persisted with the order, not the live form state.
  const [generatedDynamicFields, setGeneratedDynamicFields] = useState({});
  const [generatedParties, setGeneratedParties] = useState([]);

  const [requireEsign, setRequireEsign] = useState(true);

  // Documents Checklist — hardcoded per loan type on the backend (see
  // app/loan_i18n.py's DOCUMENT_CHECKLISTS, served by
  // GET /loans/documents?document_name=...), the same way every other part
  // of this flow's field set is. Keyed by document.doc_name rather than any
  // DB id, so it's always available even when the catalog document has no
  // config_id (e.g. picked via the "Document Service" fallback).
  const [checklistItems, setChecklistItems] = useState([]);
  const [checklistLoading, setChecklistLoading] = useState(false);
  const [confirmedDocKeys, setConfirmedDocKeys] = useState(new Set());

  useEffect(() => {
    const docName = document?.doc_name;
    if (!docName) return;
    setChecklistLoading(true);
    apiRequest(`/api/partner-user/loans/documents?document_name=${encodeURIComponent(docName)}`)
      .then((items) => setChecklistItems(Array.isArray(items) ? items : []))
      .catch(() => setChecklistItems([]))
      .finally(() => setChecklistLoading(false));
  }, [document?.doc_name]);

  const presentRoles = new Set(parties.map((p) => p.role));
  const visibleChecklistItems = checklistItems.filter(
    (item) => !item.applicant_type?.length || item.applicant_type.some((r) => presentRoles.has(r))
  );
  const toggleDocConfirmed = (key) => setConfirmedDocKeys((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  // Real eKYC identity verification (Aadhaar via DigiLocker, or PAN via
  // SignDesk's General Document Verification) — runs as its own "eKYC"
  // order (billed separately, same as the standalone eKYC Verification
  // page) before the loan draft can be generated, and only ever verifies
  // the Applicant (party index 0) — Co-Applicants/Guarantors are filled in
  // manually. See ekyc_service.py / digilocker_service.py.
  const [ekycMobile, setEkycMobile] = useState("");
  const [ekycDocType, setEkycDocType] = useState("");
  const [ekycFile, setEkycFile] = useState(null);
  const [ekycOrderId, setEkycOrderId] = useState(null);
  // idle | verifying | digilocker_pending | fetching | done | failed
  const [ekycStage, setEkycStage] = useState("idle");
  const [ekycError, setEkycError] = useState("");
  const [ekycFields, setEkycFields] = useState([]);

  const toDateInputValue = (v) => {
    if (!v) return "";
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
    if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    return s;
  };

  const extractEkycValue = (extracted, keys) => {
    const findKey = Object.keys(extracted || {}).find((ek) => keys.includes(ek.toLowerCase()));
    if (findKey === undefined) return "";
    const val = extracted[findKey];
    if (val == null || typeof val === "object") return "";
    return String(val).trim();
  };

  const composeEkycAddress = (extracted) => {
    const raw = extractEkycValue(extracted, ["address", "full_address"]);
    if (raw) return raw;
    const parts = [];
    for (const k of ["house", "street", "vtc", "district", "state", "pincode", "pin_code"]) {
      const p = extractEkycValue(extracted, [k]);
      if (p) parts.push(p);
    }
    return parts.join(", ");
  };

  // Auto-fill the Applicant's Personal/KYC + Present Address from whatever
  // identity data the verification returned. Only present keys are filled —
  // the user can correct/edit before generating the draft. Raw (unmasked)
  // values are used here; the masked display form stays in the summary.
  const applyEkycResult = (extracted) => {
    const fields = renderableEkycFields(extracted);
    setEkycFields(fields);
    const given = extractEkycValue(extracted, ["given_name", "given_names"]);
    const surname = extractEkycValue(extracted, ["surname"]);
    const name = extractEkycValue(extracted, ["full_name", "name"]) || (given && surname ? `${given} ${surname}` : given);
    const dob = toDateInputValue(extractEkycValue(extracted, ["date_of_birth", "dob"]));
    const aadhaar = extractEkycValue(extracted, ["aadhaar_number", "uid"]);
    const pan = extractEkycValue(extracted, ["pan_number", "pan"]);
    const address = composeEkycAddress(extracted);
    setParties((prev) => prev.map((p, i) => {
      if (i !== 0) return p; // Applicant is always index 0
      return {
        ...p,
        personal: {
          ...p.personal,
          ...(name ? { full_name: name } : {}),
          ...(dob ? { date_of_birth: dob } : {}),
          ...(aadhaar ? { aadhaar_number: aadhaar } : {}),
          ...(pan ? { pan_number: pan } : {}),
        },
        address: address ? { ...p.address, present: { ...p.address.present, street: address } } : p.address,
      };
    }));
    return name;
  };

  const finishPanVerification = async (orderId) => {
    const fullOrder = await apiRequest(`/api/partner-user/orders/${orderId}`);
    const ekyc = fullOrder.ekyc;
    if (ekyc?.status === "success" && ekyc?.verified) {
      applyEkycResult(ekyc.extracted_data);
      setEkycStage("done");
    } else {
      setEkycFields(renderableEkycFields(ekyc?.extracted_data));
      setEkycError(ekyc?.error || "Identity verification did not pass.");
      setEkycStage("failed");
    }
  };

  const handleStartEkycVerification = async () => {
    setEkycError("");
    if (!ekycDocType) return setEkycError("Please select a document type.");
    if (!ekycFile) return setEkycError("Please upload the ID document.");

    setEkycStage("verifying");
    try {
      const fd = new FormData();
      fd.append("service_name", "eKYC");
      // The real name comes from the uploaded document after verification
      // (see applyEkycResult). The mobile also isn't required for the ID
      // OCR itself — a placeholder satisfies the order API until the real
      // number is entered on the Applicant's Present Address below.
      fd.append("customer_name", parties[0]?.personal?.full_name?.trim() || "Verified Customer");
      fd.append("customer_mobile", ekycMobile.trim() || "0000000000");
      fd.append("action", "submit");
      fd.append("document", ekycFile);
      fd.append("doc_type", ekycDocType);
      fd.append("verification", "true");

      const order = await apiUpload("/api/partner-user/orders", fd);
      setEkycOrderId(order.id);
      // Reuse the verified contact number as the Applicant's own present-
      // address mobile (used later for the eSign signature invite) rather
      // than asking for it a second time — only when one was actually
      // entered here.
      if (ekycMobile.trim()) {
        setParties((prev) => prev.map((p, i) => (i === 0
          ? { ...p, address: { ...p.address, present: { ...p.address.present, mobile: ekycMobile } } }
          : p)));
      }

      // initiate_ekyc persists a 'failed' row on a SignDeskError instead of
      // throwing past this call for anything but a transport/auth error, so
      // the re-fetch below still has something real to show either way.
      await apiRequest(`/api/partner-user/orders/${order.id}/ekyc/verify`, {
        method: "POST",
        body: JSON.stringify({ verification: true }),
      }).catch(() => {});

      if (ekycDocType === "aadhaar_card") {
        const digilocker = await apiRequest(`/api/partner-user/orders/${order.id}/digilocker/verify`, { method: "POST" });
        if (digilocker.status === "link_generated" && digilocker.link) {
          window.open(digilocker.link, "_blank", "noopener,noreferrer");
        }
        setEkycStage("digilocker_pending");
      } else {
        await finishPanVerification(order.id);
      }
    } catch (err) {
      setEkycError(err.message || "Verification failed.");
      setEkycStage("failed");
    }
  };

  const handleFetchAadhaarDetails = async () => {
    if (!ekycOrderId) return;
    setEkycStage("fetching");
    setEkycError("");
    try {
      await apiRequest(`/api/partner-user/orders/${ekycOrderId}/digilocker/fetch-aadhaar`, { method: "POST" });
      const fullOrder = await apiRequest(`/api/partner-user/orders/${ekycOrderId}`);
      const digilocker = fullOrder.digilocker;
      if (digilocker?.status === "verified") {
        applyEkycResult(digilocker.aadhaar_data);
        setEkycStage("done");
      } else {
        setEkycFields(renderableEkycFields(digilocker?.aadhaar_data));
        setEkycError(digilocker?.error || "Complete the DigiLocker consent flow in the tab that opened, then fetch again.");
        setEkycStage("digilocker_pending");
      }
    } catch (err) {
      setEkycError(err.message || "Could not fetch Aadhaar details.");
      setEkycStage("digilocker_pending");
    }
  };

  const setField = (key, value) => setFormData((prev) => ({ ...prev, [key]: value }));
  const updateTypeField = (key, value) => setTypeFields((prev) => ({ ...prev, [key]: value }));

  const handleGenerateDraft = async () => {
    setGenerating(true);
    try {
      // Collect every loan-type dynamic field the backend renders (vehicle/
      // property/farm details), keyed exactly as loan_i18n.py's
      // LOAN_TYPE_CONFIG expects them.
      const dynFields = {};
      const put = (key, value) => { if (value !== undefined && value !== "") dynFields[key] = value; };
      loanType.sections.forEach((s) => s.fields.forEach((k) => put(k, typeFields[k])));
      loanType.repaymentSecurity.forEach((k) => put(k, typeFields[k]));

      const response = await fetch(apiUrl('/api/partner-user/loans/generate_draft'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getStoredToken()}`
        },
        body: JSON.stringify({
          document_name: document.doc_name,
          language: language,
          loan_amount: formData.loanAmount || "0",
          tenure: formData.tenure || "0",
          interest_rate: formData.interestRate || "12",
          repayment_frequency: formData.repaymentFrequency || "Monthly",
          dynamic_fields: dynFields,
          parties,
        })
      });

      if (!response.ok) throw new Error("Failed to generate draft");

      const blob = await response.blob();
      setGeneratedPdfBytes(blob);
      setPdfPreviewUrl(URL.createObjectURL(blob));
      setGeneratedDynamicFields(dynFields);
      setGeneratedParties(parties);
      setStep(2);
    } catch (err) {
      alert("Error generating draft: " + err.message);
    } finally {
      setGenerating(false);
    }
  };

  const handleFinalize = () => {
    const applicant = generatedParties.find((p) => p.role === "applicant") || parties.find((p) => p.role === "applicant");
    const customerName = applicant?.personal?.full_name || "Customer";
    const customerMobile = applicant?.address?.present?.mobile || "";
    const customerEmail = applicant?.address?.present?.email || "";

    // customer_email is required by order creation itself for every service
    // except eKYC/eSign (see partner.py's _create_order) — this order is
    // always created as "Document Service", so it's never exempt.
    if (!isValidEmail(customerEmail)) {
      alert("A valid email address is required for the Applicant (Present Address > Email) to save this order.");
      return;
    }
    if (requireEsign && !isValidMobile(customerMobile)) {
      alert("A valid 10-digit mobile number is required for the Applicant (Present Address > Mobile) to send this for eSign.");
      return;
    }
    const file = new File([generatedPdfBytes], `${document.doc_name.replace(/\s+/g, '_')}.pdf`, { type: "application/pdf" });

    // One eSign signer per party that entered a valid mobile number —
    // Co-Applicants/Guarantors without one simply don't get an invite.
    const signers = generatedParties
      .filter((p) => isValidMobile(p.address?.present?.mobile))
      .map((p, i) => ({
        name: p.personal.full_name || ROLE_LABELS[p.role],
        mobile: p.address.present.mobile,
        email: p.address.present.email || null,
        position: SIGNER_POSITIONS[i % SIGNER_POSITIONS.length],
      }));

    const documentsChecklist = visibleChecklistItems.map((item) => ({
      document_name: item.document_name,
      mandatory: !!item.is_mandatory,
      confirmed: confirmedDocKeys.has(item.key),
    }));

    onSubmitOrder({
      file,
      requireEsign,
      customer_name: customerName,
      customer_mobile: customerMobile,
      customer_email: customerEmail,
      signers,
      loan_details: {
        loan_type: document.doc_name,
        language,
        verification_method: useEkyc ? "ekyc" : "manual",
        loan_amount: formData.loanAmount || null,
        tenure_months: formData.tenure || null,
        interest_rate: formData.interestRate || "12",
        repayment_frequency: formData.repaymentFrequency || "Monthly",
        loan_type_fields: generatedDynamicFields,
        parties: generatedParties,
        documents_checklist: documentsChecklist,
        ...(useEkyc ? { ekyc_order_id: ekycOrderId, ekyc_doc_type: ekycDocType } : {}),
      },
    });
  };

  if (step === 1) {
    return (
      <div className="space-y-4">
        <h2 className="text-sm font-bold uppercase tracking-wide mb-3" style={{ color: theme.navy, fontFamily: serif }}>
          {document.doc_name} Application
        </h2>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: theme.slate }}>Language</label>
          <select value={language} onChange={e => setLanguage(e.target.value)} className={inputClass} style={baseInputStyle}>
            {document.available_languages?.map(lang => (
              <option key={lang} value={lang}>{lang}</option>
            )) || <option value="English">English</option>}
          </select>
        </div>

        <div className="pt-4 border-t" style={{ borderColor: theme.border }}>
          <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: theme.slate }}>Applicant Identity Verification</label>
          <div className="flex gap-2 items-center flex-wrap">
            <button type="button" onClick={() => setUseEkyc(false)} className="px-4 py-2 rounded text-sm font-semibold border" style={{ background: !useEkyc ? theme.navy : "#fff", color: !useEkyc ? "#fff" : theme.ink, borderColor: !useEkyc ? theme.navy : theme.border }}>
              Manual Form
            </button>
            <button type="button" disabled={!ekycAvailable} onClick={() => setUseEkyc(true)} title={ekycAvailable ? "" : "eKYC isn't enabled for your account"} className="px-4 py-2 rounded text-sm font-semibold border disabled:opacity-50 disabled:cursor-not-allowed" style={{ background: useEkyc ? theme.navy : "#fff", color: useEkyc ? "#fff" : theme.ink, borderColor: useEkyc ? theme.navy : theme.border }}>
              Continue with eKYC{ekycAvailable ? ` (₹${ekycService.price})` : ""}
            </button>
          </div>
          {!ekycAvailable && (
            <p className="text-xs mt-1.5" style={{ color: theme.slate }}>eKYC verification isn't enabled for your account — contact your Partner admin to enable it.</p>
          )}
        </div>

        {useEkyc && (
          <div className="space-y-4 pt-4 border-t" style={{ borderColor: theme.border }}>
            <h3 className="text-xs font-bold uppercase tracking-wide" style={{ color: theme.navy }}>Identity Verification</h3>

            {ekycStage === "done" ? (
              <div className="p-3 rounded text-sm bg-green-50 text-green-700 border border-green-200">
                Identity verified{ekycFields.length > 0 ? " — " + ekycFields.map(f => `${f.label}: ${f.value}`).join(", ") : ""}.
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: theme.slate }}>Applicant Mobile</label>
                    <input type="text" value={ekycMobile} onChange={e => setEkycMobile(e.target.value)} placeholder="Optional" disabled={ekycStage === "verifying" || ekycStage === "fetching"} className={inputClass} style={baseInputStyle} />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: theme.slate }}>Document Type</label>
                    <select value={ekycDocType} onChange={e => setEkycDocType(e.target.value)} disabled={ekycStage === "verifying" || ekycStage === "fetching"} className={inputClass} style={baseInputStyle}>
                      <option value="">Select document type</option>
                      {EKYC_DOC_TYPES.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: theme.slate }}>Upload ID Document</label>
                    <input type="file" accept="image/jpeg,image/png,application/pdf" onChange={e => setEkycFile(e.target.files?.[0] || null)} disabled={ekycStage === "verifying" || ekycStage === "fetching"} className={inputClass} style={baseInputStyle} />
                  </div>
                </div>

                <p className="text-xs" style={{ color: theme.slate }}>
                  Verifying will create a separate eKYC order and charge ₹{ekycService?.price} from your wallet.
                </p>

                {ekycError && (
                  <div className="p-3 rounded text-sm bg-red-50 text-red-700 border border-red-200">{ekycError}</div>
                )}
                {ekycFields.length > 0 && ekycStage === "failed" && (
                  <div className="p-3 rounded text-xs bg-slate-50 border" style={{ borderColor: theme.border }}>
                    {ekycFields.map(f => <div key={f.key}>{f.label}: {f.value}</div>)}
                  </div>
                )}

                {ekycStage === "digilocker_pending" ? (
                  <button type="button" onClick={handleFetchAadhaarDetails} disabled={ekycStage === "fetching"} className="px-4 py-2 rounded text-sm font-semibold text-white disabled:opacity-60" style={{ background: theme.navy }}>
                    I've completed DigiLocker — Fetch Aadhaar Details
                  </button>
                ) : (
                  <button type="button" onClick={handleStartEkycVerification} disabled={ekycStage === "verifying"} className="px-4 py-2 rounded text-sm font-semibold text-white disabled:opacity-60" style={{ background: theme.navy }}>
                    {ekycStage === "verifying" ? "Verifying..." : "Verify Identity"}
                  </button>
                )}
              </>
            )}
          </div>
        )}

        <div className="pt-4 border-t" style={{ borderColor: theme.border }}>
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wide" style={{ color: theme.navy }}>Applicant Management</h3>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => addParty("co_applicant")}
                disabled={coApplicantCount >= MAX_CO_APPLICANTS}
                className="text-xs font-semibold px-3 py-1.5 rounded border disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ borderColor: theme.border, color: theme.navy }}
              >
                + Add Co-Applicant
              </button>
              <button
                type="button"
                onClick={() => addParty("guarantor")}
                disabled={guarantorCount >= MAX_GUARANTORS}
                className="text-xs font-semibold px-3 py-1.5 rounded border disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ borderColor: theme.border, color: theme.navy }}
              >
                + Add Guarantor
              </button>
            </div>
          </div>
          <p className="text-xs mb-3" style={{ color: theme.slate }}>
            {useEkyc ? "The Applicant's name/DOB/PAN/Aadhaar are filled from eKYC — edit if needed." : "Fill in the Applicant, then add Co-Applicants or Guarantors as needed."} Parties without a valid mobile number won't receive an eSign invite.
          </p>
          {partyRows.map(({ party, idx, label }) => (
            <PartyCard
              key={idx}
              party={party}
              roleLabel={label}
              removable={party.role !== "applicant"}
              onRemove={() => removeParty(idx)}
              onChange={(updated) => updateParty(idx, updated)}
            />
          ))}
        </div>

        <div>
          <h3 className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: theme.navy }}>Loan Details</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: theme.slate }}>Loan Amount</label>
              <input type="number" value={formData.loanAmount} onChange={e => setField("loanAmount", e.target.value)} className={inputClass} style={baseInputStyle} />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: theme.slate }}>Tenure (Months)</label>
              <input type="number" value={formData.tenure} onChange={e => setField("tenure", e.target.value)} className={inputClass} style={baseInputStyle} />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: theme.slate }}>Interest Rate (% p.a.)</label>
              <input type="number" value={formData.interestRate} onChange={e => setField("interestRate", e.target.value)} placeholder="12" className={inputClass} style={baseInputStyle} />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: theme.slate }}>Repayment Frequency</label>
              <select value={formData.repaymentFrequency} onChange={e => setField("repaymentFrequency", e.target.value)} className={inputClass} style={baseInputStyle}>
                {REPAYMENT_FREQUENCIES.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
          </div>
        </div>

        {loanType.sections.map((s) => (
          <SectionFieldGrid
            key={s.title}
            title={s.title}
            fields={s.fields}
            values={typeFields}
            onChange={updateTypeField}
          />
        ))}

        <SectionFieldGrid
          title="Repayment & Security"
          fields={loanType.repaymentSecurity}
          values={typeFields}
          onChange={updateTypeField}
        />

        <div className="pt-4 border-t" style={{ borderColor: theme.border }}>
          <h3 className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: theme.navy }}>Documents Checklist</h3>
          {checklistLoading ? (
            <p className="text-xs" style={{ color: theme.slate }}>Loading checklist...</p>
          ) : visibleChecklistItems.length === 0 ? (
            <p className="text-xs" style={{ color: theme.slate }}>No documents required.</p>
          ) : (
            <div className="space-y-2">
              {visibleChecklistItems.map((item) => (
                <label key={item.key} className="flex items-start gap-2 text-sm">
                  <input type="checkbox" checked={confirmedDocKeys.has(item.key)} onChange={() => toggleDocConfirmed(item.key)} className="mt-0.5" />
                  <span>
                    {item.document_name}
                    {item.is_mandatory && <span className="text-red-600"> *</span>}
                    {item.description && <span className="block text-xs" style={{ color: theme.slate }}>{item.description}</span>}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>

        {useEkyc && ekycStage !== "done" && (
          <p className="text-xs" style={{ color: theme.slate }}>Complete Applicant identity verification above before generating the draft.</p>
        )}

        <div className="flex gap-2 mt-4 pt-4 border-t" style={{ borderColor: theme.border }}>
          <button onClick={onCancel} className="px-5 py-2.5 rounded text-sm font-semibold border" style={{ background: "#fff", borderColor: theme.border }}>Cancel</button>
          <button disabled={generating || (useEkyc && ekycStage !== "done")} onClick={handleGenerateDraft} className="px-5 py-2.5 rounded text-sm font-semibold text-white disabled:opacity-60" style={{ background: theme.navy }}>
            {generating ? "Generating..." : "Generate Draft"}
          </button>
        </div>
      </div>
    );
  }

  if (step === 2) {
    return (
      <div className="space-y-4">
        <h2 className="text-sm font-bold uppercase tracking-wide mb-3" style={{ color: theme.navy, fontFamily: serif }}>
          Draft Preview
        </h2>

        {pdfPreviewUrl ? (
          <iframe title="Generated loan document" src={pdfPreviewUrl} className="w-full rounded border" style={{ height: '480px', borderColor: theme.border }} />
        ) : (
          <div className="p-4 rounded border text-sm text-center" style={{ background: "#f8fafc", borderColor: theme.border, minHeight: '200px' }}>
            Preview unavailable.
          </div>
        )}

        <div className="pt-4 border-t" style={{ borderColor: theme.border }}>
          <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: theme.slate }}>Finalization</label>
          <div className="flex gap-2">
            <button type="button" onClick={() => setRequireEsign(true)} className="px-4 py-2 rounded text-sm font-semibold border" style={{ background: requireEsign ? theme.navy : "#fff", color: requireEsign ? "#fff" : theme.ink, borderColor: requireEsign ? theme.navy : theme.border }}>
              Verify with eSign
            </button>
            <button type="button" onClick={() => setRequireEsign(false)} className="px-4 py-2 rounded text-sm font-semibold border" style={{ background: !requireEsign ? theme.navy : "#fff", color: !requireEsign ? "#fff" : theme.ink, borderColor: !requireEsign ? theme.navy : theme.border }}>
              Without Sign
            </button>
          </div>
          {requireEsign && (
            <p className="text-xs mt-1.5" style={{ color: theme.slate }}>
              eSign invites will be sent to the Applicant and every Co-Applicant/Guarantor who has a valid mobile number entered.
            </p>
          )}
        </div>

        <div className="flex gap-2 mt-4 pt-4 border-t" style={{ borderColor: theme.border }}>
          <button onClick={() => setStep(1)} className="px-5 py-2.5 rounded text-sm font-semibold border" style={{ background: "#fff", borderColor: theme.border }}>Back</button>
          <button onClick={handleFinalize} className="px-5 py-2.5 rounded text-sm font-semibold text-white" style={{ background: theme.navy }}>
            {requireEsign ? "Send for eSign" : "Save Document"}
          </button>
        </div>
      </div>
    );
  }
}
