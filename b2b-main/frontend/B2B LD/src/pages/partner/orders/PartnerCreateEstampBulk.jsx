import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest } from "../../../lib/api";
import { formatCurrency } from "../../../lib/format";
import { theme, serif } from "../../../lib/userPortalTheme";
import { isValidMobile, sanitizeMobileInput } from "../../../lib/validation";
import { GST_RATE, calculateGst } from "../../../lib/gst";

const SERVICE_NAME = "eStamp Bulk";

// Stamp Paper Types with a real order-creation flow — a state can be
// configured with an admin-added custom name (see StampDenomination.jsx
// "+ Add New Type") that isn't one of these, in which case a "coming soon"
// notice shows instead of the form (see isKnownStampPaperType below).
// "ESBTR" (Maharashtra) deliberately behaves like "Traditional Stamp Paper"
// here — same generic denomination-rows bulk-order flow, using whatever
// pricing the admin has configured for it — not a distinct eSBTR-specific
// flow (that's the separate "eStamp On The Fly" service's Maharashtra
// path, not Bulk).
const KNOWN_STAMP_PAPER_TYPES = ["Traditional Stamp Paper", "eStamp", "ESBTR"];

const inputClass = "w-full px-4 py-2.5 text-sm rounded outline-none transition-all";
const inputStyle = { background: theme.bg, border: `1px solid ${theme.border}`, color: "#1e293b" };

const Field = ({ label, error, children }) => (
  <div>
    {error && <p className="text-xs font-medium mb-1" style={{ color: theme.danger }}>{error}</p>}
    <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: theme.slate }}>{label}</label>
    {children}
  </div>
);

// Same "error text directly above the control" pattern as Field, for spots
// (table cells, the registered-address display block) that don't use Field's
// label/wrapper.
const FieldError = ({ children }) =>
  children ? <p className="text-xs font-medium mb-1" style={{ color: theme.danger }}>{children}</p> : null;

// Article Code list can run into the dozens, so a plain <select> makes
// finding one tedious — this opens a panel with its own search bar on top
// of the (filtered) option list instead, closing on outside click/Escape.
const ArticleCodeSearchSelect = ({ articleCodes, value, onSelect, placeholder }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef(null);
  const searchRef = useRef(null);

  const selected = articleCodes.find((a) => String(a.id) === String(value));

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? articleCodes.filter(
        (a) => a.article_code?.toLowerCase().includes(q) || a.description?.toLowerCase().includes(q)
      )
    : articleCodes;

  const handleSelect = (articleCode) => {
    onSelect(articleCode.id);
    setQuery("");
    setOpen(false);
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => {
          setOpen((prev) => !prev);
          setTimeout(() => searchRef.current?.focus(), 0);
        }}
        className={`${inputClass} text-left flex items-center justify-between gap-2`}
        style={inputStyle}
      >
        <span style={{ color: selected ? "#1e293b" : theme.slate }}>
          {selected ? `${selected.article_code}${selected.description ? ` — ${selected.description}` : ""}` : placeholder}
        </span>
        <span style={{ color: theme.slate, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>▾</span>
      </button>
      {open && (
        <div
          className="absolute z-20 mt-1 w-full rounded-xl shadow-lg overflow-hidden"
          style={{ background: "#fff", border: `1px solid ${theme.border}` }}
        >
          <div className="p-2 border-b" style={{ borderColor: theme.border }}>
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
              placeholder="Search article code..."
              className={inputClass}
              style={inputStyle}
            />
          </div>
          <div className="max-h-56 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-4 py-3 text-sm" style={{ color: theme.slate }}>No article codes found</p>
            ) : (
              filtered.map((a) => (
                <button
                  type="button"
                  key={a.id}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleSelect(a)}
                  className="w-full text-left px-4 py-2.5 text-sm transition-colors hover:bg-[#F3F8FB]"
                  style={{ background: String(a.id) === String(value) ? theme.bg : "transparent", color: "#1e293b" }}
                >
                  {a.article_code}{a.description ? ` — ${a.description}` : ""}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const SectionLabel = ({ children }) => (
  <h2 className="text-sm font-bold uppercase tracking-wide mb-3" style={{ color: theme.navy, fontFamily: serif }}>{children}</h2>
);

// Always offered as quick picks in every state's denomination dropdown,
// regardless of what Super Admin has (or hasn't) configured for that state —
// the two most common physical stamp paper denominations. "preset-<value>"
// is a sentinel resolved the same way "custom" is (see rowDenominationValue/
// handleSubmit below), just with the amount already known instead of typed.
const PRESET_DENOMINATIONS = [100, 200];

const emptyRow = { stamp_denomination_id: "", customValue: "", quantity: "" };
const emptyDeliveryAddress = { full_name: "", mobile: "", address_line1: "", address_line2: "", city: "", state: "", pincode: "" };

const PartnerCreateEstampBulk = () => {
  const navigate = useNavigate();

  // `states` backs both the Stamp State field (drives which denominations
  // load below) and the Delivery Address "State" field — two independent
  // per-order choices. Stamp State defaults to the org's onboarding state
  // (see the profile fetch below) but can still be changed per order.
  const [states, setStates] = useState([]);
  const [stampStateId, setStampStateId] = useState("");
  const [denominations, setDenominations] = useState([]);
  const [loadingDenominations, setLoadingDenominations] = useState(false);
  const [rows, setRows] = useState([]);
  // eStamp-type states (Super Admin-configured per state — see
  // StampDenomination.jsx's "Stamp Paper Type by State" section) skip
  // denomination selection entirely: the Partner enters Consideration Amount
  // + Article Code instead, and Admin determines/adds the actual
  // denomination later via KASCoSA (see OrderDetail.jsx's EstampBulkSection).
  const [considerationAmount, setConsiderationAmount] = useState("");
  const [articleCodeId, setArticleCodeId] = useState("");
  const [articleCodes, setArticleCodes] = useState([]);

  // Organization's onboarding profile — used to default the Stamp State and
  // to prefill Delivery Address when "Same as registered address" is checked.
  const [orgProfile, setOrgProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [sameAsRegistered, setSameAsRegistered] = useState(true);

  const [deliveryAddress, setDeliveryAddress] = useState({ ...emptyDeliveryAddress });
  // Every eStamp Bulk order names a First Party and a Second Party, one of
  // which is always this logged-in Partner — partnerParty tracks which
  // position, payingParty who's responsible for the charges (independent of
  // partnerParty). The Partner's own name/address are never typed here —
  // they're read straight off orgProfile below, exactly like the
  // registered-address block does for Delivery Address.
  const [partnerParty, setPartnerParty] = useState("first");
  const [payingParty, setPayingParty] = useState("first");
  const [otherPartyName, setOtherPartyName] = useState("");
  const [otherPartyAddress, setOtherPartyAddress] = useState("");
  // Every additional charge Super Admin has assigned to eStamp Bulk for this
  // org (organization_service_charge_pricing) — an arbitrary, admin-defined
  // list, not just Delivery Charge. eStamp Bulk has no separate Base Price
  // (see PartnerEstampBulkOrderDetails.jsx and create_bulk_estamp_order):
  // its own fee is one of these charges, named "Service Charge", priced
  // either as a flat amount or as a percentage of the stamp face value.
  // See GET /api/partner/services/{name}/charges.
  const [additionalCharges, setAdditionalCharges] = useState([]);
  // Super Admin's per-partner tiered pricing rules (denomination range x
  // quantity range -> charge — see BulkEstampPricingPanel.jsx / organizations.
  // list_bulk_estamp_pricing_rules), used only to preview the same "Bulk
  // eStamp Pricing" figure the order will actually be charged (see
  // partner._match_bulk_estamp_pricing_rule). Read-only here — the Partner
  // never sees or edits the ranges themselves, only picks a denomination and
  // quantity per row below and the matching charge is found automatically.
  const [pricingRules, setPricingRules] = useState([]);

  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Per-field validation errors, shown directly above each field instead of
  // a single top-of-form banner — see validateFields/handleSubmit below.
  // `rows` mirrors the `rows` array 1:1 ({ denomination?, quantity? } per
  // row); everything else is a flat message keyed by field name.
  const [fieldErrors, setFieldErrors] = useState({ rows: [] });

  useEffect(() => {
    apiRequest("/api/catalog/states").then(setStates).catch(() => setStates([]));
    apiRequest("/api/partner/profile")
      .then((profile) => {
        setOrgProfile(profile);
        if (profile.state_id) setStampStateId(profile.state_id);
        if (!profile.registered_address_line1) setSameAsRegistered(false);
      })
      .catch(() => setOrgProfile(null))
      .finally(() => setProfileLoading(false));
    apiRequest(`/api/partner/services/${encodeURIComponent(SERVICE_NAME)}/charges`)
      .then((res) => setAdditionalCharges(res.charges || []))
      .catch(() => setAdditionalCharges([]));
    apiRequest("/api/partner/estamp-bulk-pricing-rules")
      .then(setPricingRules)
      .catch(() => setPricingRules([]));
  }, []);

  // Denominations are per-state real master data (Super Admin's B2B Stamp
  // Denomination module), scoped to whichever state was picked above.
  useEffect(() => {
    if (!stampStateId) {
      setDenominations([]);
      return;
    }
    setLoadingDenominations(true);
    apiRequest(`/api/partner/stamp-denominations?state_id=${stampStateId}`)
      .then(setDenominations)
      .catch(() => setDenominations([]))
      .finally(() => setLoadingDenominations(false));
  }, [stampStateId]);

  // Article Codes are configured per-state too (see ArticleCodeMaster.jsx) —
  // another state's codes must never appear here, and switching states must
  // refresh the list rather than keep showing the previous state's options.
  useEffect(() => {
    if (!stampStateId) {
      setArticleCodes([]);
      return;
    }
    apiRequest(`/api/partner/article-codes?state_id=${stampStateId}`)
      .then(setArticleCodes)
      .catch(() => setArticleCodes([]));
  }, [stampStateId]);

  const handleStampStateChange = (value) => {
    setStampStateId(value);
    setRows([]);
    // Switching state can also switch flow type (Traditional <-> eStamp) —
    // clear whichever flow's inputs don't apply anymore rather than leave
    // stale values around that the next validateFields()/submit could pick up.
    setConsiderationAmount("");
    setArticleCodeId("");
    setFieldErrors((prev) => ({ ...prev, stampState: undefined, considerationAmount: undefined, articleCode: undefined, rowsGeneral: undefined, rows: [] }));
  };

  const selectedState = states.find((s) => String(s.id) === String(stampStateId));
  // Only one denomination line is allowed per Bulk order, so a Traditional
  // state's single (empty) row is seeded here — not inside
  // handleStampStateChange — so it also covers stampStateId being set from
  // the org's default profile state (see the profile-load effect above),
  // which never goes through that handler. Re-evaluates once `states`
  // finishes loading too, since that fetch can resolve after the profile one.
  useEffect(() => {
    if (!stampStateId || rows.length > 0) return;
    if (selectedState && selectedState.stamp_paper_type !== "eStamp") {
      setRows([{ ...emptyRow }]);
    }
  }, [stampStateId, selectedState, rows.length]);
  const isEstampState = selectedState?.stamp_paper_type === "eStamp";
  const isKnownStampPaperType = !selectedState || KNOWN_STAMP_PAPER_TYPES.includes(selectedState.stamp_paper_type);

  // Derived (not stored) view of the org's registered address.
  // `deliveryAddress` state itself is reserved for manual entry, used only
  // while the checkbox is unchecked.
  const registeredAddress = {
    full_name: orgProfile?.contact_person || orgProfile?.organization_name || "",
    mobile: orgProfile?.org_mobile || "",
    address_line1: orgProfile?.registered_address_line1 || "",
    address_line2: orgProfile?.registered_address_line2 || "",
    city: orgProfile?.registered_city || "",
    state: orgProfile?.state_name || "",
    pincode: orgProfile?.registered_pincode || "",
  };
  const effectiveDeliveryAddress = sameAsRegistered ? registeredAddress : deliveryAddress;

  // Same registered-address fields as above, joined into one display string
  // for the Party Details card — mirrors exactly what the backend derives
  // server-side for the Partner's party (see create_bulk_estamp_order), so
  // what's shown here never disagrees with what actually gets stored.
  const partnerPartyAddress = [
    orgProfile?.registered_address_line1, orgProfile?.registered_address_line2,
    orgProfile?.registered_city, orgProfile?.state_name, orgProfile?.registered_pincode,
  ].filter(Boolean).join(", ");
  const partnerAddressComplete = Boolean(
    orgProfile?.registered_address_line1 && orgProfile?.registered_city &&
    orgProfile?.state_name && orgProfile?.registered_pincode
  );

  const updateRow = (index, field, value) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
    // stamp_denomination_id and customValue both back the same "Denomination"
    // control/error; quantity is its own field.
    const clearedKey = field === "quantity" ? "quantity" : "denomination";
    setFieldErrors((prev) => {
      if (!prev.rows?.[index]?.[clearedKey]) return prev;
      const nextRows = prev.rows.map((e, i) => (i === index ? { ...e, [clearedKey]: undefined } : e));
      return { ...prev, rows: nextRows };
    });
  };

  // Maps delivery-address form fields to their fieldErrors keys (see
  // validateFields below).
  const DELIVERY_FIELD_ERROR_KEYS = {
    full_name: "deliveryFullName", mobile: "deliveryMobile", address_line1: "deliveryAddressLine1",
    city: "deliveryCity", state: "deliveryState", pincode: "deliveryPincode",
  };

  const updateDeliveryAddress = (field, value) => {
    setDeliveryAddress((prev) => ({
      ...prev,
      [field]: field === "mobile" ? sanitizeMobileInput(value) : field === "pincode" ? value.replace(/\D/g, "").slice(0, 6) : value,
    }));
    const key = DELIVERY_FIELD_ERROR_KEYS[field];
    if (key) setFieldErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  };

  const denominationById = (id) => denominations.find((d) => String(d.id) === String(id));
  const rowDenominationValue = (row) => {
    if (row.stamp_denomination_id === "custom") return Number(row.customValue) || 0;
    if (row.stamp_denomination_id?.startsWith("preset-")) return Number(row.stamp_denomination_id.slice(7)) || 0;
    return Number(denominationById(row.stamp_denomination_id)?.stamp_value) || 0;
  };
  const rowFaceValue = (row) => {
    const qty = parseInt(row.quantity, 10);
    const value = rowDenominationValue(row);
    return value > 0 && qty > 0 ? value * qty : 0;
  };

  const totalQuantity = rows.reduce((sum, r) => sum + (parseInt(r.quantity, 10) || 0), 0);
  const totalFaceValue = rows.reduce((sum, r) => sum + rowFaceValue(r), 0);

  // Live (not submit-gated) per-row flag for "this denomination is already
  // used in another row" — recomputed on every render straight from `rows`,
  // so a duplicate error appears/clears immediately as rows change rather
  // than needing to be manually tracked in fieldErrors.
  const duplicateRowIndexes = (() => {
    const valueCounts = {};
    rows.forEach((r) => {
      const key = rowDenominationValue(r);
      if (key > 0) valueCounts[key] = (valueCounts[key] || 0) + 1;
    });
    return rows.map((r) => {
      const key = rowDenominationValue(r);
      return key > 0 && valueCounts[key] > 1;
    });
  })();

  // Preview only — the backend recomputes every charge authoritatively at
  // order creation (create_bulk_estamp_order) from the same admin config and
  // the actual submitted denomination/quantity rows, never trusting this
  // client-side figure. percentage_charge = face value x percentage / 100;
  // final = MAX(percentage_charge, minimum_amount) — mirrors the backend
  // formula exactly so the preview and the real charge always agree.
  const previewChargeAmount = (c) => {
    if (c.charge_name === "Service Charge" && c.calculation_type === "percentage") {
      const percentageCharge = (totalFaceValue * (Number(c.percentage) || 0)) / 100;
      return Math.max(percentageCharge, Number(c.minimum_amount) || 0);
    }
    return Number(c.price || 0);
  };
  const chargesWithPreview = additionalCharges.map((c) => ({ ...c, previewAmount: previewChargeAmount(c) }));
  // Only charges that actually cost something are shown to the customer —
  // eStamp Bulk has no Base Price line at all (see the field's removal
  // above), and a configured-but-zero charge (e.g. a percentage Service
  // Charge that hasn't been given a percentage/minimum yet) isn't a real
  // line item either.
  const visibleCharges = chargesWithPreview.filter((c) => c.previewAmount > 0);
  const additionalChargesTotal = chargesWithPreview.reduce((sum, c) => sum + c.previewAmount, 0);

  // Preview only, same reasoning as previewChargeAmount above — mirrors
  // partner._match_bulk_estamp_pricing_rule + calculate_bulk_estamp_line_charge
  // exactly: quantity within [from, to-or-unlimited], and denomination
  // within a 'customize' rule's [from, to] OR at/above an 'any' rule's own
  // denomination_from (open-ended upward, NOT every denomination — 'any' is
  // [denomination_from, Infinity), never [0, Infinity)); a matching
  // 'customize' rule always takes precedence over an 'any' rule, same as
  // the backend. Summed per row, same as the backend: a row whose
  // denomination/quantity matches no rule simply contributes 0.
  const matchRuleCharge = (denomination, quantity) => {
    const qtyMatches = (r) => quantity >= r.quantity_from && (r.quantity_to === null || quantity <= r.quantity_to);
    const rule =
      pricingRules.find((r) =>
        r.denomination_type === "customize" &&
        denomination >= Number(r.denomination_from) && denomination <= Number(r.denomination_to) &&
        qtyMatches(r)
      ) || pricingRules.find((r) =>
        r.denomination_type === "any" &&
        denomination >= Number(r.denomination_from) &&
        qtyMatches(r)
      );
    if (!rule) return 0;
    return rule.charge_type === "percentage"
      ? denomination * (Number(rule.charge) / 100) * quantity
      : Number(rule.charge) * quantity;
  };
  const bulkPricingChargeTotal = rows.reduce((sum, r) => {
    const qty = parseInt(r.quantity, 10);
    const value = rowDenominationValue(r);
    return value > 0 && qty > 0 ? sum + matchRuleCharge(value, qty) : sum;
  }, 0);

  // GST applies to the service charge only, never the stamp face value
  // (invoice_service._stamp_item is always 0% GST) — same rule the Service
  // Invoice itself applies at generation time. Flat 18% for every state (see
  // lib/gst.js) — only the invoice's own CGST+SGST/IGST split differs by
  // state, never the rate, so this preview can't disagree with the real
  // invoice/wallet deduction.
  const serviceChargeTotal = additionalChargesTotal + bulkPricingChargeTotal;
  const gstAmount = calculateGst(serviceChargeTotal);

  const grandTotal = totalFaceValue + serviceChargeTotal + gstAmount;

  // Field-level validation — returns every invalid field at once (rather
  // than the first error found) so each one can be shown directly above its
  // own field instead of a single top-of-form message. Mirrors the backend's
  // BulkEstampOrderCreate/BulkEstampDeliveryAddressIn/BulkEstampPartyDetailsIn
  // requirements exactly (see backend/app/routes/partner.py) so nothing that
  // passes here should ever bounce off the API's own validation.
  const validateFields = () => {
    const errors = { rows: rows.map(() => ({})) };

    if (!stampStateId) errors.stampState = "Please select a stamp state.";

    if (isEstampState) {
      if (!considerationAmount || Number(considerationAmount) <= 0) {
        errors.considerationAmount = "Please enter a valid consideration amount.";
      }
      if (!articleCodeId) errors.articleCode = "Please select an article code.";
    } else if (rows.length === 0) {
      errors.rowsGeneral = "Please add at least one stamp denomination row.";
    } else {
      rows.forEach((row, i) => {
        if (!row.stamp_denomination_id) {
          errors.rows[i].denomination = "Please select a denomination.";
        } else if (row.stamp_denomination_id === "custom" && !(Number(row.customValue) > 0)) {
          errors.rows[i].denomination = "Please enter a denomination amount greater than 0.";
        }
        const qty = parseInt(row.quantity, 10);
        if (!qty || qty < 1) errors.rows[i].quantity = "Please enter a quantity of at least 1.";
      });
    }

    const a = effectiveDeliveryAddress;
    if (sameAsRegistered) {
      if (!a.full_name || !a.mobile || !a.address_line1 || !a.city || !a.state || !a.pincode) {
        errors.registeredAddress = "Your registered address is incomplete — uncheck \"Same as registered address\" and enter delivery details manually.";
      } else if (!isValidMobile(a.mobile)) {
        errors.registeredAddress = "Your registered mobile number on file isn't a valid 10-digit number — uncheck \"Same as registered address\" and enter delivery details manually.";
      } else if (!/^\d{6}$/.test(a.pincode)) {
        errors.registeredAddress = "Your registered pincode on file isn't a valid 6-digit pincode — uncheck \"Same as registered address\" and enter delivery details manually.";
      }
    } else {
      if (!a.full_name) errors.deliveryFullName = "Please enter the recipient's full name.";
      if (!a.mobile) errors.deliveryMobile = "Please enter a delivery mobile number.";
      else if (!isValidMobile(a.mobile)) errors.deliveryMobile = "Mobile number must be exactly 10 digits.";
      if (!a.address_line1) errors.deliveryAddressLine1 = "Please enter address line 1.";
      if (!a.city) errors.deliveryCity = "Please enter the city.";
      if (!a.state) errors.deliveryState = "Please select a state.";
      if (!a.pincode) errors.deliveryPincode = "Please enter a pincode.";
      else if (!/^\d{6}$/.test(a.pincode)) errors.deliveryPincode = "Pincode must be exactly 6 digits.";
    }

    if (!partnerAddressComplete) {
      errors.partnerAddress = "Your organization's registered address is incomplete — please complete your profile before placing an eStamp Bulk order.";
    }
    const otherSlotLabel = partnerParty === "first" ? "second" : "first";
    if (!otherPartyName.trim()) errors.otherPartyName = `Please enter the ${otherSlotLabel} party name.`;
    if (!otherPartyAddress.trim()) errors.otherPartyAddress = `Please enter the ${otherSlotLabel} party address.`;

    return errors;
  };

  const hasFieldErrors = (errors) =>
    !!errors.stampState || !!errors.considerationAmount || !!errors.articleCode || !!errors.rowsGeneral ||
    (errors.rows || []).some((e) => Object.keys(e).some((k) => e[k])) ||
    !!errors.registeredAddress || !!errors.deliveryFullName || !!errors.deliveryMobile ||
    !!errors.deliveryAddressLine1 || !!errors.deliveryCity || !!errors.deliveryState || !!errors.deliveryPincode ||
    !!errors.partnerAddress || !!errors.otherPartyName || !!errors.otherPartyAddress;

  // Converts a raw backend/Pydantic validation message (e.g. "Value error,
  // This field is required; Value error, This field is required" from a 422
  // response) into a clean, generic message — a safety net for the rare case
  // something reaches the API that validateFields didn't already catch,
  // since every field it actually enforces is validated above first.
  const friendlyApiError = (message) => {
    if (!message) return "Something went wrong. Please try again.";
    if (/value error,/i.test(message) || /field required/i.test(message)) {
      return "Some required information is missing or invalid. Please review the form and try again.";
    }
    return message;
  };

  const handleSubmit = async () => {
    const fieldErrorsResult = validateFields();
    if (hasFieldErrors(fieldErrorsResult) || duplicateRowIndexes.some(Boolean)) {
      setFieldErrors(fieldErrorsResult);
      return;
    }
    setFieldErrors({ rows: rows.map(() => ({})) });
    setError("");
    setSubmitting(true);
    try {
      const order = await apiRequest("/api/partner/orders/estamp-bulk", {
        method: "POST",
        body: JSON.stringify({
          customer_name: null,
          customer_email: null,
          customer_mobile: null,
          stamp_state_id: stampStateId,
          items: isEstampState ? [] : rows.map((r) =>
            r.stamp_denomination_id === "custom" || r.stamp_denomination_id?.startsWith("preset-")
              ? { stamp_value: rowDenominationValue(r), quantity: Number(r.quantity) }
              : { stamp_denomination_id: r.stamp_denomination_id, quantity: Number(r.quantity) }
          ),
          consideration_amount: isEstampState ? Number(considerationAmount) : null,
          article_code_id: isEstampState ? articleCodeId : null,
          delivery_address: { ...effectiveDeliveryAddress },
          party_details: {
            partner_party: partnerParty,
            paying_party: payingParty,
            other_party_name: otherPartyName.trim(),
            other_party_address: otherPartyAddress.trim(),
          },
        }),
      });
      navigate(`/partner/orders/estamp-bulk/${order.id}`);
    } catch (err) {
      setError(friendlyApiError(err.message));
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className="mb-6 pb-4 border-b" style={{ borderColor: theme.border }}>
        <h1 className="text-2xl font-bold" style={{ color: theme.ink, fontFamily: serif }}>Create eStamp Bulk Order</h1>
        <p className="text-sm mt-1" style={{ color: theme.slate }}>Request a batch of physical stamp papers across one or more denominations.</p>
      </div>

      <div className="rounded-lg p-6 max-w-3xl" style={{ background: theme.card, border: `1px solid ${theme.border}`, boxShadow: "0 1px 2px rgba(15,23,42,0.04)" }}>
        {error && <p className="text-xs font-medium mb-4 px-3 py-2 rounded" style={{ background: theme.dangerSoft, color: theme.danger, border: `1px solid ${theme.danger}33` }}>{error}</p>}

        <SectionLabel>Order Details</SectionLabel>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Stamp State *" error={fieldErrors.stampState}>
            <select value={stampStateId} onChange={(e) => handleStampStateChange(e.target.value)} className={inputClass} style={inputStyle}>
              <option value="">Select state</option>
              {states.map((s) => (<option key={s.id} value={s.id}>{s.state_name}</option>))}
            </select>
          </Field>
        </div>

        {!isKnownStampPaperType ? (
          <div className="mt-6 pt-5 border-t text-center py-10" style={{ borderColor: theme.border }}>
            <p className="text-sm font-semibold" style={{ color: theme.ink }}>Coming soon</p>
            <p className="text-xs mt-1.5 max-w-md mx-auto" style={{ color: theme.slate }}>
              "{selectedState?.stamp_paper_type}" is a newly added stamp paper type for {selectedState?.state_name} — ordering for it isn't available yet. Please select a different state, or check back later.
            </p>
          </div>
        ) : (
        <>
        <div className="mt-6 pt-5 border-t" style={{ borderColor: theme.border }}>
          <div className="mb-4">
            <h2 className="text-sm font-bold uppercase tracking-wide" style={{ color: theme.navy, fontFamily: serif }}>Party Details</h2>
            <p className="text-xs mt-0.5" style={{ color: theme.slate }}>Select which party the partner represents</p>
          </div>

          <div className="flex items-center gap-6">
            {[{ value: "first", label: "First Party" }, { value: "second", label: "Second Party" }].map((opt) => (
              <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="partnerParty"
                  checked={partnerParty === opt.value}
                  onChange={() => {
                    setPartnerParty(opt.value);
                    // The "other party" slot's label (First/Second) flips with
                    // this choice — clear its errors so a stale "second party"
                    // message can't linger once it's actually the first
                    // party's field.
                    setFieldErrors((prev) => ({ ...prev, otherPartyName: undefined, otherPartyAddress: undefined }));
                  }}
                  className="w-4 h-4"
                />
                <span className="text-sm font-semibold" style={{ color: theme.ink }}>{opt.label}</span>
              </label>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            {["first", "second"].map((slot) => {
              const isPartner = partnerParty === slot;
              return (
                <div key={slot} className="rounded-xl p-4" style={{ background: isPartner ? theme.goldSoft : "#fff", border: `1px solid ${theme.border}` }}>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-bold" style={{ color: theme.ink }}>
                      {slot === "first" ? "First Party" : "Second Party"}
                    </span>
                  </div>
                  {isPartner ? (
                    <div className="space-y-2.5">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: theme.slate }}>Party Name</p>
                        <p className="text-sm font-medium" style={{ color: theme.ink }}>{orgProfile?.organization_name || "-"}</p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: theme.slate }}>Address</p>
                        {profileLoading ? (
                          <p className="text-sm" style={{ color: theme.slate }}>Loading...</p>
                        ) : partnerAddressComplete ? (
                          <p className="text-sm" style={{ color: theme.ink }}>{partnerPartyAddress}</p>
                        ) : (
                          <div className="flex items-start gap-1.5 mt-1 px-2 py-1.5 rounded text-xs font-medium" style={{ background: theme.dangerSoft, color: theme.danger }}>
                            <span aria-hidden="true">⚠</span>
                            <span>Registered address incomplete.</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <Field label="Party Name *" error={fieldErrors.otherPartyName}>
                        <input
                          type="text" value={otherPartyName}
                          onChange={(e) => {
                            setOtherPartyName(e.target.value);
                            setFieldErrors((prev) => (prev.otherPartyName ? { ...prev, otherPartyName: undefined } : prev));
                          }}
                          placeholder="Enter party name" className={inputClass} style={{ ...inputStyle, background: "#fff" }}
                        />
                      </Field>
                      <Field label="Address *" error={fieldErrors.otherPartyAddress}>
                        <textarea
                          rows={2} value={otherPartyAddress}
                          onChange={(e) => {
                            setOtherPartyAddress(e.target.value);
                            setFieldErrors((prev) => (prev.otherPartyAddress ? { ...prev, otherPartyAddress: undefined } : prev));
                          }}
                          placeholder="Enter full address" className={inputClass} style={{ ...inputStyle, background: "#fff", resize: "vertical" }}
                        />
                      </Field>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-4 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3" style={{ background: theme.bg, border: `1px solid ${theme.border}` }}>
            <div>
              <p className="text-sm font-bold" style={{ color: theme.ink }}>Who is paying?</p>
              <p className="text-xs" style={{ color: theme.slate }}>Choose which party is responsible for the order charges</p>
            </div>
            <div className="flex items-center gap-6">
              {[{ value: "first", label: "First Party" }, { value: "second", label: "Second Party" }].map((opt) => (
                <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="payingParty"
                    checked={payingParty === opt.value}
                    onChange={() => setPayingParty(opt.value)}
                    className="w-4 h-4"
                  />
                  <span className="text-sm font-semibold" style={{ color: theme.ink }}>{opt.label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        {isEstampState ? (
          <div className="mt-6 pt-5 border-t" style={{ borderColor: theme.border }}>
            <SectionLabel>eStamp Details</SectionLabel>
            <p className="text-xs mb-3" style={{ color: theme.slate }}>
              This state uses eStamp — no denomination selection here. LegalDesk determines the applicable stamp denomination via KASCoSA and adds it to your order after review.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Consideration Amount *" error={fieldErrors.considerationAmount}>
                <input
                  type="number" min="0" value={considerationAmount}
                  onChange={(e) => {
                    setConsiderationAmount(e.target.value);
                    setFieldErrors((prev) => (prev.considerationAmount ? { ...prev, considerationAmount: undefined } : prev));
                  }}
                  placeholder="Enter amount" className={inputClass} style={inputStyle}
                />
              </Field>
              <Field label="Article Code *" error={fieldErrors.articleCode}>
                <ArticleCodeSearchSelect
                  articleCodes={articleCodes}
                  value={articleCodeId}
                  onSelect={(id) => {
                    setArticleCodeId(id);
                    setFieldErrors((prev) => (prev.articleCode ? { ...prev, articleCode: undefined } : prev));
                  }}
                  placeholder={articleCodes.length === 0 ? "No article codes configured yet" : "Select Article Code"}
                />
              </Field>
            </div>
          </div>
        ) : (
        <div className="mt-6 pt-5 border-t" style={{ borderColor: theme.border }}>
          <div className="mb-3">
            <h2 className="text-sm font-bold uppercase tracking-wide" style={{ color: theme.navy, fontFamily: serif }}>Bulk Stamp Requirements</h2>
          </div>

          {!stampStateId ? (
            <p className="text-sm" style={{ color: theme.slate }}>Select a stamp state above before choosing a denomination.</p>
          ) : rows.length === 0 ? (
            <p
              className="text-sm rounded-xl px-4 py-6 text-center font-medium"
              style={fieldErrors.rowsGeneral
                ? { color: theme.danger, background: theme.dangerSoft, border: `1px solid ${theme.danger}33` }
                : { color: theme.slate, background: theme.bg, border: `1px dashed ${theme.border}` }}
            >
              {fieldErrors.rowsGeneral || "No denomination selected yet."}
            </p>
          ) : (
            <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${theme.border}` }}>
              <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: theme.bg }}>
                    <th className="text-left px-3 py-2 text-xs font-semibold uppercase" style={{ color: theme.slate }}>Denomination</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold uppercase" style={{ color: theme.slate }}>Quantity</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold uppercase" style={{ color: theme.slate }}>Face Value</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => {
                    const usedElsewhere = new Set(rows.filter((_, i) => i !== index).map((r) => r.stamp_denomination_id));
                    const options = denominations.filter((d) => !usedElsewhere.has(String(d.id)) || String(d.id) === String(row.stamp_denomination_id));
                    const denominationError = fieldErrors.rows?.[index]?.denomination
                      || (duplicateRowIndexes[index] ? "This denomination is already used in another row." : undefined);
                    const quantityError = fieldErrors.rows?.[index]?.quantity;
                    return (
                      <tr key={index} className="border-t" style={{ borderColor: theme.border }}>
                        <td className="px-3 py-2 align-top">
                          <FieldError>{denominationError}</FieldError>
                          <select value={row.stamp_denomination_id} onChange={(e) => updateRow(index, "stamp_denomination_id", e.target.value)} disabled={loadingDenominations} className={inputClass} style={inputStyle}>
                            <option value="">{loadingDenominations ? "Loading..." : "Select"}</option>
                            {/* Always offered regardless of state/config — skipped only when that
                                exact amount is already a real configured option below, so it never
                                shows up twice under two different values for the same ₹ amount. */}
                            {PRESET_DENOMINATIONS.filter((v) => !denominations.some((d) => Number(d.stamp_value) === v)).map((v) => (
                              <option key={`preset-${v}`} value={`preset-${v}`}>₹{v}</option>
                            ))}
                            {options.map((d) => (<option key={d.id} value={d.id}>₹{d.stamp_value}</option>))}
                            <option value="custom">Other (type amount)</option>
                          </select>
                          {row.stamp_denomination_id === "custom" && (
                            <input
                              type="number" min="1" step="1" value={row.customValue}
                              onChange={(e) => updateRow(index, "customValue", e.target.value)}
                              placeholder="Enter denomination amount"
                              className={`${inputClass} mt-2`} style={inputStyle}
                            />
                          )}
                        </td>
                        <td className="px-3 py-2 align-top">
                          <FieldError>{quantityError}</FieldError>
                          <input type="number" min="1" step="1" value={row.quantity} onChange={(e) => updateRow(index, "quantity", e.target.value)} placeholder="0" className={`${inputClass} w-24`} style={inputStyle} />
                        </td>
                        <td className="px-3 py-2 font-semibold" style={{ color: theme.ink }}>{formatCurrency(rowFaceValue(row))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            </div>
          )}
        </div>
        )}

        <div className="mt-6 pt-5 border-t" style={{ borderColor: theme.border }}>
          <SectionLabel>Delivery Address</SectionLabel>
          <p className="text-xs mb-3" style={{ color: theme.slate }}>eStamp Bulk orders are always physically delivered.</p>

          <label
            className="flex items-center gap-2 mb-4 text-sm font-medium"
            style={{ color: theme.ink, cursor: profileLoading || orgProfile?.registered_address_line1 ? "pointer" : "not-allowed", opacity: !profileLoading && !orgProfile?.registered_address_line1 ? 0.5 : 1 }}
          >
            <input
              type="checkbox"
              checked={sameAsRegistered}
              disabled={!profileLoading && !orgProfile?.registered_address_line1}
              onChange={(e) => {
                setSameAsRegistered(e.target.checked);
                // Switching modes invalidates whichever mode's errors were
                // showing — the fields being validated are different now.
                setFieldErrors((prev) => ({
                  ...prev, registeredAddress: undefined, deliveryFullName: undefined, deliveryMobile: undefined,
                  deliveryAddressLine1: undefined, deliveryCity: undefined, deliveryState: undefined, deliveryPincode: undefined,
                }));
              }}
              className="h-4 w-4"
            />
            Same as registered address
          </label>

          {sameAsRegistered ? (
            profileLoading ? (
              <p className="text-sm" style={{ color: theme.slate }}>Loading registered address...</p>
            ) : (
              <>
                <FieldError>{fieldErrors.registeredAddress}</FieldError>
                <div className="rounded p-4 text-sm space-y-1" style={{ background: theme.bg, border: `1px solid ${theme.border}` }}>
                  <p className="font-semibold" style={{ color: theme.ink }}>{registeredAddress.full_name || "-"}</p>
                  <p style={{ color: theme.slate }}>{registeredAddress.mobile || "-"}</p>
                  <p style={{ color: theme.slate }}>{registeredAddress.address_line1}</p>
                  {registeredAddress.address_line2 && <p style={{ color: theme.slate }}>{registeredAddress.address_line2}</p>}
                  <p style={{ color: theme.slate }}>{[registeredAddress.city, registeredAddress.state, registeredAddress.pincode].filter(Boolean).join(", ")}</p>
                </div>
              </>
            )
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {!profileLoading && !orgProfile?.registered_address_line1 && (
                <p className="text-sm md:col-span-2" style={{ color: theme.slate }}>
                  No registered address is available for this organization.{" "}
                  <span className="font-medium" style={{ color: theme.ink }}>Please enter the delivery address below.</span>
                </p>
              )}
              <Field label="Full Name *" error={fieldErrors.deliveryFullName}>
                <input type="text" value={deliveryAddress.full_name} onChange={(e) => updateDeliveryAddress("full_name", e.target.value)} placeholder="Recipient's full name" className={inputClass} style={inputStyle} />
              </Field>
              <Field label="Mobile *" error={fieldErrors.deliveryMobile}>
                <input type="text" inputMode="numeric" maxLength={10} value={deliveryAddress.mobile} onChange={(e) => updateDeliveryAddress("mobile", e.target.value)} placeholder="9876543210" className={inputClass} style={inputStyle} />
              </Field>
              <Field label="Address Line 1 *" error={fieldErrors.deliveryAddressLine1}>
                <input type="text" value={deliveryAddress.address_line1} onChange={(e) => updateDeliveryAddress("address_line1", e.target.value)} placeholder="House/Flat no., Street" className={inputClass} style={inputStyle} />
              </Field>
              <Field label="Address Line 2">
                <input type="text" value={deliveryAddress.address_line2} onChange={(e) => updateDeliveryAddress("address_line2", e.target.value)} placeholder="Landmark, area (optional)" className={inputClass} style={inputStyle} />
              </Field>
              <Field label="City *" error={fieldErrors.deliveryCity}>
                <input type="text" value={deliveryAddress.city} onChange={(e) => updateDeliveryAddress("city", e.target.value)} placeholder="e.g. Bengaluru" className={inputClass} style={inputStyle} />
              </Field>
              <Field label="State *" error={fieldErrors.deliveryState}>
                <select value={deliveryAddress.state} onChange={(e) => updateDeliveryAddress("state", e.target.value)} className={inputClass} style={inputStyle}>
                  <option value="">Select state</option>
                  {states.map((s) => (<option key={s.id} value={s.state_name}>{s.state_name}</option>))}
                </select>
              </Field>
              <Field label="Pincode *" error={fieldErrors.deliveryPincode}>
                <input type="text" inputMode="numeric" maxLength={6} value={deliveryAddress.pincode} onChange={(e) => updateDeliveryAddress("pincode", e.target.value)} placeholder="560001" className={inputClass} style={inputStyle} />
              </Field>
            </div>
          )}
        </div>

        <div className="mt-6 pt-5 border-t" style={{ borderColor: theme.border }}>
          <SectionLabel>Order Summary</SectionLabel>
          {isEstampState ? (
            <div className="rounded p-4 space-y-2 text-sm" style={{ background: theme.bg, border: `1px solid ${theme.border}` }}>
              <div className="flex justify-between"><span style={{ color: theme.slate }}>Consideration Amount</span><span className="font-semibold" style={{ color: theme.ink }}>{considerationAmount ? formatCurrency(Number(considerationAmount)) : "-"}</span></div>
              <div className="flex justify-between"><span style={{ color: theme.slate }}>Denomination</span><span className="font-semibold" style={{ color: theme.ink }}>To be determined by Admin</span></div>
              <div className="flex justify-between pt-2 border-t" style={{ borderColor: theme.border }}>
                <span style={{ color: theme.slate }}>Total</span>
                <span className="font-semibold" style={{ color: theme.navy }}>To be determined once Admin adds the denomination</span>
              </div>
            </div>
          ) : (
          <div className="rounded p-4 space-y-2 text-sm" style={{ background: theme.bg, border: `1px solid ${theme.border}` }}>
            <div className="flex justify-between"><span style={{ color: theme.slate }}>Total Stamp Papers</span><span className="font-semibold" style={{ color: theme.ink }}>{totalQuantity || "-"}</span></div>
            <div className="flex justify-between"><span style={{ color: theme.slate }}>Total Stamp Face Value</span><span className="font-semibold" style={{ color: theme.ink }}>{formatCurrency(totalFaceValue)}</span></div>
            {visibleCharges.map((c) => (
              <div className="flex justify-between" key={c.charge_name}>
                <span style={{ color: theme.slate }}>{c.charge_name}</span>
                <span className="font-semibold" style={{ color: theme.ink }}>{formatCurrency(c.previewAmount)}</span>
              </div>
            ))}
            {bulkPricingChargeTotal > 0 && (
              <div className="flex justify-between">
                <span style={{ color: theme.slate }}>Service Charge</span>
                <span className="font-semibold" style={{ color: theme.ink }}>{formatCurrency(bulkPricingChargeTotal)}</span>
              </div>
            )}
            {gstAmount > 0 && (
              <div className="flex justify-between">
                <span style={{ color: theme.slate }}>GST on Service Charge ({GST_RATE}%)</span>
                <span className="font-semibold" style={{ color: theme.ink }}>{formatCurrency(gstAmount)}</span>
              </div>
            )}
            <div className="flex justify-between pt-2 border-t" style={{ borderColor: theme.border }}>
              <span style={{ color: theme.slate }}>Total</span>
              <span className="font-semibold" style={{ color: theme.navy }}>{formatCurrency(grandTotal)}</span>
            </div>
          </div>
          )}
        </div>

        <div className="mt-6 pt-5 border-t flex justify-end gap-2" style={{ borderColor: theme.border }}>
          <button onClick={() => navigate("/partner/orders")} className="px-5 py-2.5 rounded text-sm font-semibold" style={{ background: "#fff", color: theme.ink, border: `1px solid ${theme.border}` }}>
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={submitting} className="px-6 py-2.5 rounded text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60" style={{ background: theme.navy }}>
            {submitting ? "Submitting..." : "Submit Request"}
          </button>
        </div>
        </>
        )}
      </div>
    </div>
  );
};

export default PartnerCreateEstampBulk;
