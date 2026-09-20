"""Static translations + font wiring for the Loan Document flow's generated
PDF (see partner_user.generate_loan_draft). ReportLab's built-in fonts
(Helvetica/Times) only cover Latin script, so Hindi/Marathi (Devanagari) and
Kannada need real embedded Unicode fonts — Noto Sans Devanagari / Noto Sans
Kannada, both SIL Open Font License, vendored under app/assets/fonts/.

Document structure (see generate_loan_draft): Title -> Loan Details ->
one Form-A/Form-B style block per party (Applicant, then Co-Applicant(s),
then Guarantor(s) — Personal/KYC, Address, Employment, and the four
repeatable-row tables) -> loan-type-specific section(s) -> Repayment &
Security -> 10 numbered Terms clauses -> one signature block per party.
LOAN_TYPE_CONFIG drives which req.dynamic_fields keys (the per-loan, not
per-party, fields — vehicle/property/farm details) render under which
heading for which loan type.
"""

from pathlib import Path

from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

FONTS_DIR = Path(__file__).resolve().parent / "assets" / "fonts"

_FONT_NAMES = {
    "English": ("Helvetica", "Helvetica-Bold"),
    "Hindi": ("NotoSansDevanagari", "NotoSansDevanagari-Bold"),
    "Marathi": ("NotoSansDevanagari", "NotoSansDevanagari-Bold"),
    "Kannada": ("NotoSansKannada", "NotoSansKannada-Bold"),
}

_registered = False


def _register_fonts_once() -> None:
    global _registered
    if _registered:
        return
    pdfmetrics.registerFont(TTFont("NotoSansDevanagari", str(FONTS_DIR / "NotoSansDevanagari-Regular.ttf")))
    pdfmetrics.registerFont(TTFont("NotoSansDevanagari-Bold", str(FONTS_DIR / "NotoSansDevanagari-Bold.ttf")))
    pdfmetrics.registerFont(TTFont("NotoSansKannada", str(FONTS_DIR / "NotoSansKannada-Regular.ttf")))
    pdfmetrics.registerFont(TTFont("NotoSansKannada-Bold", str(FONTS_DIR / "NotoSansKannada-Bold.ttf")))
    _registered = True


def get_loan_fonts(language: str) -> tuple[str, str]:
    _register_fonts_once()
    return _FONT_NAMES.get(language, _FONT_NAMES["English"])


# =========================================================================
# Loan-type layout config — which dynamic_fields keys render under which
# heading, for which loan type. Matched against document_name.lower() the
# same way LoanDocumentFlow.jsx picks which fields to show.
# =========================================================================

LOAN_TYPE_CONFIG = {
    "housing": {
        "match": "housing",
        "sections": [
            ("property_details", [
                "property_address", "property_type", "property_value", "purchase_price",
                "down_payment", "seller_builder_name", "seller_builder_contact",
                "survey_property_number", "registration_details", "construction_status",
                "existing_property_loan",
            ]),
        ],
        "repayment_security": ["mortgage_security_details", "insurance_details"],
    },
    "vehicle": {
        "match": None,  # car/bike matched separately, share this config
        "sections": [
            ("vehicle_details", [
                "vehicle_type", "new_or_used", "manufacturer", "brand_model", "variant",
                "manufacturing_year", "registration_number", "chassis_number", "engine_number",
                "ex_showroom_price", "on_road_price", "down_payment", "dealer_name",
                "dealer_address", "dealer_contact",
            ]),
        ],
        "repayment_security": ["hypothecation_details", "insurance_details"],
    },
    "personal": {
        "match": "personal",
        "sections": [
            ("financial_details", [
                "existing_emi_amount", "monthly_expenses", "other_income", "required_loan_amount",
            ]),
        ],
        "repayment_security": ["prepayment_terms", "security_collateral"],
    },
    "agriculture": {
        "match": "agriculture",
        "sections": [
            ("farm_details", [
                "farm_location", "village", "taluk", "district", "state", "land_ownership",
                "total_land_area", "cultivated_area", "survey_number", "land_registration_details",
                "lease_details",
            ]),
            ("crop_details", [
                "crop_type", "crop_season", "cultivation_area", "irrigation_type",
                "expected_yield", "estimated_crop_value", "expected_harvest_date",
            ]),
            ("financial_details", [
                "required_loan_amount", "sanctioned_loan_amount", "existing_agri_loans", "other_agri_income",
            ]),
        ],
        "repayment_security": ["collateral_details"],
    },
}


def get_loan_type_config(document_name: str) -> dict:
    name = (document_name or "").lower()
    if "car" in name or "bike" in name or "wheeler" in name:
        return LOAN_TYPE_CONFIG["vehicle"]
    for key, cfg in LOAN_TYPE_CONFIG.items():
        if cfg["match"] and cfg["match"] in name:
            return cfg
    return LOAN_TYPE_CONFIG["personal"]


APPLICATION_NO_PREFIX = {
    "housing": "HL", "vehicle": "VL", "personal": "PL", "agriculture": "AL",
}


def get_application_no_prefix(document_name: str) -> str:
    name = (document_name or "").lower()
    if "car" in name or "bike" in name or "wheeler" in name:
        return APPLICATION_NO_PREFIX["vehicle"]
    if "housing" in name:
        return APPLICATION_NO_PREFIX["housing"]
    if "agriculture" in name:
        return APPLICATION_NO_PREFIX["agriculture"]
    return APPLICATION_NO_PREFIX["personal"]


# =========================================================================
# Documents Checklist — hardcoded per loan type, the same way LOAN_TYPE_CONFIG
# above is. There's a separate admin-managed `loan_document_config` DB table
# with full CRUD (app/routes/loan_documents.py) that could drive this
# instead, but no admin screen anywhere in this app writes to it — it has
# always been unreachable from any UI — so depending on it would just show
# every partner user an empty checklist. This list is drawn from the actual
# "Documents Required" / KYC sections of real bank application forms (SBI
# Car/Auto/Home/Agriculture, IDFC Two-Wheeler, Kotak Personal Loan).
# `applicant_type: []` means the item applies to every party role.
# =========================================================================

_COMMON_DOCUMENTS = [
    {"key": "pan_card", "document_name": "PAN Card", "description": "", "is_mandatory": True, "applicant_type": []},
    {"key": "identity_proof", "document_name": "Identity Proof", "description": "Aadhaar Card, Voter ID, Passport, or Driving Licence", "is_mandatory": True, "applicant_type": []},
    {"key": "address_proof", "document_name": "Address Proof", "description": "Utility bill, passport, or bank statement not older than 3 months", "is_mandatory": False, "applicant_type": []},
    {"key": "photograph", "document_name": "Passport-size Photograph", "description": "", "is_mandatory": False, "applicant_type": []},
]

_GUARANTOR_DOCUMENTS = [
    {"key": "guarantor_pan", "document_name": "Guarantor's PAN Card", "description": "", "is_mandatory": False, "applicant_type": ["guarantor"]},
    {"key": "guarantor_address_proof", "document_name": "Guarantor's Address Proof", "description": "", "is_mandatory": False, "applicant_type": ["guarantor"]},
]

DOCUMENT_CHECKLISTS = {
    "housing": _COMMON_DOCUMENTS + [
        {"key": "income_proof", "document_name": "Income Proof / Salary Slips", "description": "Latest 3 months' salary slips, or last 2 years' ITR if self-employed", "is_mandatory": False, "applicant_type": ["applicant", "co_applicant"]},
        {"key": "bank_statements", "document_name": "Bank Statements", "description": "Last 6 months' bank statement", "is_mandatory": False, "applicant_type": ["applicant", "co_applicant"]},
        {"key": "property_documents", "document_name": "Property Documents", "description": "Sale agreement, title deed, and RERA registration (if applicable)", "is_mandatory": True, "applicant_type": ["applicant"]},
        {"key": "itr", "document_name": "Income Tax Returns (last 2 years)", "description": "Required if self-employed / business income", "is_mandatory": False, "applicant_type": ["applicant", "co_applicant"]},
        {"key": "noc_builder", "document_name": "NOC from Builder / Society", "description": "", "is_mandatory": False, "applicant_type": ["applicant"]},
    ] + _GUARANTOR_DOCUMENTS,
    "vehicle": _COMMON_DOCUMENTS + [
        {"key": "income_proof", "document_name": "Income Proof / Salary Slips", "description": "Latest 3 months' salary slips, or last 2 years' ITR if self-employed", "is_mandatory": False, "applicant_type": ["applicant", "co_applicant"]},
        {"key": "bank_statements", "document_name": "Bank Statements", "description": "Last 6 months' bank statement", "is_mandatory": False, "applicant_type": ["applicant", "co_applicant"]},
        {"key": "vehicle_quotation", "document_name": "Vehicle Quotation / Proforma Invoice", "description": "Dealer quotation for the vehicle being financed", "is_mandatory": True, "applicant_type": ["applicant"]},
        {"key": "driving_license", "document_name": "Driving Licence", "description": "", "is_mandatory": False, "applicant_type": ["applicant"]},
    ] + _GUARANTOR_DOCUMENTS,
    "personal": _COMMON_DOCUMENTS + [
        {"key": "income_proof", "document_name": "Income Proof / Salary Slips", "description": "Latest 3 months' salary slips, or last 2 years' ITR if self-employed", "is_mandatory": False, "applicant_type": ["applicant", "co_applicant"]},
        {"key": "bank_statements", "document_name": "Bank Statements", "description": "Last 6 months' bank statement", "is_mandatory": False, "applicant_type": ["applicant", "co_applicant"]},
        {"key": "employment_proof", "document_name": "Employment Proof / Offer Letter", "description": "", "is_mandatory": False, "applicant_type": ["applicant"]},
    ] + _GUARANTOR_DOCUMENTS,
    "agriculture": _COMMON_DOCUMENTS + [
        {"key": "land_documents", "document_name": "Land Ownership Documents", "description": "7/12 extract, Khata certificate, or equivalent land record", "is_mandatory": True, "applicant_type": ["applicant"]},
        {"key": "crop_certificate", "document_name": "Crop / Land Holding Certificate", "description": "Village Accountant / Tehsildar certificate", "is_mandatory": False, "applicant_type": ["applicant"]},
        {"key": "bank_statements", "document_name": "Bank Statements", "description": "Last 6 months' bank statement", "is_mandatory": False, "applicant_type": ["applicant"]},
    ] + _GUARANTOR_DOCUMENTS,
}


def get_default_document_checklist(document_name: str) -> list[dict]:
    name = (document_name or "").lower()
    if "car" in name or "bike" in name or "wheeler" in name:
        return DOCUMENT_CHECKLISTS["vehicle"]
    if "housing" in name:
        return DOCUMENT_CHECKLISTS["housing"]
    if "agriculture" in name:
        return DOCUMENT_CHECKLISTS["agriculture"]
    return DOCUMENT_CHECKLISTS["personal"]


# =========================================================================
# Field labels — every dynamic_fields key used anywhere across the 5 loan
# types, in every supported language. An unrecognized key still renders,
# just title-cased and untranslated (see generate_loan_draft).
# =========================================================================

FIELD_LABELS = {
    "English": {
        "date_of_birth": "Date of Birth", "pan_number": "PAN Number", "aadhaar_number": "Aadhaar Number",
        "address": "Residential Address", "occupation": "Occupation", "employer_name": "Employer Name",
        "monthly_income": "Monthly Income", "employment_type": "Employment Type", "designation": "Designation",
        "work_experience": "Work Experience",
        "property_address": "Property Address", "property_type": "Property Type", "property_value": "Property Value",
        "purchase_price": "Purchase Price", "down_payment": "Down Payment",
        "seller_builder_name": "Seller / Builder Name", "seller_builder_contact": "Seller / Builder Contact",
        "survey_property_number": "Survey / Property Number", "registration_details": "Registration Details",
        "construction_status": "Construction Status", "existing_property_loan": "Existing Property Loan",
        "mortgage_security_details": "Mortgage / Security Details", "insurance_details": "Insurance Details",
        "vehicle_type": "Vehicle Type", "new_or_used": "New / Used", "manufacturer": "Manufacturer",
        "brand_model": "Brand / Model", "variant": "Variant", "manufacturing_year": "Manufacturing Year",
        "registration_number": "Registration Number", "chassis_number": "Chassis Number",
        "engine_number": "Engine Number", "ex_showroom_price": "Ex-Showroom Price", "on_road_price": "On-Road Price",
        "dealer_name": "Dealer Name", "dealer_address": "Dealer Address", "dealer_contact": "Dealer Contact",
        "hypothecation_details": "Vehicle Hypothecation Details",
        "existing_loan_details": "Existing Loan Details", "existing_emi_amount": "Existing EMI Amount",
        "monthly_expenses": "Monthly Expenses", "other_income": "Other Income",
        "bank_account_details": "Bank Account Details", "required_loan_amount": "Required Loan Amount",
        "prepayment_terms": "Prepayment Terms", "guarantor_details": "Guarantor Details",
        "security_collateral": "Security / Collateral",
        "farm_location": "Farm Location", "village": "Village", "taluk": "Taluk", "district": "District",
        "state": "State", "land_ownership": "Land Ownership", "total_land_area": "Total Land Area / Acreage",
        "cultivated_area": "Cultivated Area", "survey_number": "Survey Number",
        "land_registration_details": "Land Registration Details", "lease_details": "Lease Details",
        "crop_type": "Crop Type", "crop_season": "Crop Season", "cultivation_area": "Cultivation Area",
        "irrigation_type": "Irrigation Type", "expected_yield": "Expected Yield",
        "estimated_crop_value": "Estimated Crop Value", "expected_harvest_date": "Expected Harvest Date",
        "sanctioned_loan_amount": "Sanctioned Loan Amount", "existing_agri_loans": "Existing Agricultural Loans",
        "other_agri_income": "Other Agricultural Income", "collateral_details": "Collateral Details",
        # Party-level fields (Applicant / Co-Applicant / Guarantor) — see
        # PartyInput in partner_user.py and the Form-A/B rendering in
        # generate_loan_draft.
        "full_name": "Full Name", "gender": "Gender", "marital_status": "Marital Status",
        "spouse_name": "Spouse Name", "father_name": "Father's Name", "mother_maiden_name": "Mother's Maiden Name",
        "category": "Category", "religion": "Religion", "nationality": "Nationality",
        "residential_status": "Residential Status", "no_of_dependents": "No. of Dependents",
        "voter_id": "Voter ID Number", "driving_license": "Driving Licence Number",
        "passport_number": "Passport Number", "passport_valid_upto": "Passport Valid Upto",
        "house_no": "House / Flat / Building No.", "street": "Street / Area / Locality", "landmark": "Landmark",
        "city": "City", "district": "District", "pincode": "Pincode", "country": "Country",
        "mobile": "Mobile Number", "email": "Email",
        "occupation_type": "Occupation Type", "employment_status": "Employment Status",
        "organization_type": "Organization Type", "department": "Department", "employee_no": "Employee Number",
        "total_experience": "Total Work Experience", "years_present_job": "Years in Present Job",
        "business_name": "Business Name", "business_type": "Business Type",
        "income_head": "Income Head", "gross_income": "Gross Income", "net_income": "Net Income",
        "frequency": "Frequency",
        "loan_bank": "Bank / Financier", "loan_type": "Loan Type", "loan_emi": "EMI", "loan_tenure": "Tenure",
        "loan_outstanding": "Outstanding Balance",
        "bank_name": "Bank Name", "bank_branch": "Branch", "account_type": "Account Type",
        "account_number": "Account Number",
        "asset_type": "Asset Type", "asset_description": "Description", "asset_value": "Value",
        "reference_name": "Name", "reference_address": "Address", "reference_phone": "Phone Number",
    },
    "Hindi": {
        "date_of_birth": "जन्म तारीख", "pan_number": "पैन नंबर", "aadhaar_number": "आधार नंबर",
        "address": "आवासीय पता", "occupation": "व्यवसाय", "employer_name": "नियोक्ता का नाम",
        "monthly_income": "मासिक आय", "employment_type": "रोजगार प्रकार", "designation": "पदनाम",
        "work_experience": "कार्य अनुभव",
        "property_address": "संपदा का पता", "property_type": "संपदा का प्रकार", "property_value": "संपदा का मूल्य",
        "purchase_price": "खरीद मूल्य", "down_payment": "डाउन पेमेंट",
        "seller_builder_name": "विक्रेता / बिल्डर का नाम", "seller_builder_contact": "विक्रेता / बिल्डर संपर्क",
        "survey_property_number": "सर्वे / संपदा संख्या", "registration_details": "पंजीकरण विवरण",
        "construction_status": "भवन दशा", "existing_property_loan": "मौजूदा संपदा ऋण",
        "mortgage_security_details": "बंधक / सुरक्षा विवरण", "insurance_details": "बीमा विवरण",
        "vehicle_type": "वाहन प्रकार", "new_or_used": "नया / पुराना", "manufacturer": "उत्पादक",
        "brand_model": "ब्रांड / मॉडल", "variant": "वैरिएंट", "manufacturing_year": "मॉडल वर्ष",
        "registration_number": "पंजीकरण संख्या", "chassis_number": "चेसिस नंबर",
        "engine_number": "इंजन नंबर", "ex_showroom_price": "एक्स-शोरूम मूल्य", "on_road_price": "ऑन-रोड मूल्य",
        "dealer_name": "डीलर का नाम", "dealer_address": "डीलर का पता", "dealer_contact": "डीलर संपर्क",
        "hypothecation_details": "वाहन बंधक विवरण",
        "existing_loan_details": "मौजूदा ऋण विवरण", "existing_emi_amount": "मौजूदा ईएमआई रकम",
        "monthly_expenses": "मासिक व्यय", "other_income": "अन्य आय",
        "bank_account_details": "बैंक खाता विवरण", "required_loan_amount": "आवश्यक ऋण रकम",
        "prepayment_terms": "पूर्व भुगतान शर्तें", "guarantor_details": "गारंटर विवरण",
        "security_collateral": "सुरक्षा / गिरवी",
        "farm_location": "खेत का स्थान", "village": "गांव", "taluk": "तालुक", "district": "जिला",
        "state": "राज्य", "land_ownership": "ज़मीन का स्वामित्व", "total_land_area": "कुल ज़मीन क्षेत्रफल / एकड़",
        "cultivated_area": "जुताई क्षेत्र", "survey_number": "सर्वे नंबर",
        "land_registration_details": "ज़मीन पंजीकरण विवरण", "lease_details": "पट्टा विवरण",
        "crop_type": "फसल का प्रकार", "crop_season": "फसल सीजन", "cultivation_area": "खेती का क्षेत्र",
        "irrigation_type": "सिंचाई प्रकार", "expected_yield": "अपेक्षित उपज",
        "estimated_crop_value": "अनुमानित फसल मूल्य", "expected_harvest_date": "अपेक्षित फसल कटाई तारीख",
        "sanctioned_loan_amount": "स्वीकृत ऋण रकम", "existing_agri_loans": "मौजूदा खेती ऋण",
        "other_agri_income": "अन्य खेती आय", "collateral_details": "गिरवी विवरण",
        "full_name": "पूरा नाम", "gender": "लिंग", "marital_status": "वैवाहिक स्थिति",
        "spouse_name": "जीवनसाथी का नाम", "father_name": "पिता का नाम", "mother_maiden_name": "माता का पहला नाम",
        "category": "श्रेणी", "religion": "धर्म", "nationality": "राष्ट्रीयता",
        "residential_status": "निवास स्थिति", "no_of_dependents": "आश्रितों की संख्या",
        "voter_id": "मतदाता पहचान संख्या", "driving_license": "ड्राइविंग लाइसेंस संख्या",
        "passport_number": "पासपोर्ट संख्या", "passport_valid_upto": "पासपोर्ट वैधता तिथि",
        "house_no": "मकान / फ्लैट / भवन संख्या", "street": "सड़क / क्षेत्र / इलाका", "landmark": "लैंडमार्क",
        "city": "शहर", "district": "जिला", "pincode": "पिन कोड", "country": "देश",
        "mobile": "मोबाइल नंबर", "email": "ईमेल",
        "occupation_type": "व्यवसाय प्रकार", "employment_status": "रोजगार स्थिति",
        "organization_type": "संगठन प्रकार", "department": "विभाग", "employee_no": "कर्मचारी संख्या",
        "total_experience": "कुल कार्य अनुभव", "years_present_job": "वर्तमान नौकरी में वर्ष",
        "business_name": "व्यवसाय का नाम", "business_type": "व्यवसाय प्रकार",
        "income_head": "आय शीर्षक", "gross_income": "सकल आय", "net_income": "शुद्ध आय",
        "frequency": "आवृत्ति",
        "loan_bank": "बैंक / वित्तदाता", "loan_type": "ऋण प्रकार", "loan_emi": "ईएमआई", "loan_tenure": "मीयाद",
        "loan_outstanding": "बकाया रकम",
        "bank_name": "बैंक का नाम", "bank_branch": "शाखा", "account_type": "खाता प्रकार",
        "account_number": "खाता संख्या",
        "asset_type": "संपत्ति प्रकार", "asset_description": "विवरण", "asset_value": "मूल्य",
        "reference_name": "नाम", "reference_address": "पता", "reference_phone": "फोन नंबर",
    },
    "Kannada": {
        "date_of_birth": "ಹುಟ್ಟಿದ ದಿನಾಂಕ", "pan_number": "ಪ್ಯಾನ್ ಸಂಖ್ಯೆ", "aadhaar_number": "ಆಧಾರ್ ಸಂಖ್ಯೆ",
        "address": "ವಾಸಸ್ಥಳ ವಿಳಾಸ", "occupation": "ಉದ್ಯೋಗ", "employer_name": "ಉದ್ಯೋಗದಾತರ ಹೆಸರು",
        "monthly_income": "ಮಾಸಿಕ ಆದಾಯ", "employment_type": "ಉದ್ಯೋಗ ಪ್ರಕಾರ", "designation": "ಹುದ್ದೆ",
        "work_experience": "ಕೆಲಸದ ಅನುಭವ",
        "property_address": "ಆಸ್ತಿ ವಿಳಾಸ", "property_type": "ಆಸ್ತಿ ಪ್ರಕಾರ", "property_value": "ಆಸ್ತಿ ಮೌಲ್ಯ",
        "purchase_price": "ಖರೀದಿ ಬೆಲೆ", "down_payment": "ಮುಂಗಡ ಪಾವತಿ",
        "seller_builder_name": "ಮಾರಾಟಗಾರ / ಬಿಲ್ಡರ್ ಹೆಸರು", "seller_builder_contact": "ಮಾರಾಟಗಾರ / ಬಿಲ್ಡರ್ ಸಂಪರ್ಕ",
        "survey_property_number": "ಸರ್ವೆ / ಆಸ್ತಿ ಸಂಖ್ಯೆ", "registration_details": "ನೋಂದಣಿ ವಿವರಗಳು",
        "construction_status": "ನಿರ್ಮಾಣ ಸ್ಥಿತಿ", "existing_property_loan": "ಅಸ್ತಿತ್ವದಲ್ಲಿರುವ ಆಸ್ತಿ ಸಾಲ",
        "mortgage_security_details": "ಅಡಮಾನ / ಭದ್ರತಾ ವಿವರಗಳು", "insurance_details": "ವಿಮಾ ವಿವರಗಳು",
        "vehicle_type": "ವಾಹನ ಪ್ರಕಾರ", "new_or_used": "ಹೊಸ / ಬಳಸಿದ", "manufacturer": "ತಯಾರಕ",
        "brand_model": "ಬ್ರಾಂಡ್ / ಮಾದರಿ", "variant": "ರೂಪಾಂತರ", "manufacturing_year": "ತಯಾರಿಕಾ ವರ್ಷ",
        "registration_number": "ನೋಂದಣಿ ಸಂಖ್ಯೆ", "chassis_number": "ಚಾಸಿಸ್ ಸಂಖ್ಯೆ",
        "engine_number": "ಎಂಜಿನ್ ಸಂಖ್ಯೆ", "ex_showroom_price": "ಎಕ್ಸ್-ಶೋರೂಮ್ ಬೆಲೆ", "on_road_price": "ಆನ್-ರೋಡ್ ಬೆಲೆ",
        "dealer_name": "ಡೀಲರ್ ಹೆಸರು", "dealer_address": "ಡೀಲರ್ ವಿಳಾಸ", "dealer_contact": "ಡೀಲರ್ ಸಂಪರ್ಕ",
        "hypothecation_details": "ವಾಹನ ಅಡಮಾನ ವಿವರಗಳು",
        "existing_loan_details": "ಅಸ್ತಿತ್ವದಲ್ಲಿರುವ ಸಾಲದ ವಿವರಗಳು", "existing_emi_amount": "ಅಸ್ತಿತ್ವದಲ್ಲಿರುವ ಇಎಂಐ ಮೊತ್ತ",
        "monthly_expenses": "ಮಾಸಿಕ ವೆಚ್ಚಗಳು", "other_income": "ಇತರ ಆದಾಯ",
        "bank_account_details": "ಬ್ಯಾಂಕ್ ಖಾತೆ ವಿವರಗಳು", "required_loan_amount": "ಅಗತ್ಯವಿರುವ ಸಾಲದ ಮೊತ್ತ",
        "prepayment_terms": "ಪೂರ್ವಪಾವತಿ ನಿಯಮಗಳು", "guarantor_details": "ಖಾತರಿದಾರರ ವಿವರಗಳು",
        "security_collateral": "ಭದ್ರತೆ / ಅಡಮಾನ",
        "farm_location": "ಜಮೀನಿನ ಸ್ಥಳ", "village": "ಗ್ರಾಮ", "taluk": "ತಾಲೂಕು", "district": "ಜಿಲ್ಲೆ",
        "state": "ರಾಜ್ಯ", "land_ownership": "ಭೂ ಮಾಲೀಕತ್ವ", "total_land_area": "ಒಟ್ಟು ಭೂ ವಿಸ್ತೀರ್ಣ / ಎಕರೆ",
        "cultivated_area": "ಬೇಸಾಯದ ಪ್ರದೇಶ", "survey_number": "ಸರ್ವೆ ಸಂಖ್ಯೆ",
        "land_registration_details": "ಭೂ ನೋಂದಣಿ ವಿವರಗಳು", "lease_details": "ಗುತ್ತಿಗೆ ವಿವರಗಳು",
        "crop_type": "ಬೆಳೆ ಪ್ರಕಾರ", "crop_season": "ಬೆಳೆ ಋತು", "cultivation_area": "ಕೃಷಿ ಪ್ರದೇಶ",
        "irrigation_type": "ನೀರಾವರಿ ಪ್ರಕಾರ", "expected_yield": "ನಿರೀಕ್ಷಿತ ಇಳುವರಿ",
        "estimated_crop_value": "ಅಂದಾಜು ಬೆಳೆ ಮೌಲ್ಯ", "expected_harvest_date": "ನಿರೀಕ್ಷಿತ ಸುಗ್ಗಿ ದಿನಾಂಕ",
        "sanctioned_loan_amount": "ಮಂಜೂರಾದ ಸಾಲದ ಮೊತ್ತ", "existing_agri_loans": "ಅಸ್ತಿತ್ವದಲ್ಲಿರುವ ಕೃಷಿ ಸಾಲಗಳು",
        "other_agri_income": "ಇತರ ಕೃಷಿ ಆದಾಯ", "collateral_details": "ಅಡಮಾನ ವಿವರಗಳು",
        "full_name": "ಪೂರ್ಣ ಹೆಸರು", "gender": "ಲಿಂಗ", "marital_status": "ವೈವಾಹಿಕ ಸ್ಥಿತಿ",
        "spouse_name": "ಸಂಗಾತಿಯ ಹೆಸರು", "father_name": "ತಂದೆಯ ಹೆಸರು",
        "mother_maiden_name": "ತಾಯಿಯ ಮದುವೆಗೂ ಮುನ್ನಿನ ಹೆಸರು",
        "category": "ವರ್ಗ", "religion": "ಧರ್ಮ", "nationality": "ರಾಷ್ಟ್ರೀಯತೆ",
        "residential_status": "ವಾಸಸ್ಥಳ ಸ್ಥಿತಿ", "no_of_dependents": "ಅವಲಂಬಿತರ ಸಂಖ್ಯೆ",
        "voter_id": "ಮತದಾರರ ಗುರುತಿನ ಸಂಖ್ಯೆ", "driving_license": "ಚಾಲನಾ ಪರವಾನಗಿ ಸಂಖ್ಯೆ",
        "passport_number": "ಪಾಸ್‌ಪೋರ್ಟ್ ಸಂಖ್ಯೆ", "passport_valid_upto": "ಪಾಸ್‌ಪೋರ್ಟ್ ಮಾನ್ಯತೆ ದಿನಾಂಕ",
        "house_no": "ಮನೆ / ಫ್ಲಾಟ್ / ಕಟ್ಟಡ ಸಂಖ್ಯೆ", "street": "ಬೀದಿ / ಪ್ರದೇಶ / ಸ್ಥಳ", "landmark": "ಗುರುತು ಸ್ಥಳ",
        "city": "ನಗರ", "district": "ಜಿಲ್ಲೆ", "pincode": "ಪಿನ್ ಕೋಡ್", "country": "ದೇಶ",
        "mobile": "ಮೊಬೈಲ್ ಸಂಖ್ಯೆ", "email": "ಇಮೇಲ್",
        "occupation_type": "ಉದ್ಯೋಗ ಪ್ರಕಾರ", "employment_status": "ಉದ್ಯೋಗ ಸ್ಥಿತಿ",
        "organization_type": "ಸಂಸ್ಥೆ ಪ್ರಕಾರ", "department": "ವಿಭಾಗ", "employee_no": "ಉದ್ಯೋಗಿ ಸಂಖ್ಯೆ",
        "total_experience": "ಒಟ್ಟು ಕೆಲಸದ ಅನುಭವ", "years_present_job": "ಪ್ರಸ್ತುತ ಉದ್ಯೋಗದಲ್ಲಿ ವರ್ಷಗಳು",
        "business_name": "ವ್ಯಾಪಾರದ ಹೆಸರು", "business_type": "ವ್ಯಾಪಾರ ಪ್ರಕಾರ",
        "income_head": "ಆದಾಯ ಶೀರ್ಷಿಕೆ", "gross_income": "ಒಟ್ಟು ಆದಾಯ", "net_income": "ನಿವ್ವಳ ಆದಾಯ",
        "frequency": "ಆವರ್ತನ",
        "loan_bank": "ಬ್ಯಾಂಕ್ / ಹಣಕಾಸು ಸಂಸ್ಥೆ", "loan_type": "ಸಾಲದ ಪ್ರಕಾರ", "loan_emi": "ಇಎಂಐ",
        "loan_tenure": "ಅವಧಿ", "loan_outstanding": "ಬಾಕಿ ಮೊತ್ತ",
        "bank_name": "ಬ್ಯಾಂಕ್ ಹೆಸರು", "bank_branch": "ಶಾಖೆ", "account_type": "ಖಾತೆ ಪ್ರಕಾರ",
        "account_number": "ಖಾತೆ ಸಂಖ್ಯೆ",
        "asset_type": "ಆಸ್ತಿ ಪ್ರಕಾರ", "asset_description": "ವಿವರಣೆ", "asset_value": "ಮೌಲ್ಯ",
        "reference_name": "ಹೆಸರು", "reference_address": "ವಿಳಾಸ", "reference_phone": "ಫೋನ್ ಸಂಖ್ಯೆ",
    },
    "Marathi": {
        "date_of_birth": "जन्मतारीख", "pan_number": "पॅन क्रमांक", "aadhaar_number": "आधार क्रमांक",
        "address": "निवासी पत्ता", "occupation": "व्यवसाय", "employer_name": "नियोक्त्याचे नाव",
        "monthly_income": "मासिक उत्पन्न", "employment_type": "रोजगार प्रकार", "designation": "पद",
        "work_experience": "कामाचा अनुभव",
        "property_address": "मालमत्तेचा पत्ता", "property_type": "मालमत्तेचा प्रकार", "property_value": "मालमत्तेचे मूल्य",
        "purchase_price": "खरेदी किंमत", "down_payment": "डाउन पेमेंट",
        "seller_builder_name": "विक्रेता / बिल्डरचे नाव", "seller_builder_contact": "विक्रेता / बिल्डर संपर्क",
        "survey_property_number": "सर्वे / मालमत्ता क्रमांक", "registration_details": "नोंदणी तपशील",
        "construction_status": "बांधकाम स्थिती", "existing_property_loan": "विद्यमान मालमत्ता कर्ज",
        "mortgage_security_details": "गहाण / सुरक्षा तपशील", "insurance_details": "विमा तपशील",
        "vehicle_type": "वाहन प्रकार", "new_or_used": "नवीन / वापरलेले", "manufacturer": "उत्पादक",
        "brand_model": "ब्रँड / मॉडेल", "variant": "प्रकार (वेरियंट)", "manufacturing_year": "मॉडेल वर्ष",
        "registration_number": "नोंदणी क्रमांक", "chassis_number": "चेसिस क्रमांक",
        "engine_number": "इंजिन क्रमांक", "ex_showroom_price": "एक्स-शोरूम किंमत", "on_road_price": "ऑन-रोड किंमत",
        "dealer_name": "डीलरचे नाव", "dealer_address": "डीलरचा पत्ता", "dealer_contact": "डीलर संपर्क",
        "hypothecation_details": "वाहन गहाण तपशील",
        "existing_loan_details": "विद्यमान कर्ज तपशील", "existing_emi_amount": "विद्यमान ईएमआय रक्कम",
        "monthly_expenses": "मासिक खर्च", "other_income": "इतर उत्पन्न",
        "bank_account_details": "बँक खाते तपशील", "required_loan_amount": "आवश्यक कर्ज रक्कम",
        "prepayment_terms": "पूर्वपरतफेड अटी", "guarantor_details": "जामीनदार तपशील",
        "security_collateral": "सुरक्षा / तारण",
        "farm_location": "शेताचे ठिकाण", "village": "गाव", "taluk": "तालुका", "district": "जिल्हा",
        "state": "राज्य", "land_ownership": "जमीन मालकी", "total_land_area": "एकूण जमीन क्षेत्र / एकर",
        "cultivated_area": "लागवडीचे क्षेत्र", "survey_number": "सर्वे क्रमांक",
        "land_registration_details": "जमीन नोंदणी तपशील", "lease_details": "भाडेपट्टी तपशील",
        "crop_type": "पिकाचा प्रकार", "crop_season": "हंगाम", "cultivation_area": "लागवड क्षेत्र",
        "irrigation_type": "सिंचन प्रकार", "expected_yield": "अपेक्षित उत्पादन",
        "estimated_crop_value": "अंदाजित पीक मूल्य", "expected_harvest_date": "अपेक्षित कापणी तारीख",
        "sanctioned_loan_amount": "मंजूर कर्ज रक्कम", "existing_agri_loans": "विद्यमान कृषी कर्जे",
        "other_agri_income": "इतर कृषी उत्पन्न", "collateral_details": "तारण तपशील",
        "full_name": "पूर्ण नाव", "gender": "लिंग", "marital_status": "वैवाहिक स्थिती",
        "spouse_name": "जोडीदाराचे नाव", "father_name": "वडिलांचे नाव",
        "mother_maiden_name": "आईचे माहेरचे नाव",
        "category": "प्रवर्ग", "religion": "धर्म", "nationality": "राष्ट्रीयत्व",
        "residential_status": "निवासी स्थिती", "no_of_dependents": "अवलंबितांची संख्या",
        "voter_id": "मतदार ओळख क्रमांक", "driving_license": "वाहन परवाना क्रमांक",
        "passport_number": "पासपोर्ट क्रमांक", "passport_valid_upto": "पासपोर्ट वैधता तारीख",
        "house_no": "घर / फ्लॅट / इमारत क्रमांक", "street": "रस्ता / परिसर / भाग", "landmark": "खूण",
        "city": "शहर", "district": "जिल्हा", "pincode": "पिन कोड", "country": "देश",
        "mobile": "मोबाइल क्रमांक", "email": "ईमेल",
        "occupation_type": "व्यवसाय प्रकार", "employment_status": "रोजगार स्थिती",
        "organization_type": "संस्था प्रकार", "department": "विभाग", "employee_no": "कर्मचारी क्रमांक",
        "total_experience": "एकूण कामाचा अनुभव", "years_present_job": "सध्याच्या नोकरीतील वर्षे",
        "business_name": "व्यवसायाचे नाव", "business_type": "व्यवसाय प्रकार",
        "income_head": "उत्पन्न शीर्षक", "gross_income": "एकूण उत्पन्न", "net_income": "निव्वळ उत्पन्न",
        "frequency": "वारंवारता",
        "loan_bank": "बँक / वित्तपुरवठादार", "loan_type": "कर्ज प्रकार", "loan_emi": "ईएमआय",
        "loan_tenure": "कालावधी", "loan_outstanding": "थकीत रक्कम",
        "bank_name": "बँकेचे नाव", "bank_branch": "शाखा", "account_type": "खाते प्रकार",
        "account_number": "खाते क्रमांक",
        "asset_type": "मालमत्ता प्रकार", "asset_description": "वर्णन", "asset_value": "मूल्य",
        "reference_name": "नाव", "reference_address": "पत्ता", "reference_phone": "फोन क्रमांक",
    },
}


def get_field_label(language: str, key: str) -> str | None:
    return FIELD_LABELS.get(language, FIELD_LABELS["English"]).get(key)


# =========================================================================
# Everything else — section headings, the Loan Details summary block, and
# the 10 numbered Terms clauses.
# =========================================================================

LOAN_I18N = {
    "English": {
        "title_suffix": "AGREEMENT",
        "section_headings": {
            "loan_details": "LOAN DETAILS", "borrower_details": "BORROWER DETAILS",
            "property_details": "PROPERTY DETAILS", "vehicle_details": "VEHICLE DETAILS",
            "financial_details": "FINANCIAL DETAILS", "farm_details": "FARM DETAILS",
            "crop_details": "CROP DETAILS", "repayment_security": "REPAYMENT & SECURITY",
            "personal_kyc": "PERSONAL / KYC DETAILS", "address": "ADDRESS DETAILS",
            "party_employment": "EMPLOYMENT / BUSINESS DETAILS", "income_sources": "INCOME DETAILS",
            "party_existing_loans": "EXISTING LOANS", "party_bank_accounts": "BANK ACCOUNTS",
            "party_assets": "ASSETS", "party_references": "REFERENCES",
        },
        "party_roles": {"applicant": "APPLICANT", "co_applicant": "CO-APPLICANT", "guarantor": "GUARANTOR"},
        "signature_captions": {
            "applicant": "Signature of Applicant", "co_applicant": "Signature of Co-Applicant",
            "guarantor": "Signature of Guarantor",
        },
        "present_address": "Present Address:", "permanent_address": "Permanent Address:",
        "office_address": "Office / Business Address:",
        "loan_details_fields": {
            "agreement_date": "Agreement Date:", "application_no": "Loan Application No.:",
            "account_no": "Loan Account No.:", "loan_amount": "Loan Amount:", "interest_rate": "Interest Rate:",
            "tenure": "Loan Tenure:", "repayment_frequency": "Repayment Frequency:", "emi_amount": "EMI Amount:",
            "loan_purpose": "Loan Purpose:",
        },
        "borrower_name": "Borrower Name:", "mobile_number": "Mobile Number:", "email": "Email:", "months": "Months",
        "first_emi_date": "First EMI Date:", "final_emi_date": "Final EMI Date:",
        "terms_headings": [
            "1. THE PARTIES", "2. LOAN DISBURSEMENT", "3. INTEREST RATE", "4. REPAYMENT TERMS",
            "5. LATE FEES AND DEFAULT", "6. PREPAYMENT / FORECLOSURE", "7. SECURITY / COLLATERAL",
            "8. BORROWER DECLARATION", "9. GOVERNING LAW", "10. SIGNATURES",
        ],
        "terms_bodies": {
            1: 'This Loan Agreement (the "Agreement") is entered into by and between <b>{name}</b> (the "Borrower") and LegalDesk Financial Services (the "Lender"). The Borrower agrees to repay the Loan Amount specified above in accordance with the terms and conditions outlined herein.',
            2: "The Loan Amount shall be disbursed by the Lender to the Borrower upon execution of this Agreement and completion of all conditions precedent, including submission and verification of the required documents.",
            3: "The outstanding principal balance shall bear interest at the rate specified above. Interest shall be calculated on a reducing balance basis.",
            4: "The Borrower shall repay the Loan Amount together with interest as per the Repayment Frequency and EMI Amount specified above. All payments made by the Borrower shall be applied first to accrued interest and then to the principal balance.",
            5: "If the Borrower fails to make any payment within 7 days of the due date, a late fee of 2% of the overdue amount shall apply. In the event of default, the Lender reserves the right to declare the entire outstanding balance immediately due and payable.",
            6: "The Borrower may prepay or foreclose the loan, in part or in full, subject to the Lender's prevailing prepayment policy and any applicable prepayment charges.",
            7: "The loan shall be secured as specified in the Repayment & Security details above. The Lender reserves the right to invoke the security provided in the event of default by the Borrower.",
            8: "The Borrower confirms that the information and documents provided in connection with this loan application are true, accurate and complete, and agrees to comply with the terms and conditions of this Agreement.",
            9: "This Agreement shall be governed by and construed in accordance with the laws of India. Any disputes arising out of this Agreement shall be subject to the exclusive jurisdiction of the courts in Bangalore, Karnataka.",
        },
        "witness": "IN WITNESS WHEREOF, the parties have executed this Agreement as of the date first written above.",
        "borrower_signature": "Borrower Signature", "lender_signatory": "Lender Authorized Signatory",
        "name_label": "Name:", "lender_name": "LegalDesk Finance",
    },
    "Hindi": {
        "title_suffix": "अनुबंध",
        "section_headings": {
            "loan_details": "ऋण विवरण", "borrower_details": "उधारकर्ता विवरण",
            "property_details": "संपदा विवरण", "vehicle_details": "वाहन विवरण",
            "financial_details": "वित्तीय विवरण", "farm_details": "खेत विवरण",
            "crop_details": "फसल विवरण", "repayment_security": "पुनर्भुगतान और सुरक्षा",
            "personal_kyc": "व्यक्तिगत / केवाईसी विवरण", "address": "पता विवरण",
            "party_employment": "रोजगार / व्यवसाय विवरण", "income_sources": "आय विवरण",
            "party_existing_loans": "मौजूदा ऋण", "party_bank_accounts": "बैंक खाते",
            "party_assets": "संपत्तियां", "party_references": "संदर्भ",
        },
        "party_roles": {"applicant": "आवेदक", "co_applicant": "सह-आवेदक", "guarantor": "गारंटर"},
        "signature_captions": {
            "applicant": "आवेदक के हस्ताक्षर", "co_applicant": "सह-आवेदक के हस्ताक्षर",
            "guarantor": "गारंटर के हस्ताक्षर",
        },
        "present_address": "वर्तमान पता:", "permanent_address": "स्थायी पता:",
        "office_address": "कार्यालय / व्यवसाय पता:",
        "loan_details_fields": {
            "agreement_date": "अनुबंध तारीख:", "application_no": "ऋण आवेदन संख्या:",
            "account_no": "ऋण खाता संख्या:", "loan_amount": "ऋण रकम:", "interest_rate": "ब्याज दर:",
            "tenure": "ऋण मीयाद:", "repayment_frequency": "भुगतान बारंबारता:", "emi_amount": "ईएमआई रकम:",
            "loan_purpose": "ऋण का उद्देश्य:",
        },
        "borrower_name": "उधारकर्ता का नाम:", "mobile_number": "मोबाइल नंबर:", "email": "ईमेल:", "months": "महीने",
        "first_emi_date": "प्रथम ईएमआई तारीख:", "final_emi_date": "अंतिम ईएमआई तारीख:",
        "terms_headings": [
            "1. पक्षकार", "2. ऋण संवितरण", "3. ब्याज दर", "4. पुनर्भुगतान की शर्तें",
            "5. विलंब शुल्क और चूक", "6. पूर्व भुगतान / फोरक्लोज़र", "7. सुरक्षा / गिरवी",
            "8. उधारकर्ता घोषणा", "9. शासी कानून", "10. हस्ताक्षर",
        ],
        "terms_bodies": {
            1: 'यह ऋण अनुबंध ("अनुबंध") <b>{name}</b> ("उधारकर्ता") और लीगलडेस्क फाइनेंशियल सर्विसेज ("ऋणदाता") के बीच किया गया है। उधारकर्ता इस अनुबंध में उल्लिखित नियमों और शर्तों के अनुसार ऊपर बताई गई ऋण रकम चुकाने के लिए सहमत है।',
            2: "ऋण रकम इस अनुबंध के निष्पादन और सभी आवश्यक पूर्व शर्तों, जिसमें आवश्यक दस्तावेज़ों को प्रस्तुत करना और सत्यापित करना शामिल है, के पूरा होने पर ऋणदाता द्वारा उधारकर्ता को संवितरित की जाएगी।",
            3: "बकाया मूल रकम पर ऊपर बताई गई दर से ब्याज लगेगा। ब्याज की गणना घटते शेष आधार पर की जाएगी।",
            4: "उधारकर्ता ऊपर बताई गई भुगतान बारंबारता और ईएमआई रकम के अनुसार ब्याज सहित ऋण रकम चुकाएगा। उधारकर्ता द्वारा किया गया प्रत्येक भुगतान पहले संचित ब्याज पर और फिर मूल रकम पर लागू होगा।",
            5: "अगर उधारकर्ता नियत तारीख के 7 दिनों के भीतर कोई भुगतान करने में विफल रहता है, तो बकाया रकम पर 2% विलंब शुल्क लागू होगा। चूक होने पर, ऋणदाता को पूरी बकाया रकम तुरंत देय घोषित करने का अधिकार सुरक्षित है।",
            6: "उधारकर्ता ऋणदाता के प्रचलित पूर्व-भुगतान नियम और लागू पूर्व-भुगतान शुल्क के अधीन, ऋण का आंशिक या पूर्ण पूर्व-भुगतान अथवा फोरक्लोज़र कर सकता है।",
            7: "ऋण उपर्युक्त पुनर्भुगतान और सुरक्षा विवरण के अनुसार सुरक्षित होगा। उधारकर्ता द्वारा चूक होने पर ऋणदाता को प्रदान की गई सुरक्षा को लागू करने का अधिकार सुरक्षित है।",
            8: "उधारकर्ता घोषित करता है कि इस ऋण आवेदन के संबंध में दी गई जानकारी और दस्तावेज़ सत्य, सटीक और पूर्ण हैं, और इस अनुबंध की शर्तों का पालन करने के लिए सहमत है।",
            9: "यह अनुबंध भारत के कानूनों द्वारा शासित होगा। इस अनुबंध से उत्पन्न किसी भी विवाद के लिए बेंगलुरु, कर्नाटक की अदालतों का विशेष क्षेत्राधिकार होगा।",
        },
        "witness": "साक्ष्य स्वरूप, पक्षकारों ने ऊपर बताई गई दिनांक को यह अनुबंध निष्पादित किया है।",
        "borrower_signature": "उधारकर्ता के हस्ताक्षर", "lender_signatory": "ऋणदाता के अधिकृत हस्ताक्षरकर्ता",
        "name_label": "नाम:", "lender_name": "लीगलडेस्क फाइनेंस",
    },
    "Kannada": {
        "title_suffix": "ಒಪ್ಪಂದ",
        "section_headings": {
            "loan_details": "ಸಾಲದ ವಿವರಗಳು", "borrower_details": "ಸಾಲಗಾರರ ವಿವರಗಳು",
            "property_details": "ಆಸ್ತಿ ವಿವರಗಳು", "vehicle_details": "ವಾಹನ ವಿವರಗಳು",
            "financial_details": "ಆರ್ಥಿಕ ವಿವರಗಳು", "farm_details": "ಜಮೀನಿನ ವಿವರಗಳು",
            "crop_details": "ಬೆಳೆ ವಿವರಗಳು", "repayment_security": "ಮರುಪಾವತಿ ಮತ್ತು ಭದ್ರತೆ",
            "personal_kyc": "ವೈಯಕ್ತಿಕ / ಕೆವೈಸಿ ವಿವರಗಳು", "address": "ವಿಳಾಸ ವಿವರಗಳು",
            "party_employment": "ಉದ್ಯೋಗ / ವ್ಯಾಪಾರ ವಿವರಗಳು", "income_sources": "ಆದಾಯ ವಿವರಗಳು",
            "party_existing_loans": "ಅಸ್ತಿತ್ವದಲ್ಲಿರುವ ಸಾಲಗಳು", "party_bank_accounts": "ಬ್ಯಾಂಕ್ ಖಾತೆಗಳು",
            "party_assets": "ಆಸ್ತಿಗಳು", "party_references": "ಉಲ್ಲೇಖಗಳು",
        },
        "party_roles": {"applicant": "ಅರ್ಜಿದಾರ", "co_applicant": "ಸಹ-ಅರ್ಜಿದಾರ", "guarantor": "ಖಾತರಿದಾರ"},
        "signature_captions": {
            "applicant": "ಅರ್ಜಿದಾರರ ಸಹಿ", "co_applicant": "ಸಹ-ಅರ್ಜಿದಾರರ ಸಹಿ",
            "guarantor": "ಖಾತರಿದಾರರ ಸಹಿ",
        },
        "present_address": "ಪ್ರಸ್ತುತ ವಿಳಾಸ:", "permanent_address": "ಶಾಶ್ವತ ವಿಳಾಸ:",
        "office_address": "ಕಚೇರಿ / ವ್ಯಾಪಾರ ವಿಳಾಸ:",
        "loan_details_fields": {
            "agreement_date": "ಒಪ್ಪಂದದ ದಿನಾಂಕ:", "application_no": "ಸಾಲದ ಅರ್ಜಿ ಸಂಖ್ಯೆ:",
            "account_no": "ಸಾಲದ ಖಾತೆ ಸಂಖ್ಯೆ:", "loan_amount": "ಸಾಲದ ಮೊತ್ತ:", "interest_rate": "ಬಡ್ಡಿ ದರ:",
            "tenure": "ಸಾಲದ ಅವಧಿ:", "repayment_frequency": "ಮರುಪಾವತಿ ಆವರ್ತನ:", "emi_amount": "ಇಎಂಐ ಮೊತ್ತ:",
            "loan_purpose": "ಸಾಲದ ಉದ್ದೇಶ:",
        },
        "borrower_name": "ಸಾಲಗಾರರ ಹೆಸರು:", "mobile_number": "ಮೊಬೈಲ್ ಸಂಖ್ಯೆ:", "email": "ಇಮೇಲ್:", "months": "ತಿಂಗಳುಗಳು",
        "first_emi_date": "ಮೊದಲ ಇಎಂಐ ದಿನಾಂಕ:", "final_emi_date": "ಅಂತಿಮ ಇಎಂಐ ದಿನಾಂಕ:",
        "terms_headings": [
            "1. ಪಕ್ಷಗಳು", "2. ಸಾಲ ವಿತರಣೆ", "3. ಬಡ್ಡಿ ದರ", "4. ಮರುಪಾವತಿ ನಿಯಮಗಳು",
            "5. ವಿಳಂಬ ಶುಲ್ಕ ಮತ್ತು ಸುಸ್ತಿ", "6. ಪೂರ್ವಪಾವತಿ / ಫೋರ್‌ಕ್ಲೋಶರ್", "7. ಭದ್ರತೆ / ಅಡಮಾನ",
            "8. ಸಾಲಗಾರರ ಘೋಷಣೆ", "9. ಆಡಳಿತ ಕಾನೂನು", "10. ಸಹಿಗಳು",
        ],
        "terms_bodies": {
            1: 'ಈ ಸಾಲ ಒಪ್ಪಂದ ("ಒಪ್ಪಂದ") <b>{name}</b> ("ಸಾಲಗಾರ") ಮತ್ತು ಲೀಗಲ್‌ಡೆಸ್ಕ್ ಫೈನಾನ್ಶಿಯಲ್ ಸರ್ವೀಸಸ್ ("ಸಾಲದಾತ") ನಡುವೆ ಮಾಡಿಕೊಳ್ಳಲಾಗಿದೆ. ಈ ಒಪ್ಪಂದದಲ್ಲಿ ವಿವರಿಸಿದ ನಿಯಮ ಮತ್ತು ಷರತ್ತುಗಳ ಪ್ರಕಾರ ಮೇಲೆ ತಿಳಿಸಿದ ಸಾಲದ ಮೊತ್ತವನ್ನು ಮರುಪಾವತಿಸಲು ಸಾಲಗಾರ ಒಪ್ಪುತ್ತಾರೆ.',
            2: "ಈ ಒಪ್ಪಂದದ ಕಾರ್ಯಗತಗೊಳಿಸುವಿಕೆ ಮತ್ತು ಅಗತ್ಯ ದಾಖಲೆಗಳ ಸಲ್ಲಿಕೆ ಹಾಗೂ ಪರಿಶೀಲನೆ ಸೇರಿದಂತೆ ಎಲ್ಲಾ ಪೂರ್ವಷರತ್ತುಗಳ ಪೂರ್ಣಗೊಳಿಸುವಿಕೆಯ ನಂತರ ಸಾಲದಾತರು ಸಾಲಗಾರರಿಗೆ ಸಾಲದ ಮೊತ್ತವನ್ನು ವಿತರಿಸುತ್ತಾರೆ.",
            3: "ಬಾಕಿ ಇರುವ ಅಸಲು ಮೊತ್ತದ ಮೇಲೆ ಮೇಲೆ ತಿಳಿಸಿದ ದರದಲ್ಲಿ ಬಡ್ಡಿ ವಿಧಿಸಲಾಗುವುದು. ಬಡ್ಡಿಯನ್ನು ಇಳಿಕೆಯಾಗುತ್ತಿರುವ ಬಾಕಿ ಆಧಾರದ ಮೇಲೆ ಲೆಕ್ಕಹಾಕಲಾಗುವುದು.",
            4: "ಸಾಲಗಾರರು ಮೇಲೆ ತಿಳಿಸಿದ ಮರುಪಾವತಿ ಆವರ್ತನ ಮತ್ತು ಇಎಂಐ ಮೊತ್ತದ ಪ್ರಕಾರ ಬಡ್ಡಿ ಸಹಿತ ಸಾಲದ ಮೊತ್ತವನ್ನು ಮರುಪಾವತಿಸಬೇಕು. ಸಾಲಗಾರರು ಮಾಡುವ ಎಲ್ಲಾ ಪಾವತಿಗಳನ್ನು ಮೊದಲು ಸಂಚಿತ ಬಡ್ಡಿಗೆ ಮತ್ತು ನಂತರ ಅಸಲು ಮೊತ್ತಕ್ಕೆ ಅನ್ವಯಿಸಲಾಗುವುದು.",
            5: "ಸಾಲಗಾರರು ನಿಗದಿತ ದಿನಾಂಕದ 7 ದಿನಗಳೊಳಗೆ ಯಾವುದೇ ಪಾವತಿ ಮಾಡಲು ವಿಫಲರಾದರೆ, ಬಾಕಿ ಮೊತ್ತದ ಮೇಲೆ ಶೇಕಡಾ 2 ವಿಳಂಬ ಶುಲ್ಕ ಅನ್ವಯಿಸುತ್ತದೆ. ಸುಸ್ತಿಯ ಸಂದರ್ಭದಲ್ಲಿ, ಇಡೀ ಬಾಕಿ ಮೊತ್ತವನ್ನು ತಕ್ಷಣ ಪಾವತಿಸಬೇಕೆಂದು ಘೋಷಿಸುವ ಹಕ್ಕನ್ನು ಸಾಲದಾತರು ಕಾಯ್ದಿರಿಸಿಕೊಂಡಿದ್ದಾರೆ.",
            6: "ಸಾಲಗಾರರು ಸಾಲದಾತರ ಚಾಲ್ತಿಯಲ್ಲಿರುವ ಪೂರ್ವಪಾವತಿ ನೀತಿ ಮತ್ತು ಅನ್ವಯವಾಗುವ ಪೂರ್ವಪಾವತಿ ಶುಲ್ಕಗಳಿಗೆ ಒಳಪಟ್ಟು, ಸಾಲವನ್ನು ಭಾಗಶಃ ಅಥವಾ ಸಂಪೂರ್ಣವಾಗಿ ಪೂರ್ವಪಾವತಿ ಅಥವಾ ಫೋರ್‌ಕ್ಲೋಸ್ ಮಾಡಬಹುದು.",
            7: "ಮೇಲಿನ ಮರುಪಾವತಿ ಮತ್ತು ಭದ್ರತಾ ವಿವರಗಳಲ್ಲಿ ನಿರ್ದಿಷ್ಟಪಡಿಸಿದಂತೆ ಸಾಲವನ್ನು ಭದ್ರಪಡಿಸಲಾಗುವುದು. ಸಾಲಗಾರರು ಸುಸ್ತಿ ಮಾಡಿದ ಸಂದರ್ಭದಲ್ಲಿ ಒದಗಿಸಲಾದ ಭದ್ರತೆಯನ್ನು ಜಾರಿಗೊಳಿಸುವ ಹಕ್ಕನ್ನು ಸಾಲದಾತರು ಕಾಯ್ದಿರಿಸಿಕೊಂಡಿದ್ದಾರೆ.",
            8: "ಈ ಸಾಲದ ಅರ್ಜಿಗೆ ಸಂಬಂಧಿಸಿದಂತೆ ಒದಗಿಸಲಾದ ಮಾಹಿತಿ ಮತ್ತು ದಾಖಲೆಗಳು ನಿಜ, ನಿಖರ ಮತ್ತು ಸಂಪೂರ್ಣವಾಗಿವೆ ಎಂದು ಸಾಲಗಾರರು ದೃಢಪಡಿಸುತ್ತಾರೆ ಮತ್ತು ಈ ಒಪ್ಪಂದದ ನಿಯಮ ಮತ್ತು ಷರತ್ತುಗಳನ್ನು ಪಾಲಿಸಲು ಒಪ್ಪುತ್ತಾರೆ.",
            9: "ಈ ಒಪ್ಪಂದವು ಭಾರತದ ಕಾನೂನುಗಳಿಂದ ನಿಯಂತ್ರಿಸಲ್ಪಡುತ್ತದೆ ಮತ್ತು ಅವುಗಳ ಪ್ರಕಾರ ಅರ್ಥೈಸಲ್ಪಡುತ್ತದೆ. ಈ ಒಪ್ಪಂದದಿಂದ ಉದ್ಭವಿಸುವ ಯಾವುದೇ ವಿವಾದಗಳು ಬೆಂಗಳೂರು, ಕರ್ನಾಟಕದ ನ್ಯಾಯಾಲಯಗಳ ವಿಶೇಷ ಅಧಿಕಾರ ವ್ಯಾಪ್ತಿಗೆ ಒಳಪಟ್ಟಿರುತ್ತವೆ.",
        },
        "witness": "ಇದಕ್ಕೆ ಸಾಕ್ಷಿಯಾಗಿ, ಪಕ್ಷಗಳು ಮೇಲೆ ತಿಳಿಸಿದ ದಿನಾಂಕದಂದು ಈ ಒಪ್ಪಂದವನ್ನು ಕಾರ್ಯಗತಗೊಳಿಸಿದ್ದಾರೆ.",
        "borrower_signature": "ಸಾಲಗಾರರ ಸಹಿ", "lender_signatory": "ಸಾಲದಾತರ ಅಧಿಕೃತ ಸಹಿದಾರ",
        "name_label": "ಹೆಸರು:", "lender_name": "ಲೀಗಲ್‌ಡೆಸ್ಕ್ ಫೈನಾನ್ಸ್",
    },
    "Marathi": {
        "title_suffix": "करार",
        "section_headings": {
            "loan_details": "कर्ज तपशील", "borrower_details": "कर्जदार तपशील",
            "property_details": "मालमत्ता तपशील", "vehicle_details": "वाहन तपशील",
            "financial_details": "आर्थिक तपशील", "farm_details": "शेत तपशील",
            "crop_details": "पीक तपशील", "repayment_security": "परतफेड व सुरक्षा",
            "personal_kyc": "वैयक्तिक / केवायसी तपशील", "address": "पत्ता तपशील",
            "party_employment": "रोजगार / व्यवसाय तपशील", "income_sources": "उत्पन्न तपशील",
            "party_existing_loans": "विद्यमान कर्जे", "party_bank_accounts": "बँक खाती",
            "party_assets": "मालमत्ता", "party_references": "संदर्भ",
        },
        "party_roles": {"applicant": "अर्जदार", "co_applicant": "सह-अर्जदार", "guarantor": "जामीनदार"},
        "signature_captions": {
            "applicant": "अर्जदाराची स्वाक्षरी", "co_applicant": "सह-अर्जदाराची स्वाक्षरी",
            "guarantor": "जामीनदाराची स्वाक्षरी",
        },
        "present_address": "सध्याचा पत्ता:", "permanent_address": "कायमचा पत्ता:",
        "office_address": "कार्यालय / व्यवसाय पत्ता:",
        "loan_details_fields": {
            "agreement_date": "करार तारीख:", "application_no": "कर्ज अर्ज क्रमांक:",
            "account_no": "कर्ज खाते क्रमांक:", "loan_amount": "कर्जाची रक्कम:", "interest_rate": "व्याज दर:",
            "tenure": "कर्ज कालावधी:", "repayment_frequency": "परतफेड वारंवारता:", "emi_amount": "ईएमआय रक्कम:",
            "loan_purpose": "कर्जाचा उद्देश:",
        },
        "borrower_name": "कर्जदाराचे नाव:", "mobile_number": "मोबाइल क्रमांक:", "email": "ईमेल:", "months": "महिने",
        "first_emi_date": "पहिली ईएमआय तारीख:", "final_emi_date": "अंतिम ईएमआय तारीख:",
        "terms_headings": [
            "1. पक्षकार", "2. कर्ज वितरण", "3. व्याज दर", "4. परतफेडीच्या अटी",
            "5. विलंब शुल्क व कसूर", "6. पूर्वपरतफेड / फोरक्लोजर", "7. सुरक्षा / तारण",
            "8. कर्जदाराची घोषणा", "9. नियामक कायदा", "10. स्वाक्षऱ्या",
        ],
        "terms_bodies": {
            1: 'हा कर्ज करार ("करार") <b>{name}</b> ("कर्जदार") व लीगलडेस्क फायनान्शियल सर्व्हिसेस ("कर्जदाता") यांच्यात करण्यात आला आहे. या करारात नमूद केलेल्या अटी व शर्तींनुसार वरील कर्जाची रक्कम परत करण्यास कर्जदार सहमत आहे.',
            2: "या कराराच्या अंमलबजावणीनंतर व आवश्यक कागदपत्रांचे सादरीकरण व पडताळणीसह सर्व पूर्व-अटी पूर्ण झाल्यानंतर कर्जदात्याकडून कर्जदाराला कर्जाची रक्कम वितरित केली जाईल.",
            3: "थकीत मूळ रकमेवर वर नमूद केलेल्या दराने व्याज आकारले जाईल. व्याजाची गणना घटत्या शिल्लक पद्धतीने केली जाईल.",
            4: "कर्जदार वर नमूद केलेल्या परतफेड वारंवारतेनुसार व ईएमआय रकमेनुसार व्याजासह कर्जाची रक्कम परत करेल. कर्जदाराने केलेली सर्व देयके प्रथम जमा झालेल्या व्याजाला व नंतर मूळ रकमेला लागू केली जातील.",
            5: "कर्जदार नियत तारखेच्या 7 दिवसांच्या आत कोणतेही देयक करण्यात अयशस्वी झाल्यास, थकीत रकमेवर 2% विलंब शुल्क लागू होईल. कसुरीच्या प्रसंगी, संपूर्ण थकीत शिल्लक त्वरित देय घोषित करण्याचा अधिकार कर्जदात्याकडे राखीव आहे.",
            6: "कर्जदाता यांच्या प्रचलित पूर्वपरतफेड धोरणाच्या व लागू पूर्वपरतफेड शुल्काच्या अधीन राहून, कर्जदार कर्जाची अंशतः किंवा पूर्णतः पूर्वपरतफेड किंवा फोरक्लोजर करू शकतो.",
            7: "वरील परतफेड व सुरक्षा तपशीलानुसार कर्ज सुरक्षित केले जाईल. कर्जदाराकडून कसूर झाल्यास दिलेली सुरक्षा वापरण्याचा अधिकार कर्जदात्याकडे राखीव आहे.",
            8: "या कर्ज अर्जाच्या संदर्भात दिलेली माहिती व कागदपत्रे खरी, अचूक व पूर्ण आहेत याची कर्जदार पुष्टी करतो व या कराराच्या अटी व शर्तींचे पालन करण्यास सहमत आहे.",
            9: "हा करार भारताच्या कायद्यांनुसार नियंत्रित व अर्थ लावला जाईल. या करारातून उद्भवणारे कोणतेही वाद बेंगळुरू, कर्नाटक येथील न्यायालयांच्या विशेष अधिकारक्षेत्राच्या अधीन असतील.",
        },
        "witness": "याची साक्ष म्हणून, पक्षकारांनी वर नमूद केलेल्या दिनांकास हा करार अंमलात आणला आहे.",
        "borrower_signature": "कर्जदाराची स्वाक्षरी", "lender_signatory": "कर्जदात्याचा अधिकृत स्वाक्षरीकर्ता",
        "name_label": "नाव:", "lender_name": "लीगलडेस्क फायनान्स",
    },
}


def get_loan_i18n(language: str) -> dict:
    return LOAN_I18N.get(language, LOAN_I18N["English"])
