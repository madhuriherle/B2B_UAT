// Shared display helpers for eKYC's General Document Verification
// (b2b_ekyc_verification.extracted_data) and DigiLocker Get Aadhaar Details
// (b2b_digilocker_verification.aadhaar_data) result blobs. Neither field set
// is documented with a fixed schema, so this filters/labels/masks by key
// pattern rather than assuming an exact shape — unknown keys still render
// (title-cased) rather than silently disappearing, but noisy/binary/internal
// keys are dropped and anything that looks like a document/ID number is
// masked to its last 4 characters.

const EKYC_FIELD_LABELS = {
  name: "Name",
  full_name: "Name",
  given_name: "Given Name",
  given_names: "Given Names",
  surname: "Surname",
  father_name: "Father's Name",
  care_of: "Care Of",
  co: "Care Of",
  dob: "Date of Birth",
  date_of_birth: "Date of Birth",
  gender: "Gender",
  sex: "Gender",
  age: "Age",
  address: "Address",
  full_address: "Address",
  nationality: "Nationality",
  country: "Issuing Country",
  issuing_country: "Issuing Country",
  document_number: "Document Number",
  id_number: "ID Number",
  passport_number: "Passport Number",
  aadhaar_number: "Aadhaar Number",
  uid: "Aadhaar Number",
  date_of_issue: "Date of Issue",
  issue_date: "Date of Issue",
  date_of_expiry: "Date of Expiry",
  expiry_date: "Date of Expiry",
  place_of_issue: "Place of Issue",
  place_of_birth: "Place of Birth",
  pincode: "PIN Code",
  pin_code: "PIN Code",
  state: "State",
  district: "District",
  city: "City",
  vtc: "Town/City",
  house: "House",
  landmark: "Landmark",
  mrz: "MRZ",
  mrz_line1: "MRZ Line 1",
  mrz_line2: "MRZ Line 2",
  mrz_line3: "MRZ Line 3",
};

// Noisy/binary/internal keys that either duplicate what the page already
// shows elsewhere (status/verified/reference_id) or are large blobs not
// meant for inline display (photo/signature/xml/qr).
const EKYC_HIDDEN_FIELD_KEYS = new Set([
  "status",
  "verified",
  "reference_id",
  "transaction_id",
  "split_address",
  "source",
  "photo",
  "image",
  "signature",
  "face",
  "face_image",
  "xml_file",
  "qr_code",
  "barcode",
]);

// Fields that hold a document/identity number — masked to the last 4
// characters so a full Aadhaar/passport/licence number is never displayed
// (see digilocker_service.py's own uid/xml_file redaction for the same rule
// applied server-side to Aadhaar specifically).
const MASKED_KEY_PATTERN = /aadhaar|uid|passport.?no|document.?number|id.?number|licen[cs]e.?number|voter.?id/i;

const titleCase = (key) =>
  key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

const maskEkycFieldValue = (key, value) => {
  const str = String(value);
  if (MASKED_KEY_PATTERN.test(key) && str.length > 4) {
    return `${"•".repeat(Math.max(str.length - 4, 4))}${str.slice(-4)}`;
  }
  return str;
};

// Returns [{ key, label, value }] ready to render — filtered, labeled and
// masked. `data` may be null/undefined (nothing submitted/fetched yet).
export const renderableEkycFields = (data) => {
  if (!data || typeof data !== "object") return [];
  return Object.entries(data)
    .filter(([key, value]) => !EKYC_HIDDEN_FIELD_KEYS.has(key.toLowerCase()) && value !== null && value !== "")
    .map(([key, value]) => ({
      key,
      label: EKYC_FIELD_LABELS[key.toLowerCase()] || titleCase(key),
      value: maskEkycFieldValue(key, typeof value === "object" ? JSON.stringify(value) : value),
    }));
};
