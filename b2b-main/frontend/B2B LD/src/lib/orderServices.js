// Service names the Create Order flow actually has a real form for — either
// a dedicated screen (eStamp Bulk, Manual eStamp) or dedicated field
// handling inside PartnerUserCreateOrder.jsx (eSign, eKYC, eStamp, Document
// Service). Anything else is a service Super Admin has added to the master
// catalog (see backend/app/routes/services.py) but nobody has built order
// collection for yet — those must never fall through to a generic/incomplete
// form, since that form can't actually collect what that service needs.
export const HANDLED_ORDER_SERVICE_NAMES = new Set([
  "eSign",
  "eKYC",
  "eStamp",
  // Karnataka-only on-the-fly variant of eStamp — a distinct SignDesk
  // endpoint/credential set and a closed 127-article-code list (see
  // backend/app/karnataka_article_codes.py). Handled inside the same
  // generic PartnerCreateOrder.jsx/PartnerUserCreateOrder.jsx form as
  // plain eStamp, not a dedicated page like eStamp Bulk/Manual eStamp.
  "eStamp On The Fly",
  "eStamp Bulk",
  "Document Service",
  "Manual eStamp",
  // Not a real assigned service name from organization_service_pricing —
  // synthesized in Sidebar.jsx whenever "eKYC" itself is assigned, since
  // Bulk eKYC is a CSV data-entry layer over normal eKYC orders, never a
  // separately priced service of its own. Listed here for documentation
  // consistency with the rest of this file's intent.
  "Bulk eKYC",
]);
