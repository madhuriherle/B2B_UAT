import { useState, useEffect, useRef } from 'react';
import { theme, serif, inputStyle as baseInputStyle } from "../../lib/userPortalTheme";
import { apiUrl, apiRequest, apiUpload, getStoredToken } from "../../lib/api";
import { isValidMobile, isValidEmail } from "../../lib/validation";
import { renderableEkycFields } from "../../lib/ekycFields";
import {
  User, UserPlus, ShieldCheck, IdCard, MapPin, Briefcase, Wallet, CreditCard, Landmark, Gem, Contact, Plus,
  Upload, FileCheck2, X, Download,
} from "lucide-react";

const inputClass = "w-full px-4 py-2.5 text-sm rounded outline-none transition-all disabled:cursor-not-allowed";

const EKYC_DOC_TYPES = [
  { value: "aadhaar_card", label: "Aadhaar Card" },
  { value: "pan_card", label: "PAN Card" },
];

const REPAYMENT_FREQUENCIES = ["Monthly", "Quarterly", "Half-Yearly", "Yearly"];

// States/UTs — a stable, rarely-changing list, safe to hardcode (unlike
// districts, which the GoI reorganizes/renames often enough that a static
// list would silently go stale — see the pincode-based lookup below for
// District/City instead).
const INDIAN_STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana",
  "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur",
  "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana",
  "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
  "Andaman and Nicobar Islands", "Chandigarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi",
  "Jammu and Kashmir", "Ladakh", "Lakshadweep", "Puducherry",
];

// District suggestions per state — NOT a locked dropdown (see District's
// `type: "suggest"` in PARTY_ADDRESS_FIELDS below): the District input
// stays free text, this just narrows the autocomplete list to the
// currently-selected state's districts once one is picked, and the user
// can still type anything the list doesn't have (a renamed/split/new
// district). Union Territories aren't included (too few districts each to
// be worth listing). Source: user-supplied list compiled from GoI's
// Integrated Government Online Directory (I-God), 2026-09 — the same
// staleness risk as any hardcoded district list applies, softened by this
// being suggestions rather than a hard constraint.
const STATE_DISTRICTS = {
  "Andhra Pradesh": ["Alluri Sitharama Raju", "Anakapalli", "Ananthapuramu", "Annamayya", "Bapatla", "Chittoor", "Dr. B.R. Ambedkar Konaseema", "East Godavari", "Eluru", "Guntur", "Kakinada", "Krishna", "Kurnool", "Markapuram", "Nandyal", "NTR", "Palnadu", "Parvathipuram Manyam", "Polavaram", "Prakasam", "Sri Potti Sriramulu Nellore", "Sri Sathya Sai", "Srikakulam", "Tirupati", "Visakhapatnam", "Vizianagaram", "West Godavari", "YSR Kadapa"],
  "Arunachal Pradesh": ["Anjaw", "Bichom", "Changlang", "Dibang Valley", "East Kameng", "East Siang", "Kamle", "Keyi Panyor", "Kra Daadi", "Kurung Kumey", "Leparada", "Lohit", "Longding", "Lower Dibang Valley", "Lower Siang", "Lower Subansiri", "Namsai", "Pakke Kessang", "Papum Pare", "Shi Yomi", "Siang", "Tawang", "Tirap", "Upper Siang", "Upper Subansiri", "West Kameng", "West Siang"],
  "Assam": ["Bajali", "Baksa", "Barpeta", "Biswanath", "Bongaigaon", "Cachar", "Charaideo", "Chirang", "Darrang", "Dhemaji", "Dhubri", "Dibrugarh", "Dima Hasao", "Goalpara", "Golaghat", "Hailakandi", "Hojai", "Jorhat", "Kamrup", "Kamrup Metropolitan", "Karbi Anglong", "Kokrajhar", "Lakhimpur", "Majuli", "Morigaon", "Nagaon", "Nalbari", "Sivasagar", "Sonitpur", "South Salmara-Mankachar", "Tamulpur", "Tinsukia", "Udalguri", "Sribhumi", "West Karbi Anglong"],
  "Bihar": ["Araria", "Arwal", "Aurangabad", "Banka", "Begusarai", "Bhagalpur", "Bhojpur", "Buxar", "Darbhanga", "Gaya", "Gopalganj", "Jamui", "Jehanabad", "Kaimur", "Katihar", "Khagaria", "Kishanganj", "Lakhisarai", "Madhepura", "Madhubani", "Munger", "Muzaffarpur", "Nalanda", "Nawada", "Pashchim Champaran", "Patna", "Purba Champaran", "Purnia", "Rohtas", "Saharsa", "Samastipur", "Saran", "Sheikhpura", "Sheohar", "Sitamarhi", "Siwan", "Supaul", "Vaishali"],
  "Chhattisgarh": ["Balod", "Balodabazar-Bhatapara", "Balrampur-Ramanujganj", "Bastar", "Bemetara", "Bijapur", "Bilaspur", "Dakshin Bastar Dantewada", "Dhamtari", "Durg", "Gariyaband", "Gaurela-Pendra-Marwahi", "Janjgir-Champa", "Jashpur", "Kabeerdham", "Khairagarh-Chhuikhadan-Gandai", "Kondagaon", "Korba", "Korea", "Mahasamund", "Manendragarh-Chirmiri-Bharatpur", "Mohla-Manpur-Ambagarh Chouki", "Mungeli", "Narayanpur", "Raigarh", "Raipur", "Rajnandgaon", "Sakti", "Sarangarh-Bilaigarh", "Surajpur", "Surguja", "Sukma", "Uttar Bastar Kanker"],
  "Goa": ["Kushavati", "North Goa", "South Goa"],
  "Gujarat": ["Ahmedabad", "Amreli", "Anand", "Arvalli", "Banas Kantha", "Bharuch", "Bhavnagar", "Botad", "Chhota Udepur", "Dahod", "Dang", "Devbhumi Dwarka", "Gandhinagar", "Gir Somnath", "Jamnagar", "Junagadh", "Kachchh", "Kheda", "Mahesana", "Mahisagar", "Morbi", "Narmada", "Navsari", "Panch Mahals", "Patan", "Porbandar", "Rajkot", "Sabarkantha", "Surat", "Surendranagar", "Tapi", "Vadodara", "Valsad", "Banaskantha"],
  "Haryana": ["Ambala", "Bhiwani", "Charkhi Dadri", "Faridabad", "Fatehabad", "Gurugram", "Hansi", "Hisar", "Jhajjar", "Jind", "Kaithal", "Karnal", "Kurukshetra", "Mahendragarh", "Nuh", "Palwal", "Panchkula", "Panipat", "Rewari", "Rohtak", "Sirsa", "Sonipat", "Yamunanagar"],
  "Himachal Pradesh": ["Bilaspur", "Chamba", "Hamirpur", "Kangra", "Kinnaur", "Kullu", "Lahaul and Spiti", "Mandi", "Shimla", "Sirmaur", "Solan", "Una"],
  "Jharkhand": ["Bokaro", "Chatra", "Deoghar", "Dhanbad", "Dumka", "East Singhbhum", "Garhwa", "Giridih", "Godda", "Gumla", "Hazaribagh", "Jamtara", "Khunti", "Koderma", "Latehar", "Lohardaga", "Pakur", "Palamu", "Ramgarh", "Ranchi", "Sahibganj", "Saraikela Kharsawan", "Simdega", "West Singhbhum"],
  "Karnataka": ["Bagalkote", "Ballari", "Belagavi", "Bengaluru Rural", "Bengaluru Urban", "Bengaluru South", "Bidar", "Chamarajanagar", "Chikkaballapura", "Chikkamagaluru", "Chitradurga", "Dakshina Kannada", "Davanagere", "Dharwad", "Gadag", "Hassan", "Haveri", "Kalaburagi", "Kodagu", "Kolar", "Koppal", "Mandya", "Mysuru", "Raichur", "Ramanagara", "Shivamogga", "Tumakuru", "Udupi", "Uttara Kannada", "Vijayapura", "Yadgir"],
  "Kerala": ["Alappuzha", "Ernakulam", "Idukki", "Kannur", "Kasaragod", "Kollam", "Kottayam", "Kozhikode", "Malappuram", "Palakkad", "Pathanamthitta", "Thiruvananthapuram", "Thrissur", "Wayanad"],
  "Madhya Pradesh": ["Agar-Malwa", "Alirajpur", "Anuppur", "Ashoknagar", "Balaghat", "Barwani", "Betul", "Bhind", "Bhopal", "Burhanpur", "Chhatarpur", "Chhindwara", "Damoh", "Datia", "Dewas", "Dhar", "Dindori", "Guna", "Gwalior", "Harda", "Indore", "Jabalpur", "Jhabua", "Katni", "Khandwa", "Khargone", "Maihar", "Mandla", "Mandsaur", "Mauganj", "Morena", "Narmadapuram", "Narsinghpur", "Neemuch", "Niwari", "Panna", "Raisen", "Rajgarh", "Ratlam", "Rewa", "Sagar", "Satna", "Sehore", "Seoni", "Shahdol", "Shajapur", "Sheopur", "Shivpuri", "Sidhi", "Singrauli", "Tikamgarh", "Ujjain", "Umaria", "Vidisha", "Pandhurna"],
  "Maharashtra": ["Ahilyanagar", "Akola", "Amravati", "Beed", "Bhandara", "Buldhana", "Chandrapur", "Chhatrapati Sambhajinagar", "Dharashiv", "Dhule", "Gadchiroli", "Gondia", "Hingoli", "Jalgaon", "Jalna", "Kolhapur", "Latur", "Mumbai", "Mumbai Suburban", "Nagpur", "Nanded", "Nandurbar", "Nashik", "Palghar", "Parbhani", "Pune", "Raigad", "Ratnagiri", "Sangli", "Satara", "Sindhudurg", "Solapur", "Thane", "Wardha", "Washim", "Yavatmal"],
  "Manipur": ["Bishnupur", "Chandel", "Churachandpur", "Imphal East", "Imphal West", "Jiribam", "Kakching", "Kamjong", "Kangpokpi", "Noney", "Pherzawl", "Senapati", "Tamenglong", "Tengnoupal", "Thoubal", "Ukhrul"],
  "Meghalaya": ["East Garo Hills", "East Jaintia Hills", "East Khasi Hills", "Eastern West Khasi Hills", "North Garo Hills", "Ri Bhoi", "South Garo Hills", "South West Garo Hills", "South West Khasi Hills", "West Garo Hills", "West Jaintia Hills", "West Khasi Hills"],
  "Mizoram": ["Aizawl", "Champhai", "Hnahthial", "Khawzawl", "Kolasib", "Lawngtlai", "Lunglei", "Mamit", "Saiha", "Saitual", "Serchhip"],
  "Nagaland": ["Chümoukedima", "Dimapur", "Kiphire", "Kohima", "Longleng", "Meluri", "Mokokchung", "Mon", "Niuland", "Noklak", "Peren", "Phek", "Shamator", "Tseminyu", "Tuensang", "Wokha", "Zunheboto"],
  "Odisha": ["Angul", "Boudh", "Balangir", "Bargarh", "Balasore", "Bhadrak", "Cuttack", "Deogarh", "Dhenkanal", "Gajapati", "Ganjam", "Jagatsinghpur", "Jajpur", "Jharsuguda", "Kalahandi", "Kandhamal", "Kendrapara", "Kendujhar", "Khordha", "Koraput", "Malkangiri", "Mayurbhanj", "Nabarangpur", "Nayagarh", "Nuapada", "Puri", "Rayagada", "Sambalpur", "Subarnapur", "Sundargarh"],
  "Punjab": ["Amritsar", "Barnala", "Bathinda", "Faridkot", "Fatehgarh Sahib", "Fazilka", "Ferozepur", "Gurdaspur", "Hoshiarpur", "Jalandhar", "Kapurthala", "Ludhiana", "Malerkotla", "Mansa", "Moga", "Muktsar", "Pathankot", "Patiala", "Rupnagar", "Sahibzada Ajit Singh Nagar", "Sangrur", "Shaheed Bhagat Singh Nagar", "Tarn Taran"],
  "Rajasthan": ["Ajmer", "Alwar", "Balotra", "Banswara", "Baran", "Barmer", "Beawar", "Bharatpur", "Bhilwara", "Bikaner", "Bundi", "Chittorgarh", "Churu", "Dausa", "Deeg", "Dholpur", "Didwana-Kuchamana", "Dudu", "Dungarpur", "Ganganagar", "Hanumangarh", "Jaipur", "Jaipur Rural", "Jaisalmer", "Jalore", "Jhalawar", "Jhunjhunu", "Jodhpur", "Jodhpur Rural", "Karauli", "Kekri", "Kota", "Kotputli-Behror", "Nagaur", "Pali", "Phalodi", "Pratapgarh", "Rajsamand", "Sawai Madhopur", "Sikar", "Sirohi", "Tonk", "Udaipur"],
  "Sikkim": ["Gangtok", "Gyalshing", "Mangan", "Namchi", "Pakyong", "Soreng"],
  "Tamil Nadu": ["Ariyalur", "Chengalpattu", "Chennai", "Coimbatore", "Cuddalore", "Dharmapuri", "Dindigul", "Erode", "Kallakurichi", "Kancheepuram", "Karur", "Krishnagiri", "Madurai", "Mayiladuthurai", "Nagapattinam", "Kanniyakumari", "Namakkal", "Perambalur", "Pudukottai", "Ramanathapuram", "Ranipet", "Salem", "Sivaganga", "Tenkasi", "Thanjavur", "Theni", "Thoothukudi", "Tiruchirappalli", "Thirunelveli", "Tirupathur", "Tiruppur", "Tiruvallur", "Tiruvannamalai", "Tiruvarur", "Vellore", "Viluppuram", "Virudhunagar", "The Nilgiris"],
  "Telangana": ["Adilabad", "Bhadradri Kothagudem", "Hanamkonda", "Hyderabad", "Jagtial", "Jangaon", "Jayashankar Bhupalpally", "Jogulamba Gadwal", "Kamareddy", "Karimnagar", "Khammam", "Komaram Bheem Asifabad", "Mahabubabad", "Mahabubnagar", "Mancherial", "Medak", "Medchal-Malkajgiri", "Mulugu", "Nagarkurnool", "Nalgonda", "Narayanpet", "Nirmal", "Nizamabad", "Peddapalli", "Rajanna Sircilla", "Rangareddy", "Sangareddy", "Siddipet", "Suryapet", "Vikarabad", "Wanaparthy", "Warangal", "Yadadri Bhuvanagiri"],
  "Tripura": ["Dhalai", "Gomati", "Khowai", "North Tripura", "Sepahijala", "South Tripura", "Unakoti", "West Tripura"],
  "Uttar Pradesh": ["Agra", "Aligarh", "Ambedkar Nagar", "Amethi", "Amroha", "Auraiya", "Ayodhya", "Azamgarh", "Baghpat", "Bahraich", "Ballia", "Balrampur", "Banda", "Barabanki", "Bareilly", "Basti", "Bhadohi", "Bijnor", "Budaun", "Bulandshahr", "Chandauli", "Chitrakoot", "Deoria", "Etah", "Etawah", "Farrukhabad", "Fatehpur", "Firozabad", "Gautam Buddha Nagar", "Ghaziabad", "Ghazipur", "Gonda", "Gorakhpur", "Hamirpur", "Hapur", "Hardoi", "Hathras", "Jalaun", "Jaunpur", "Jhansi", "Kannauj", "Kanpur Dehat", "Kanpur Nagar", "Kasganj", "Kaushambi", "Kushinagar", "Lakhimpur Kheri", "Lalitpur", "Lucknow", "Maharajganj", "Mahoba", "Mainpuri", "Mathura", "Mau", "Meerut", "Mirzapur", "Moradabad", "Muzaffarnagar", "Pilibhit", "Pratapgarh", "Prayagraj", "Rae Bareli", "Rampur", "Saharanpur", "Sambhal", "Sant Kabir Nagar", "Shahjahanpur", "Shamli", "Shravasti", "Siddharthnagar", "Sitapur", "Sonbhadra", "Sultanpur", "Unnao", "Varanasi"],
  "Uttarakhand": ["Almora", "Bageshwar", "Chamoli", "Champawat", "Dehradun", "Haridwar", "Nainital", "Pauri Garhwal", "Pithoragarh", "Rudraprayag", "Tehri Garhwal", "Udham Singh Nagar", "Uttarkashi"],
  "West Bengal": ["Alipurduar", "Bankura", "Paschim Bardhaman", "Purba Bardhaman", "Birbhum", "Cooch Behar", "Dakshin Dinajpur", "Darjeeling", "Hooghly", "Howrah", "Jalpaiguri", "Jhargram", "Kalimpong", "Kolkata", "Maldah", "Murshidabad", "Nadia", "North 24 Parganas", "Paschim Medinipur", "Purba Medinipur", "South 24 Parganas", "Uttar Dinajpur"],
  // Union Territories — far fewer districts each, standard/stable list.
  "Andaman and Nicobar Islands": ["Nicobar", "North and Middle Andaman", "South Andaman"],
  "Chandigarh": ["Chandigarh"],
  "Dadra and Nagar Haveli and Daman and Diu": ["Dadra and Nagar Haveli", "Daman", "Diu"],
  "Delhi": ["Central Delhi", "East Delhi", "New Delhi", "North Delhi", "North East Delhi", "North West Delhi", "Shahdara", "South Delhi", "South East Delhi", "South West Delhi", "West Delhi"],
  "Jammu and Kashmir": ["Anantnag", "Bandipora", "Baramulla", "Budgam", "Doda", "Ganderbal", "Jammu", "Kathua", "Kishtwar", "Kulgam", "Kupwara", "Poonch", "Pulwama", "Rajouri", "Ramban", "Reasi", "Samba", "Shopian", "Srinagar", "Udhampur"],
  "Ladakh": ["Kargil", "Leh"],
  "Lakshadweep": ["Lakshadweep"],
  "Puducherry": ["Karaikal", "Mahe", "Puducherry", "Yanam"],
};

// India Post's public pincode API — used to auto-fill City/District/State
// from a 6-digit PIN code instead of a hand-maintained district dropdown
// (see INDIAN_STATES comment above for why). Small in-memory cache so
// re-typing/correcting a digit doesn't re-fetch the same pincode.
const _pincodeCache = new Map();

// State/District are now locked <select> dropdowns (see FieldGrid), so a
// pincode lookup result is only useful if it's one of the actual option
// strings — India Post's naming doesn't always match GoI's exactly (e.g.
// "Bangalore" vs "Bengaluru Urban"). Exact match first, then a loose
// substring match either direction; "" (blank, falls back to the
// placeholder) if nothing lines up, rather than setting a value the
// dropdown can't actually display.
function matchFromList(list, raw) {
  if (!raw) return "";
  const normalized = raw.trim().toLowerCase();
  const exact = list.find((o) => o.toLowerCase() === normalized);
  if (exact) return exact;
  return list.find((o) => o.toLowerCase().includes(normalized) || normalized.includes(o.toLowerCase())) || "";
}

async function lookupPincode(pincode) {
  if (_pincodeCache.has(pincode)) return _pincodeCache.get(pincode);
  let result = null;
  try {
    const res = await fetch(`https://api.postalpincode.in/pincode/${pincode}`);
    const data = await res.json();
    const postOffice = data?.[0]?.Status === "Success" ? data[0].PostOffice?.[0] : null;
    if (postOffice) {
      const matchedState = matchFromList(INDIAN_STATES, postOffice.State);
      const matchedDistrict = matchedState ? matchFromList(STATE_DISTRICTS[matchedState] || [], postOffice.District) : "";
      result = { city: postOffice.Name || "", district: matchedDistrict, state: matchedState };
    }
  } catch {
    result = null; // offline / API unavailable — leave fields as the user typed them
  }
  _pincodeCache.set(pincode, result);
  return result;
}

const ROLE_LABELS = { applicant: "Applicant", co_applicant: "Co-Applicant", guarantor: "Guarantor" };
const ROLE_ICONS = { applicant: User, co_applicant: UserPlus, guarantor: ShieldCheck };
// theme.gold is actually the same navy hex as theme.navy in this theme
// (not a real gold) — a muted amber literal gives Guarantor its own
// identity instead of looking identical to Applicant.
const ROLE_COLORS = { applicant: theme.navy, co_applicant: theme.success, guarantor: "#A16207" };
const MAX_CO_APPLICANTS = 3;
const MAX_GUARANTORS = 2;
const SIGNER_POSITIONS = ["bottom-right", "bottom-left", "top-right", "top-left"];

// Icon per PartyCard/RepeatingRowsSection heading — purely decorative, same
// data either way.
const SECTION_ICONS = {
  "Personal / KYC": IdCard,
  "Address": MapPin,
  "Employment / Business": Briefcase,
  "Income Sources": Wallet,
  "Existing Loans": CreditCard,
  "Bank Accounts": Landmark,
  "Assets": Gem,
  "References": Contact,
};

const SectionHeading = ({ title }) => {
  const Icon = SECTION_ICONS[title];
  return (
    <h4 className="text-xs font-bold uppercase tracking-wide mb-2 flex items-center gap-1.5" style={{ color: theme.navy }}>
      {Icon && <Icon size={14} strokeWidth={2.25} />}
      {title}
    </h4>
  );
};

// Every loan-TYPE-specific field the backend can render (vehicle/property/
// farm details — these describe the loan itself, not a party), keyed by its
// dynamic_fields key — mirrors app/loan_i18n.py's FIELD_LABELS /
// LOAN_TYPE_CONFIG 1:1, so what the form collects lands under the right PDF
// heading. Per-party fields (personal/address/employment/income/existing
// loans/bank accounts/assets/references) are handled separately below by
// PartyCard, since they repeat once per Applicant/Co-Applicant/Guarantor.
const FIELD_TYPES = {
  property_address: { label: "Property Address", type: "text", required: true },
  property_type: { label: "Property Type", type: "select", options: ["Residential", "Commercial", "Plot / Land", "Under Construction"], required: true },
  property_value: { label: "Property Value", type: "number", required: true },
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

  vehicle_type: { label: "Vehicle Type", type: "text", required: true },
  new_or_used: { label: "New / Used", type: "select", options: ["New", "Used"] },
  manufacturer: { label: "Manufacturer / Make", type: "text", required: true },
  brand_model: { label: "Brand / Model", type: "text", required: true },
  variant: { label: "Variant", type: "text" },
  manufacturing_year: { label: "Manufacturing Year", type: "text" },
  registration_number: { label: "Registration Number", type: "text" },
  chassis_number: { label: "Chassis Number", type: "text" },
  engine_number: { label: "Engine Number", type: "text" },
  ex_showroom_price: { label: "Ex-Showroom Price", type: "number", required: true },
  on_road_price: { label: "On-Road Price", type: "number" },
  dealer_name: { label: "Dealer Name", type: "text", required: true },
  dealer_address: { label: "Dealer Address", type: "text" },
  dealer_contact: { label: "Dealer Contact", type: "text" },
  hypothecation_details: { label: "Vehicle Hypothecation Details", type: "text" },

  existing_emi_amount: { label: "Existing EMI Amount", type: "number" },
  monthly_expenses: { label: "Monthly Expenses", type: "number" },
  other_income: { label: "Other Income", type: "number" },
  required_loan_amount: { label: "Required Loan Amount", type: "number" },
  prepayment_terms: { label: "Prepayment Terms", type: "text" },
  security_collateral: { label: "Security / Collateral", type: "text" },

  farm_location: { label: "Farm Location", type: "text", required: true },
  village: { label: "Village", type: "text", required: true },
  taluk: { label: "Taluk", type: "text" },
  district: { label: "District", type: "text" },
  state: { label: "State", type: "select", options: INDIAN_STATES, required: true },
  land_ownership: { label: "Land Ownership", type: "select", options: ["Owned", "Leased", "Co-owned / Family"], required: true },
  total_land_area: { label: "Total Land Area / Acreage", type: "text", required: true },
  cultivated_area: { label: "Cultivated Area", type: "text" },
  survey_number: { label: "Survey Number", type: "text" },
  land_registration_details: { label: "Land Registration Details", type: "text" },
  lease_details: { label: "Lease Details", type: "text" },
  crop_type: { label: "Crop Type", type: "text", required: true },
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

// `required: true` marks the fields that must be filled before a draft can
// be generated (see validatePartiesRequiredFields) — mirrors which fields
// SBI/IDFC/Kotak's own forms treat as compulsory (Name/DOB/PAN/Aadhaar,
// core present-address lines, and Occupation Type), not every field on the
// form.
const PARTY_PERSONAL_FIELDS = [
  { key: "full_name", label: "Full Name", type: "text", required: true },
  { key: "gender", label: "Gender", type: "select", options: ["Male", "Female", "Third Gender"], required: true },
  { key: "date_of_birth", label: "Date of Birth", type: "date", required: true },
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
  { key: "pan_number", label: "PAN Number", type: "text", required: true },
  { key: "aadhaar_number", label: "Aadhaar Number", type: "text", required: true },
  { key: "voter_id", label: "Voter ID Number", type: "text" },
  { key: "driving_license", label: "Driving Licence Number", type: "text" },
  { key: "passport_number", label: "Passport Number", type: "text" },
  { key: "passport_valid_upto", label: "Passport Valid Upto", type: "date" },
];

// Plain address field set — reused as-is for Permanent/Office (optional
// blocks the partner user opts into, so nothing in them is mandatory).
const PARTY_ADDRESS_FIELDS = [
  { key: "house_no", label: "House / Flat / Building No.", type: "text" },
  { key: "street", label: "Street / Area / Locality", type: "text" },
  { key: "landmark", label: "Landmark", type: "text" },
  { key: "city", label: "City", type: "text" },
  { key: "district", label: "District", type: "text" },
  { key: "state", label: "State", type: "select", options: INDIAN_STATES },
  { key: "pincode", label: "Pincode", type: "text", placeholder: "6-digit PIN — fills City/District/State", maxLength: 6 },
  { key: "country", label: "Country", type: "text" },
  { key: "mobile", label: "Mobile Number", type: "text" },
  { key: "email", label: "Email", type: "email" },
];

// Present Address is always collected (it's what customer_email/mobile and
// the eSign invite come from — see handleFinalize), so its core lines are
// required; every other field mirrors PARTY_ADDRESS_FIELDS above.
const PARTY_PRESENT_ADDRESS_FIELDS = PARTY_ADDRESS_FIELDS.map((f) =>
  ["house_no", "city", "state", "pincode", "mobile", "email"].includes(f.key) ? { ...f, required: true } : f
);

const PARTY_EMPLOYMENT_FIELDS = [
  { key: "occupation_type", label: "Occupation Type", type: "select", options: ["Salaried", "Self-Employed Professional", "Business", "Agriculturist", "Pensioner", "Other"], required: true },
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

const FieldInput = ({ fieldKey, value, onChange, siblingValues }) => {
  const cfg = FIELD_TYPES[fieldKey];
  // Farm Details' "district" is state-dependent too, same as party
  // addresses (see FieldGrid) — locked to STATE_DISTRICTS[state].
  if (fieldKey === "district") {
    const districtOptions = STATE_DISTRICTS[siblingValues?.state] || [];
    return (
      <select
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={districtOptions.length === 0}
        className={inputClass}
        style={baseInputStyle}
      >
        <option value="">{districtOptions.length ? "Select district" : "Select state first"}</option>
        {districtOptions.map((d) => <option key={d} value={d}>{d}</option>)}
      </select>
    );
  }
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
          <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: theme.slate }}>
            {FIELD_TYPES[k].label}{FIELD_TYPES[k].required && <span style={{ color: "#dc2626" }}> *</span>}
          </label>
          <FieldInput fieldKey={k} value={values[k]} onChange={(v) => onChange(k, v)} siblingValues={values} />
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
  return (
    <input
      type={inputType}
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={field.placeholder}
      maxLength={field.maxLength}
      className={inputClass}
      style={baseInputStyle}
    />
  );
};

// District is a real dropdown too, not free text — locked to whichever
// State is currently selected (STATE_DISTRICTS), disabled with a "Select
// state first" placeholder until one is. Handled here rather than via a
// static `field.options` list since its options depend on a sibling
// field's live value.
const FieldGrid = ({ fields, values, onChange }) => (
  <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
    {fields.map((f) => {
      if (f.key === "district") {
        const districtOptions = STATE_DISTRICTS[values?.state] || [];
        return (
          <div key={f.key}>
            <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: theme.slate }}>
              {f.label}{f.required && <span style={{ color: "#dc2626" }}> *</span>}
            </label>
            <select
              value={values?.district || ""}
              onChange={(e) => onChange("district", e.target.value)}
              disabled={districtOptions.length === 0}
              className={inputClass}
              style={baseInputStyle}
            >
              <option value="">{districtOptions.length ? "Select district" : "Select state first"}</option>
              {districtOptions.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        );
      }
      return (
        <div key={f.key}>
          <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: theme.slate }}>
            {f.label}{f.required && <span style={{ color: "#dc2626" }}> *</span>}
          </label>
          <SimpleInput field={f} value={values?.[f.key]} onChange={(v) => onChange(f.key, v)} />
        </div>
      );
    })}
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
      <SectionHeading title={title} />
      {rows.length === 0 ? (
        <button
          type="button"
          onClick={addRow}
          className="w-full flex items-center justify-center gap-1.5 py-3 rounded border-2 border-dashed text-xs font-semibold transition-colors hover:bg-slate-50"
          style={{ borderColor: theme.border, color: theme.slate }}
        >
          <Plus size={14} /> Add {title.toLowerCase()}
        </button>
      ) : (
        <>
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
          <button type="button" onClick={addRow} className="text-xs font-semibold inline-flex items-center gap-1" style={{ color: theme.navy }}>
            <Plus size={12} /> Add row
          </button>
        </>
      )}
    </div>
  );
};

// Rough "how much of this party is filled in" indicator — counts non-blank
// values across Personal/KYC, Present Address, and Employment fields.
// Decorative only, doesn't affect validation (see getMissingRequiredFields).
const countPartyProgress = (party) => {
  let filled = 0, total = 0;
  for (const [fields, values] of [
    [PARTY_PERSONAL_FIELDS, party.personal],
    [PARTY_PRESENT_ADDRESS_FIELDS, party.address.present],
    [PARTY_EMPLOYMENT_FIELDS, party.employment],
  ]) {
    for (const f of fields) {
      total += 1;
      if (values?.[f.key]) filled += 1;
    }
  }
  return { filled, total };
};

const PartyCard = ({ party, roleLabel, removable, onRemove, onChange }) => {
  const updatePersonal = (key, value) => onChange({ ...party, personal: { ...party.personal, [key]: value } });
  const updateEmployment = (key, value) => onChange({ ...party, employment: { ...party.employment, [key]: value } });

  // On a valid 6-digit PIN, fetch City/District/State and merge them into
  // that same address block once the lookup resolves — via a functional
  // update (see updateParty above) so a slow response can't stomp on
  // edits made to other fields in the meantime. Overwrites City/District/
  // State with the lookup result (that's the point of auto-fill); the
  // user can still edit any of the three afterward if the PIN maps to the
  // wrong locality.
  const autofillFromPincode = (blockKey, pincode) => {
    if (!/^\d{6}$/.test(pincode)) return;
    lookupPincode(pincode).then((result) => {
      if (!result) return;
      onChange((prevParty) => ({
        ...prevParty,
        address: {
          ...prevParty.address,
          [blockKey]: {
            ...(prevParty.address[blockKey] || emptyAddressBlock()),
            pincode,
            ...(result.city ? { city: result.city } : {}),
            ...(result.district ? { district: result.district } : {}),
            ...(result.state ? { state: result.state } : {}),
          },
        },
      }));
    });
  };

  const updatePresent = (key, value) => {
    onChange({ ...party, address: { ...party.address, present: { ...party.address.present, [key]: value } } });
    if (key === "pincode") autofillFromPincode("present", value);
  };
  const updatePermanent = (key, value) => {
    onChange({ ...party, address: { ...party.address, permanent: { ...(party.address.permanent || emptyAddressBlock()), [key]: value } } });
    if (key === "pincode") autofillFromPincode("permanent", value);
  };
  const updateOffice = (key, value) => {
    onChange({ ...party, address: { ...party.address, office: { ...(party.address.office || emptyAddressBlock()), [key]: value } } });
    if (key === "pincode") autofillFromPincode("office", value);
  };
  const togglePermanentSame = (same) => onChange({ ...party, address: { ...party.address, permanent_same_as_present: same, permanent: same ? null : emptyAddressBlock() } });
  const toggleOffice = (has) => onChange({ ...party, address: { ...party.address, office: has ? emptyAddressBlock() : null } });
  const setRows = (key, rows) => onChange({ ...party, [key]: rows });

  const RoleIcon = ROLE_ICONS[party.role];
  const roleColor = ROLE_COLORS[party.role];
  const { filled, total } = countPartyProgress(party);

  return (
    <details open className="rounded-lg border mb-4 overflow-hidden shadow-sm" style={{ borderColor: theme.border, borderLeft: `4px solid ${roleColor}`, background: "#fff" }}>
      <summary className="cursor-pointer list-none px-4 py-3 flex items-center justify-between gap-2" style={{ background: "#F3F8FB" }}>
        <span className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide" style={{ color: roleColor }}>
          <RoleIcon size={16} strokeWidth={2.25} />
          {roleLabel}
        </span>
        <span className="flex items-center gap-3">
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap" style={{ background: "#fff", color: theme.slate, border: `1px solid ${theme.border}` }}>
            {filled}/{total} filled
          </span>
          {removable && (
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemove(); }}
              className="text-xs font-semibold text-red-600"
            >
              Remove
            </button>
          )}
        </span>
      </summary>
      <div className="p-4 space-y-4">
        <div>
          <SectionHeading title="Personal / KYC" />
          <FieldGrid fields={PARTY_PERSONAL_FIELDS} values={party.personal} onChange={updatePersonal} />
        </div>

        <div className="pt-3 border-t" style={{ borderColor: theme.border }}>
          <SectionHeading title="Address" />
          <p className="text-[11px] font-semibold uppercase mb-1.5" style={{ color: theme.slate }}>Present Address</p>
          <FieldGrid fields={PARTY_PRESENT_ADDRESS_FIELDS} values={party.address.present} onChange={updatePresent} />

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
          <SectionHeading title="Employment / Business" />
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

// Inline validation/error banner — matches PartnerUserCreateOrder.jsx's own
// error styling (theme.danger/dangerSoft) rather than a native alert()
// popup. `message` is a single string, or an array to render as a bulleted
// "here's everything still missing" list.
const ErrorBanner = ({ message }) => {
  if (!message) return null;
  return (
    <div className="rounded p-3 text-sm" style={{ background: theme.dangerSoft, border: `1px solid ${theme.danger}33`, color: theme.danger }}>
      {Array.isArray(message) ? (
        <>
          <p className="font-semibold mb-1">Please fill in the following required fields:</p>
          <ul className="list-disc list-inside space-y-0.5">
            {message.map((m) => <li key={m}>{m}</li>)}
          </ul>
        </>
      ) : (
        <p>{message}</p>
      )}
    </div>
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

  // Jump-nav targets for the mini progress strip at the top of step 1 — a
  // long form (Agriculture with 3 parties can be 100+ fields) benefits from
  // letting the user skip straight to a section instead of scrolling.
  const applicantsSectionRef = useRef(null);
  const loanDetailsSectionRef = useRef(null);
  const documentsSectionRef = useRef(null);
  const scrollToSection = (ref) => ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  const [useEkyc, setUseEkyc] = useState(false);
  const [generating, setGenerating] = useState(false);
  // Validation/error messages surface as an inline banner (see ErrorBanner
  // below), matching PartnerUserCreateOrder.jsx's own error-display
  // convention — never a native alert()/confirm() popup. A string for a
  // single message, or an array for "here's everything still missing".
  const [formError, setFormError] = useState(null);
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
  // `updated` may be a plain party object (every synchronous edit) or an
  // updater function `(prevParty) => nextParty` (the pincode auto-fill
  // below, whose API response can resolve after other edits have already
  // happened — a function reads the LATEST party at merge time instead of
  // clobbering it with whatever was captured in a stale closure).
  const updateParty = (index, updated) => setParties((prev) => prev.map((p, i) => {
    if (i !== index) return p;
    return typeof updated === "function" ? updated(p) : updated;
  }));

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
  // Guards against a double-click on Send for eSign/Save Document creating
  // two orders — set right before awaiting onSubmitOrder, reset in a
  // finally so it re-enables on failure too (see handleFinalize).
  const [finalizing, setFinalizing] = useState(false);

  // Documents Checklist — hardcoded per loan type on the backend (see
  // app/loan_i18n.py's DOCUMENT_CHECKLISTS, served by
  // GET /loans/documents?document_name=...), the same way every other part
  // of this flow's field set is. Keyed by document.doc_name rather than any
  // DB id, so it's always available even when the catalog document has no
  // config_id (e.g. picked via the "Document Service" fallback).
  const [checklistItems, setChecklistItems] = useState([]);
  const [checklistLoading, setChecklistLoading] = useState(false);
  const [confirmedDocKeys, setConfirmedDocKeys] = useState(new Set());
  // Actual attached files per checklist item (key -> File), uploaded via
  // POST /orders/{id}/loan-documents as a follow-up call once the order
  // exists — see handleFinalize/PartnerUserCreateOrder.jsx's
  // onSubmitOrder, same two-call pattern eSign already uses. Purely
  // optional: a checklist item can be confirmed without a file (e.g. "I
  // have the physical copy") or a file can be attached without checking
  // the confirm box — attaching one auto-checks it.
  const [checklistFiles, setChecklistFiles] = useState({});
  const setChecklistFile = (key, file) => {
    if (!file) return;
    setChecklistFiles((prev) => ({ ...prev, [key]: file }));
    setConfirmedDocKeys((prev) => new Set(prev).add(key));
  };
  const removeChecklistFile = (key) => setChecklistFiles((prev) => {
    const next = { ...prev };
    delete next[key];
    return next;
  });

  useEffect(() => {
    const docName = document?.doc_name;
    if (!docName) return;
    setChecklistLoading(true);
    apiRequest(`/api/partner-user/loans/documents?document_name=${encodeURIComponent(docName)}`)
      .then((items) => setChecklistItems(Array.isArray(items) ? items : []))
      .catch(() => setChecklistItems([]))
      .finally(() => setChecklistLoading(false));
  }, [document?.doc_name]);

  // Grouped per PARTY, not per role — a checklist item whose applicant_type
  // includes "guarantor" needs its own upload slot for EACH guarantor if
  // there's more than one (same for Co-Applicants, and even the common
  // items like PAN Card: the Applicant's PAN and a Co-Applicant's PAN are
  // two different files). Keyed by `${label}:${item.key}` (label already
  // disambiguates "Co-Applicant 1" from "Co-Applicant 2") rather than
  // party array index, so removing an earlier, different-role party
  // doesn't orphan a later party's already-uploaded files.
  const partyChecklistGroups = partyRows
    .map(({ party, label }) => ({
      label,
      items: checklistItems.filter((item) => !item.applicant_type?.length || item.applicant_type.includes(party.role)),
    }))
    .filter((g) => g.items.length > 0);
  const checklistItemKey = (partyLabel, itemKey) => `${partyLabel}:${itemKey}`;
  const toggleDocConfirmed = (key) => setConfirmedDocKeys((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  // Real eKYC identity verification (Aadhaar via DigiLocker, or PAN via
  // SignDesk's General Document Verification) — runs as its own "eKYC"
  // order (billed separately each time, same as the standalone eKYC
  // Verification page) before the loan draft can be generated. Can target
  // ANY party (ekycTargetIndex), not just the Applicant — a Co-Applicant
  // or Guarantor needs their own identity verified just as much, and this
  // reuses the exact same flow/pricing per party rather than duplicating
  // it once per PartyCard. See ekyc_service.py / digilocker_service.py.
  const [ekycTargetIndex, setEkycTargetIndex] = useState(0);
  const [ekycMobile, setEkycMobile] = useState("");
  const [ekycDocType, setEkycDocType] = useState("");
  const [ekycFile, setEkycFile] = useState(null);
  const [ekycOrderId, setEkycOrderId] = useState(null);
  // idle | verifying | digilocker_pending | fetching | done | failed
  const [ekycStage, setEkycStage] = useState("idle");
  const [ekycError, setEkycError] = useState("");
  const [ekycFields, setEkycFields] = useState([]);

  // Switching which party this verification is for starts a fresh attempt
  // — each party's verification is independent (separate order, separate
  // charge), so carrying over a previous party's in-progress/failed state
  // would be misleading.
  const changeEkycTarget = (index) => {
    setEkycTargetIndex(index);
    setEkycMobile("");
    setEkycDocType("");
    setEkycFile(null);
    setEkycOrderId(null);
    setEkycStage("idle");
    setEkycError("");
    setEkycFields([]);
  };

  // removeParty shifts every later party's array index down by one —
  // if that happens mid-eKYC-flow, ekycTargetIndex could now silently
  // point at a different party than the one the user was actually
  // verifying. Any removal resets to the Applicant (always index 0,
  // never removable) rather than risk writing a verification result onto
  // the wrong person.
  const partyCountRef = useRef(parties.length);
  useEffect(() => {
    if (parties.length < partyCountRef.current) {
      setEkycTargetIndex(0);
      setEkycMobile("");
      setEkycDocType("");
      setEkycFile(null);
      setEkycOrderId(null);
      setEkycStage("idle");
      setEkycError("");
      setEkycFields([]);
    }
    partyCountRef.current = parties.length;
  }, [parties.length]);

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
    // DigiLocker's Aadhaar data (and occasionally PAN extraction) gives
    // address components separately rather than one flat string — pull
    // each into its matching Present Address field instead of dumping
    // everything into "street" (that predates State/District becoming
    // real dropdowns). State/District are matched against the same
    // option lists the dropdowns themselves use (see matchFromList /
    // lookupPincode) so they land on an actual selectable value, never an
    // unselectable raw string the <select> can't display. Falls back to
    // the old flat-string-into-street behavior only when no individual
    // component was present at all (composeEkycAddress's "address"/
    // "full_address" case).
    const houseNo = extractEkycValue(extracted, ["house"]);
    const street = extractEkycValue(extracted, ["street"]);
    const city = extractEkycValue(extracted, ["vtc"]);
    const rawDistrict = extractEkycValue(extracted, ["district"]);
    const rawState = extractEkycValue(extracted, ["state"]);
    const pincode = extractEkycValue(extracted, ["pincode", "pin_code"]);
    const matchedState = matchFromList(INDIAN_STATES, rawState);
    const matchedDistrict = matchedState ? matchFromList(STATE_DISTRICTS[matchedState] || [], rawDistrict) : "";
    const hasComponents = houseNo || street || city || rawDistrict || rawState || pincode;
    const fallbackAddress = hasComponents ? "" : composeEkycAddress(extracted);

    setParties((prev) => prev.map((p, i) => {
      if (i !== ekycTargetIndex) return p;
      return {
        ...p,
        personal: {
          ...p.personal,
          ...(name ? { full_name: name } : {}),
          ...(dob ? { date_of_birth: dob } : {}),
          ...(aadhaar ? { aadhaar_number: aadhaar } : {}),
          ...(pan ? { pan_number: pan } : {}),
        },
        address: {
          ...p.address,
          present: {
            ...p.address.present,
            ...(houseNo ? { house_no: houseNo } : {}),
            ...(street ? { street } : {}),
            ...(city ? { city } : {}),
            ...(matchedDistrict ? { district: matchedDistrict } : {}),
            ...(matchedState ? { state: matchedState } : {}),
            ...(pincode ? { pincode } : {}),
            ...(fallbackAddress ? { street: fallbackAddress } : {}),
          },
        },
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
      // number is entered on the target party's Present Address below.
      fd.append("customer_name", parties[ekycTargetIndex]?.personal?.full_name?.trim() || "Verified Customer");
      fd.append("customer_mobile", ekycMobile.trim() || "0000000000");
      fd.append("action", "submit");
      fd.append("document", ekycFile);
      fd.append("doc_type", ekycDocType);
      fd.append("verification", "true");

      const order = await apiUpload("/api/partner-user/orders", fd);
      setEkycOrderId(order.id);
      // Reuse the verified contact number as the target party's own
      // present-address mobile (used later for the eSign signature invite)
      // rather than asking for it a second time — only when one was
      // actually entered here.
      if (ekycMobile.trim()) {
        setParties((prev) => prev.map((p, i) => (i === ekycTargetIndex
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

  // Every field marked `required: true` above (Name/DOB/PAN/Aadhaar, core
  // Present Address lines, Occupation Type, per party; the loan-type
  // section's own required fields e.g. Vehicle Type/Manufacturer; plus
  // Loan Amount/Tenure) must be filled before a draft can be generated,
  // mirroring real bank forms treating these as compulsory. Also
  // format-checks PAN/Aadhaar/Pincode wherever they're actually filled in
  // (required or not — a malformed value is never useful). Returns
  // human-readable "<Role>: <Field>" descriptions of everything still
  // wrong.
  const getMissingRequiredFields = () => {
    const missing = [];
    if (!formData.loanAmount) missing.push("Loan Amount");
    if (!formData.tenure) missing.push("Tenure (Months)");
    for (const { party, label } of partyRows) {
      for (const f of PARTY_PERSONAL_FIELDS) {
        if (f.required && !party.personal[f.key]) missing.push(`${label}: ${f.label}`);
      }
      for (const f of PARTY_PRESENT_ADDRESS_FIELDS) {
        if (f.required && !party.address.present[f.key]) missing.push(`${label}: Present Address – ${f.label}`);
      }
      for (const f of PARTY_EMPLOYMENT_FIELDS) {
        if (f.required && !party.employment[f.key]) missing.push(`${label}: ${f.label}`);
      }
      const pan = party.personal.pan_number;
      if (pan && !/^[A-Za-z]{5}[0-9]{4}[A-Za-z]$/.test(pan)) {
        missing.push(`${label}: PAN Number (must be in the format AAAAA9999A)`);
      }
      const aadhaar = party.personal.aadhaar_number;
      if (aadhaar && !/^\d{12}$/.test(aadhaar)) {
        missing.push(`${label}: Aadhaar Number (must be exactly 12 digits)`);
      }
      const pincode = party.address.present.pincode;
      if (pincode && !/^\d{6}$/.test(pincode)) {
        missing.push(`${label}: Present Address – Pincode (must be exactly 6 digits)`);
      }
    }
    for (const s of loanType.sections) {
      for (const k of s.fields) {
        if (FIELD_TYPES[k].required && !typeFields[k]) missing.push(`${s.title}: ${FIELD_TYPES[k].label}`);
      }
    }
    return missing;
  };

  const handleGenerateDraft = async () => {
    const missingFields = getMissingRequiredFields();
    if (missingFields.length > 0) {
      setFormError(missingFields);
      return;
    }
    setFormError(null);
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
      setFormError("Error generating draft: " + err.message);
    } finally {
      setGenerating(false);
    }
  };

  const handleFinalize = async () => {
    const applicant = generatedParties.find((p) => p.role === "applicant") || parties.find((p) => p.role === "applicant");
    const customerName = applicant?.personal?.full_name || "Customer";
    const customerMobile = applicant?.address?.present?.mobile || "";
    const customerEmail = applicant?.address?.present?.email || "";

    // customer_email is required by order creation itself for every service
    // except eKYC/eSign (see partner.py's _create_order) — this order is
    // always created as "Document Service", so it's never exempt.
    if (!isValidEmail(customerEmail)) {
      setFormError("A valid email address is required for the Applicant (Present Address > Email) to save this order.");
      return;
    }
    if (requireEsign && !isValidMobile(customerMobile)) {
      setFormError("A valid 10-digit mobile number is required for the Applicant (Present Address > Mobile) to send this for eSign.");
      return;
    }
    // Every mandatory checklist item must be confirmed (checkbox) or have a
    // file attached before the order can be finalized — the red "*" next
    // to a mandatory item was previously decorative only.
    const missingMandatoryDocs = partyChecklistGroups.flatMap(({ label, items }) =>
      items
        .filter((item) => item.is_mandatory && !confirmedDocKeys.has(checklistItemKey(label, item.key)))
        .map((item) => `${label}: ${item.document_name}`)
    );
    if (missingMandatoryDocs.length > 0) {
      setFormError(["The following mandatory documents must be confirmed or uploaded:", ...missingMandatoryDocs]);
      return;
    }
    setFormError(null);
    const file = new File([generatedPdfBytes], `${document.doc_name.replace(/\s+/g, '_')}.pdf`, { type: "application/pdf" });

    // One eSign signer per party that entered a valid mobile number —
    // Co-Applicants/Guarantors without one simply don't get an invite
    // (see the non-blocking warning shown near the eSign toggle in step 2).
    // SignDesk's `position` only has 4 valid corner values and must be
    // unique per signer in the same request — with up to 6 possible
    // parties (1 Applicant + 3 Co-Applicants + 2 Guarantors), the 5th/6th
    // signer gets no position at all (it's optional) rather than a
    // colliding duplicate.
    const signingParties = generatedParties.filter((p) => isValidMobile(p.address?.present?.mobile));
    const signers = signingParties.map((p, i) => ({
      name: p.personal.full_name || ROLE_LABELS[p.role],
      mobile: p.address.present.mobile,
      email: p.address.present.email || null,
      position: SIGNER_POSITIONS[i] || undefined,
    }));

    const documentsChecklist = partyChecklistGroups.flatMap(({ label, items }) =>
      items.map((item) => {
        const compositeKey = checklistItemKey(label, item.key);
        return {
          party: label,
          document_name: item.document_name,
          mandatory: !!item.is_mandatory,
          confirmed: confirmedDocKeys.has(compositeKey),
          uploaded: !!checklistFiles[compositeKey],
        };
      })
    );
    // Uploaded after the order exists (needs order.id) — see
    // PartnerUserCreateOrder.jsx's onSubmitOrder, POST
    // /orders/{id}/loan-documents, same two-call pattern eSign uses. The
    // backend stores document_key verbatim (no schema change needed for
    // per-party keys), so the "<Party Label>:<item key>" composite string
    // doubles as a human-readable record of which party each file is for.
    const checklistFileEntries = Object.entries(checklistFiles).filter(([, f]) => f);

    setFinalizing(true);
    try {
      // onSubmitOrder (PartnerUserCreateOrder.jsx) is async and never
      // rejects (it catches its own errors into its own error state) — we
      // just need to know when it's done so the button can re-enable
      // itself, whether that's from success (this component may unmount
      // once the parent shows its result screen) or failure (component
      // stays, button must be clickable again).
      await onSubmitOrder({
        file,
        requireEsign,
        customer_name: customerName,
        customer_mobile: customerMobile,
        customer_email: customerEmail,
        signers,
        checklistFileEntries,
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
    } finally {
      setFinalizing(false);
    }
  };

  // Non-blocking — shown near the eSign toggle so a partner user notices
  // before finalizing, rather than silently finding out later that a
  // Co-Applicant/Guarantor never got an eSign invite.
  const partiesWithoutValidMobile = requireEsign
    ? partyRows.filter(({ party }) => party.role !== "applicant" && party.personal.full_name && !isValidMobile(party.address.present.mobile))
    : [];

  if (step === 1) {
    return (
      <div className="space-y-4">
        <h2 className="text-sm font-bold uppercase tracking-wide mb-3" style={{ color: theme.navy, fontFamily: serif }}>
          {document.doc_name} Application
        </h2>

        <div className="sticky top-0 z-10 flex gap-1.5 flex-wrap -mx-1 px-1 py-2" style={{ background: theme.card }}>
          {[
            { label: "Applicants", ref: applicantsSectionRef },
            { label: "Loan Details", ref: loanDetailsSectionRef },
            { label: "Documents", ref: documentsSectionRef },
          ].map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={() => scrollToSection(s.ref)}
              className="px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors hover:opacity-80"
              style={{ borderColor: theme.border, color: theme.navy, background: theme.bg }}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: theme.slate }}>Language</label>
          <select value={language} onChange={e => setLanguage(e.target.value)} className={inputClass} style={baseInputStyle}>
            {document.available_languages?.map(lang => (
              <option key={lang} value={lang}>{lang}</option>
            )) || <option value="English">English</option>}
          </select>
        </div>

        <div className="pt-4 border-t" style={{ borderColor: theme.border }}>
          <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: theme.slate }}>Identity Verification</label>
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

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: theme.slate }}>Verifying identity for</label>
              <select
                value={ekycTargetIndex}
                onChange={(e) => changeEkycTarget(Number(e.target.value))}
                disabled={ekycStage === "verifying" || ekycStage === "fetching"}
                className={inputClass}
                style={baseInputStyle}
              >
                {partyRows.map(({ idx, label }) => <option key={idx} value={idx}>{label}</option>)}
              </select>
              <p className="text-xs mt-1.5" style={{ color: theme.slate }}>
                Each party's identity is verified (and billed) separately — switch here to run eKYC for a different Co-Applicant or Guarantor.
              </p>
            </div>

            {ekycStage === "done" ? (
              <div className="p-3 rounded text-sm bg-green-50 text-green-700 border border-green-200">
                {partyRows[ekycTargetIndex]?.label || "Applicant"} identity verified{ekycFields.length > 0 ? " — " + ekycFields.map(f => `${f.label}: ${f.value}`).join(", ") : ""}.
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: theme.slate }}>{partyRows[ekycTargetIndex]?.label || "Applicant"} Mobile</label>
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

        <div ref={applicantsSectionRef} className="pt-4 border-t scroll-mt-16" style={{ borderColor: theme.border }}>
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
            {useEkyc ? `${partyRows[ekycTargetIndex]?.label || "Applicant"}'s name/DOB/PAN/Aadhaar are filled from eKYC — edit if needed, or switch "Verifying identity for" above to run it for a different party.` : "Fill in the Applicant, then add Co-Applicants or Guarantors as needed."} Parties without a valid mobile number won't receive an eSign invite.
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

        <div ref={loanDetailsSectionRef} className="scroll-mt-16">
          <h3 className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: theme.navy }}>Loan Details</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: theme.slate }}>Loan Amount<span style={{ color: "#dc2626" }}> *</span></label>
              <input type="number" value={formData.loanAmount} onChange={e => setField("loanAmount", e.target.value)} className={inputClass} style={baseInputStyle} />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: theme.slate }}>Tenure (Months)<span style={{ color: "#dc2626" }}> *</span></label>
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

        <div ref={documentsSectionRef} className="pt-4 border-t scroll-mt-16" style={{ borderColor: theme.border }}>
          <h3 className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: theme.navy }}>Documents Checklist</h3>
          {checklistLoading ? (
            <p className="text-xs" style={{ color: theme.slate }}>Loading checklist...</p>
          ) : partyChecklistGroups.length === 0 ? (
            <p className="text-xs" style={{ color: theme.slate }}>No documents required.</p>
          ) : (
            <div className="space-y-4">
              {partyChecklistGroups.map(({ label, items }) => (
                <div key={label}>
                  <p className="text-[11px] font-semibold uppercase mb-1.5" style={{ color: theme.slate }}>{label}</p>
                  <div className="space-y-2">
                    {items.map((item) => {
                      const compositeKey = checklistItemKey(label, item.key);
                      const file = checklistFiles[compositeKey];
                      return (
                        <div key={compositeKey} className="flex items-start justify-between gap-3 rounded border p-2.5" style={{ borderColor: theme.border }}>
                          <label className="flex items-start gap-2 text-sm flex-1 min-w-0">
                            <input type="checkbox" checked={confirmedDocKeys.has(compositeKey)} onChange={() => toggleDocConfirmed(compositeKey)} className="mt-0.5 shrink-0" />
                            <span className="min-w-0">
                              {item.document_name}
                              {item.is_mandatory && <span className="text-red-600"> *</span>}
                              {item.description && <span className="block text-xs" style={{ color: theme.slate }}>{item.description}</span>}
                              {file && (
                                <span className="flex items-center gap-1 text-xs mt-1" style={{ color: theme.success }}>
                                  <FileCheck2 size={13} /> <span className="truncate max-w-[200px]">{file.name}</span>
                                </span>
                              )}
                            </span>
                          </label>
                          <div className="shrink-0">
                            {file ? (
                              <button
                                type="button"
                                onClick={() => removeChecklistFile(compositeKey)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border text-xs font-semibold text-red-600"
                                style={{ borderColor: theme.border }}
                              >
                                <X size={13} /> Remove
                              </button>
                            ) : (
                              <label
                                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border text-xs font-semibold cursor-pointer whitespace-nowrap"
                                style={{ borderColor: theme.border, color: theme.navy }}
                              >
                                <Upload size={13} /> Upload
                                <input
                                  type="file"
                                  accept="image/jpeg,image/png,application/pdf"
                                  className="hidden"
                                  onChange={(e) => { setChecklistFile(compositeKey, e.target.files?.[0]); e.target.value = ""; }}
                                />
                              </label>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {useEkyc && ekycStage === "verifying" && (
          <p className="text-xs" style={{ color: theme.slate }}>Verifying — this only blocks submission while actively in progress; eKYC is optional and per-party, not a hard prerequisite for every party.</p>
        )}

        <ErrorBanner message={formError} />

        <div className="sticky bottom-0 flex gap-2 mt-4 pt-4 pb-1 border-t" style={{ borderColor: theme.border, background: theme.card, boxShadow: "0 -4px 12px rgba(15,23,42,0.06)" }}>
          <button onClick={onCancel} className="px-5 py-2.5 rounded text-sm font-semibold border" style={{ background: "#fff", borderColor: theme.border }}>Cancel</button>
          <button disabled={generating || ekycStage === "verifying"} onClick={handleGenerateDraft} className="px-5 py-2.5 rounded text-sm font-semibold text-white disabled:opacity-60" style={{ background: theme.navy }}>
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
          <>
            <iframe title="Generated loan document" src={pdfPreviewUrl} className="w-full rounded border" style={{ height: '480px', borderColor: theme.border }} />
            <a
              href={pdfPreviewUrl}
              download={`${document.doc_name.replace(/\s+/g, '_')}_draft.pdf`}
              className="inline-flex items-center gap-1.5 text-xs font-semibold"
              style={{ color: theme.navy }}
            >
              <Download size={13} /> Download PDF
            </a>
          </>
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
          {partiesWithoutValidMobile.length > 0 && (
            <p className="text-xs mt-1.5 px-2.5 py-1.5 rounded" style={{ color: "#A16207", background: "#FBF3E1" }}>
              Won't get an eSign invite (no valid mobile number entered): {partiesWithoutValidMobile.map((p) => p.label).join(", ")}.
            </p>
          )}
        </div>

        <ErrorBanner message={formError} />

        <div className="sticky bottom-0 flex gap-2 mt-4 pt-4 pb-1 border-t" style={{ borderColor: theme.border, background: theme.card, boxShadow: "0 -4px 12px rgba(15,23,42,0.06)" }}>
          <button disabled={finalizing} onClick={() => { setFormError(null); setStep(1); }} className="px-5 py-2.5 rounded text-sm font-semibold border disabled:opacity-60" style={{ background: "#fff", borderColor: theme.border }}>Back</button>
          <button disabled={finalizing} onClick={handleFinalize} className="px-5 py-2.5 rounded text-sm font-semibold text-white disabled:opacity-60" style={{ background: theme.navy }}>
            {finalizing ? "Submitting..." : requireEsign ? "Send for eSign" : "Save Document"}
          </button>
        </div>
      </div>
    );
  }
}
