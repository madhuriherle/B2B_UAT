import { Fragment, useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";
import { apiRequest } from "../lib/api";
import { portalBase } from "../lib/roleHome";
import { HANDLED_ORDER_SERVICE_NAMES } from "../lib/orderServices";
import logo from "../assets/logo.png";

// Named so `menus` and `platformAdminMenus` below can share a single copy of
// each icon by reference instead of the old `menus[N].icon` cross-indexing —
// that broke silently the moment `menus` got reordered/regrouped for the
// Partners menu below, since every downstream index shifted with it.
const dashboardIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
  </svg>
);
const docIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
    <path d="M8 13h8" /><path d="M8 17h5" />
  </svg>
);
const personPlusIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" /><line x1="19" y1="8" x2="19" y2="14" /><line x1="22" y1="11" x2="16" y2="11" />
  </svg>
);
const peopleIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);
const walletIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
    <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
    <path d="M18 12a2 2 0 0 0 0 4h4v-4z" />
  </svg>
);
const accountsIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <line x1="6" y1="9" x2="18" y2="9" /><line x1="6" y1="13" x2="14" y2="13" /><line x1="6" y1="17" x2="10" y2="17" />
  </svg>
);
const reportsIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 3v18h18" />
    <rect x="7" y="12" width="3" height="6" /><rect x="12" y="8" width="3" height="10" /><rect x="17" y="5" width="3" height="13" />
  </svg>
);
const vendorIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 3h18v18H3z" /><path d="M3 9h18" /><path d="M9 21V9" />
  </svg>
);
const apiIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
  </svg>
);
const configIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const menus = [
  { name: "Dashboard", path: "/dashboard", icon: dashboardIcon },
  {
    // B2C Orders is the one slice of the B2C admin module Super Admin also
    // gets (see App.jsx sharedAdminRoutes) — everything else in the B2C
    // admin module stays Admin Portal (platform_admin) only.
    name: "Orders",
    icon: docIcon,
    children: [
      { name: "B2B Orders", path: "/reports/orders" },
      // { name: "B2C Orders", path: "/b2c-admin/orders" }, // hidden on UAT per request
    ],
  },
  {
    // Partner Onboard/Partner List/Wallet used to be three flat top-level
    // entries — grouped here so "Partners" reads as one nav concept. Their
    // Price History used to be its own top-level entry (global, every
    // partner mixed together); it now lives inside Partners List → Edit
    // Partner → Services instead, scoped to just that one partner (see
    // EditPartnerModal.jsx).
    name: "Customers",
    icon: peopleIcon,
    children: [
      { name: "Add New", path: "/customer-onboard" },
      { name: "B2B Customers", path: "/customer-list" },
      { name: "Wallet", path: "/wallet" },
      // { name: "B2C Customers", path: "/customers/b2c" }, // hidden on UAT per request
    ],
  },
  { name: "Manage Services", path: "/quotation", icon: docIcon },
  {
    // Vendors (LegalDesk operational teams / third-party fulfillment
    // providers) are distinct from Partners (organizations) above — admin
    // only, no self-service portal.
    name: "Vendor Management",
    icon: vendorIcon,
    children: [
      { name: "Vendor Onboard", path: "/vendor-onboard" },
      { name: "Vendor List", path: "/vendor-list" },
      { name: "Vendor Wallet", path: "/vendor-wallet" },
      { name: "Vendor Orders", path: "/vendor-orders" },
      { name: "Vendor Reports", path: "/vendor-reports" },
    ],
  },
  {
    name: "Accounts",
    icon: accountsIcon,
    children: [
      { name: "Invoices", path: "/accounts/b2b-invoices" },
      { name: "Invoice Settings", path: "/accounts/invoice-settings" },
      { name: "Terms & Condition", path: "/accounts/terms" },
    ],
  },
  {
    name: "Reports",
    icon: reportsIcon,
    children: [
      { name: "SBTR / Challan Reports", path: "/reports/sbtr-challans" },
      { name: "B2C Reports", path: "/b2c-admin/reports" },
    ],
  },
  {
    name: "API Management",
    icon: apiIcon,
    children: [
      { name: "API Clients", path: "/api-clients" },
    ],
  },
  {
    name: "Master Settings",
    icon: configIcon,
    children: [
      { name: "Stamp Config", path: "/stamp-denomination" },
      { name: "Article Code", path: "/article-codes" },
    ],
  },
];

// Admin Portal (platform_admin role) — everything in `menus` above, plus the
// B2C admin modules re-inserted into the same parent groups they used to
// live in before Super Admin was made B2B-only. Super Admin (`menus`) never
// sees these. Kept as flat top-level entries (not grouped under "Partners")
// — unchanged from before the Super Admin menu restructure, just rewired to
// the shared icon constants above instead of now-stale `menus[N]` indices.
const platformAdminMenus = [
  menus[0], // Dashboard
  { name: "Partner Onboard", path: "/customer-onboard", icon: personPlusIcon },
  { name: "Partner List", path: "/customer-list", icon: peopleIcon },
  menus[3], // Manage Services
  { name: "Wallet", path: "/wallet", icon: walletIcon },
  {
    name: "Customers",
    icon: peopleIcon,
    children: [
      { name: "B2B Customers", path: "/customers/b2b" },
      { name: "B2C Customers", path: "/customers/b2c" },
    ],
  },
  {
    name: "Accounts",
    icon: accountsIcon,
    children: [
      { name: "B2B Invoices", path: "/accounts/b2b-invoices" },
      { name: "B2C Invoices", path: "/b2c-admin/invoices" },
      { name: "Invoice Settings", path: "/accounts/invoice-settings" },
      { name: "Terms & Condition", path: "/accounts/terms" },
    ],
  },
  {
    name: "Orders",
    icon: docIcon,
    children: [
      { name: "B2B Orders", path: "/reports/orders" },
      { name: "B2C Orders", path: "/b2c-admin/orders" },
      { name: "User Documents", path: "/b2c-admin/user-docs" },
    ],
  },
  {
    name: "Reports",
    icon: reportsIcon,
    children: [
      { name: "SBTR / Challan Reports", path: "/reports/sbtr-challans" },
      { name: "B2C Reports", path: "/b2c-admin/reports" },
    ],
  },
  menus[5], // Vendor Management
  {
    name: "Master Settings",
    icon: configIcon,
    children: [
      { name: "Stamp Config", path: "/stamp-denomination" },
      { name: "Article Code", path: "/article-codes" },
    ],
  },
  {
    name: "Configuration & Support",
    icon: configIcon,
    children: [
      { name: "Document Templates", path: "/b2c-admin/templates" },
      { name: "States", path: "/b2c-admin/states" },
      { name: "Print & Delivery", path: "/b2c-admin/print-delivery" },
      { name: "Support Requests", path: "/b2c-admin/support" },
    ],
  },
];

const partnerMenus = [
  {
    name: "Dashboard",
    path: "/dashboard",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
      </svg>
    ),
  },
  {
    name: "Manage Services",
    path: "/services",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
        <path d="M8 13h8" />
        <path d="M8 17h5" />
      </svg>
    ),
  },
  // "Orders" used to live here as a static entry, but Manual eStamp/eStamp
  // Bulk/eKYC aren't active for every org — see partnerOrdersMenu built
  // inside the Sidebar component below, gated by /api/partner/services the
  // same way the User Portal's createOrderMenu already gates its own list.
  {
    name: "Users",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" /><line x1="19" y1="8" x2="19" y2="14" /><line x1="22" y1="11" x2="16" y2="11" />
      </svg>
    ),
    children: [
      { name: "Create User", path: "/users/create" },
      { name: "Manage Users", path: "/users" },
    ],
  },
  {
    name: "Wallet",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
        <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
        <path d="M18 12a2 2 0 0 0 0 4h4v-4z" />
      </svg>
    ),
    children: [
      { name: "My Wallet", path: "/wallet" },
      { name: "User Wallets", path: "/wallet/users" },
      { name: "Transactions", path: "/wallet/transactions" },
    ],
  },
  {
    name: "Reports",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
        <path d="M8 13h8" /><path d="M8 17h5" />
      </svg>
    ),
    children: [
      { name: "SBTR / Challan Reports", path: "/reports/sbtr-challans" },
    ],
  },
  {
    name: "Invoices",
    path: "/invoices",
    icon: docIcon,
  },
];

// LegalDesk's own sidebar design language, not a generic admin-template
// blue pill: deep navy for text, blue for interaction (icons, hover),
// a small orange accent (from the logo mark) reserved for the active-item
// indicator only, and a very light blue-grey for surfaces. No gradients,
// no heavy shadows — a left accent bar reads as "selected in this system"
// rather than "a button got clicked".
const NAVY_TEXT = "#0f172a";
const INTERACTION_BLUE = "#1E6091";
const BRAND_ORANGE = "#F5921C";
const SURFACE_TINT = "#EAF2F8";

// Both states always carry the same 3px left border (transparent when
// inactive) so the accent bar appearing/disappearing never shifts the
// icon/label by those 3px — only its color changes.
const activeItemStyle = { background: SURFACE_TINT, color: NAVY_TEXT, fontWeight: 600, borderLeft: `3px solid ${BRAND_ORANGE}` };
const inactiveItemStyle = { color: NAVY_TEXT, borderLeft: "3px solid transparent" };

const createOrderIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

// Partner User (Cyber Shop / Retailer login) — the tier below Partner. Kept
// lean: no user-management or wallet menus (those stay Partner/Super Admin
// only), but Dashboard/Services/Reports mirror scaled-down views of the
// Partner Portal's equivalents, scoped to this login's own org.
const partnerUserMenus = [
  {
    name: "Dashboard",
    path: "/dashboard",
    section: "Main",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
      </svg>
    ),
  },
  {
    name: "My Orders",
    path: "/orders",
    section: "Orders",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
        <path d="M8 13h8" /><path d="M8 17h5" />
      </svg>
    ),
  },
  {
    name: "Services",
    path: "/services",
    section: "Account",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
        <path d="M8 13h8" />
        <path d="M8 17h5" />
      </svg>
    ),
  },
  {
    name: "My Wallet",
    path: "/wallet",
    section: "Account",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
        <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
        <path d="M18 12a2 2 0 0 0 0 4h4v-4z" />
      </svg>
    ),
  },
  {
    name: "Invoices",
    path: "/invoices",
    section: "Account",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
        <path d="M9 13h6" /><path d="M9 17h6" /><path d="M9 9h1" />
      </svg>
    ),
  },
];

const Sidebar = () => {
  const [openMenu, setOpenMenu] = useState(null);
  const location = useLocation();
  const { user, logout } = useAuth();
  const isPartner = user?.role === "partner";
  const isPartnerUser = user?.role === "member";
  const isPlatformAdmin = user?.role === "platform_admin";
  const [orderServiceNames, setOrderServiceNames] = useState(null);

  useEffect(() => {
    if (!isPartnerUser) return;
    apiRequest("/api/partner-user/services")
      .then((data) => {
        const names = (data.services || []).filter((s) => s.assigned).map((s) => s.service_name);
        if ((data.documents || []).some((d) => d.assigned)) names.unshift("Document Service");
        setOrderServiceNames(names);
      })
      .catch(() => setOrderServiceNames([]));
  }, [isPartnerUser]);

  // Same "only show what's actually active" gating the User Portal's
  // createOrderMenu already does below (via /api/partner-user/services) —
  // without this, partnerMenus' static Orders.children list showed Manual
  // eStamp/eStamp Bulk/eKYC even when Super Admin never turned them on for
  // this org, so clicking one dead-ended on "not enabled, contact Super
  // Admin" instead of never appearing at all.
  useEffect(() => {
    if (!isPartner) return;
    apiRequest("/api/partner/services")
      .then((rows) => setOrderServiceNames((rows || []).filter((s) => s.is_active).map((s) => s.service_name)))
      .catch(() => setOrderServiceNames([]));
  }, [isPartner]);

  // Always an expandable submenu, never a plain link straight to the bare
  // /orders/create form (with its "Select Service" dropdown) — that form is
  // only meant to be reached via a specific service child below. Rendering a
  // plain link here while orderServiceNames is still loading (null) let a
  // fast click land on that old dropdown form instead of the submenu.
  const createOrderMenu = {
    name: "Create Order",
    icon: createOrderIcon,
    section: "Orders",
    children: [
      // "eStamp Bulk" and "Manual eStamp" each get their own dedicated
      // create-order screen (denomination rows + delivery address for Bulk;
      // stamp state/amount + optional eSign-after-stamping for Manual)
      // instead of the generic service form, but both are still gated by the
      // Partner's assigned-services list exactly like every other entry
      // here: Super Admin has to add + assign the service before it shows up
      // for the partner user at all.
      //
      // Only names in HANDLED_ORDER_SERVICE_NAMES get a menu item at all —
      // Super Admin can add any service name to the master catalog, but
      // until someone builds real order collection for it, it must not show
      // up as orderable (there's nowhere for it to correctly route to). See
      // lib/orderServices.js.
      ...(orderServiceNames || [])
        .filter((name) => HANDLED_ORDER_SERVICE_NAMES.has(name))
        .map((name) => ({
          name,
          path:
            name === "eStamp Bulk" ? "/orders/create/estamp-bulk"
            : name === "Manual eStamp" ? "/orders/create/manual-estamp"
            : `/orders/create/${encodeURIComponent(name)}`,
          // Plain "eKYC" isn't a user-facing submenu item — only "Bulk eKYC"
          // below is meant to be reached from the sidebar; the single-order
          // /orders/create/eKYC route is still real and still works (Bulk
          // eKYC's "Initiate eKYC" button goes straight there), it's just
          // never a destination you click to from this menu. Kept
          // (not filtered out) so the auto-expand effect below still
          // recognizes that route as belonging to "Create Order" and keeps
          // the parent open; nothing highlights as active for it, since it
          // isn't really "Bulk eKYC" you're looking at.
          hidden: name === "eKYC",
        })),
      // "Bulk eKYC" isn't a real assigned service (no
      // organization_service_pricing row of its own — see lib/orderServices.js)
      // so it can't come from orderServiceNames above; it's a CSV
      // data-entry layer over normal eKYC orders, so it's synthesized here
      // whenever the org actually has "eKYC" itself assigned.
      ...((orderServiceNames || []).includes("eKYC") ? [{ name: "eKYC", path: "/orders/create/eKYC-bulk" }] : []),
    ],
  };

  // Partner Portal's own Orders submenu — mirrors the User Portal's
  // createOrderMenu above (same orderServiceNames gating, same "never a
  // plain link to the bare /orders/create form" rule, populated by the
  // /api/partner/services effect near the top of this component instead of
  // /api/partner-user/services), just laid out as Partner Portal's existing
  // flat "Orders > ... / My Orders / Draft Orders" menu rather than a nested
  // per-service dropdown. There used to be a bare `{ name: "Create Order",
  // path: "/orders/create" }` link here straight to that generic form's
  // "Select Service" dropdown — for orgs with only Manual eStamp/eStamp Bulk
  // assigned (both of which get their own dedicated screens below and are
  // filtered out of that dropdown), the dropdown had nothing to offer,
  // making the whole page look broken. Replaced with the same per-service
  // children the form is actually meant to be reached through.
  const partnerOrdersMenu = {
    name: "Orders",
    icon: docIcon,
    children: [
      ...(orderServiceNames || [])
        .filter((name) => HANDLED_ORDER_SERVICE_NAMES.has(name))
        .map((name) => ({
          name,
          path:
            name === "eStamp Bulk" ? "/orders/create/estamp-bulk"
            : name === "Manual eStamp" ? "/orders/create/manual-estamp"
            : `/orders/create/${encodeURIComponent(name)}`,
          // Same reasoning as createOrderMenu above: plain "eKYC" isn't a
          // user-facing entry, only "Bulk eKYC" below is — kept (not
          // filtered out) so the auto-expand effect still recognizes
          // /orders/create/eKYC as belonging to this menu.
          hidden: name === "eKYC",
        })),
      ...((orderServiceNames || []).includes("eKYC") ? [{ name: "eKYC", path: "/orders/create/eKYC-bulk" }] : []),
      { name: "My Orders", path: "/orders" },
      { name: "Draft Orders", path: "/orders/drafts" },
    ],
  };

  const partnerActiveMenus = [...partnerMenus.slice(0, 2), partnerOrdersMenu, ...partnerMenus.slice(2)];
  const activeMenus = isPartnerUser
    ? [partnerUserMenus[0], createOrderMenu, ...partnerUserMenus.slice(1)]
    : isPartner
    ? partnerActiveMenus
    : isPlatformAdmin
    ? platformAdminMenus
    // Vendor Management hidden on UAT per request. Filtered here rather than
    // commented out of `menus` above so array indices stay put — platformAdminMenus
    // references `menus[5]` positionally (see comment there), and removing an
    // element from `menus` would shift every entry after it.
    : menus.filter((m) => m.name !== "Vendor Management");
  const base = portalBase(user);
  const initial = (user?.full_name || user?.email || "?").trim().charAt(0).toUpperCase();

  // Keeps openMenu in sync with the current route: expands whichever
  // submenu contains it, and — just as importantly — collapses everything
  // else. Without the explicit `else` branch here, a submenu opened by an
  // earlier navigation (or by the user manually clicking it) stayed open
  // forever, even after navigating to an unrelated top-level page like
  // Dashboard, since nothing ever told it to close. A manual click during
  // the current page (no route change) is untouched by this effect, since
  // it only re-runs on navigation.
  //
  // orderServiceNames is in the dependency list deliberately, not just
  // location/base: createOrderMenu only gets its `children` (eKYC/eSign)
  // once that async fetch resolves — on first render it's still the flat,
  // childless fallback, so this effect must re-run when it arrives or the
  // very first match attempt (which finds nothing yet) is the only one that
  // ever runs, and the submenu never actually opens.
  useEffect(() => {
    const match = activeMenus.find((menu) =>
      menu.children?.some((child) => child.path && `${base}${child.path}` === location.pathname)
    );
    setOpenMenu(match ? match.name : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, base, orderServiceNames]);

  return (
    // `sticky top-0 h-screen` pins the sidebar to the viewport as the main
    // content scrolls past it; `overflow-y-auto` gives it its own scrollbar
    // once its content (nav items, especially with submenus open, or at high
    // browser zoom where everything renders larger) is taller than the
    // viewport, instead of the old behavior of silently clipping whatever
    // didn't fit — including the logout button at the bottom. `shrink-0`
    // keeps its width fixed even though the layout shell no longer clips
    // overflow, so it can never get squeezed by its flex sibling.
    <div
      className="w-56 shrink-0 flex flex-col sticky top-0 h-screen overflow-y-auto"
      style={{ background: "linear-gradient(180deg, #DCEAF7 0%, #E4F0FA 55%, #E9F5EE 100%)", borderRight: "1px solid #C7DDF0" }}
    >
      <div className="h-14 flex items-center px-5" style={{ background: "#ffffff", borderBottom: "1px solid #E2EBF4" }}>
        <img src={logo} alt="LegalDesk" className="h-8 w-auto" />
      </div>

      <nav className="flex-1 px-2.5 space-y-0.5 pt-4">
        {(() => {
          // Only menus that opt in with a `section` (currently just the
          // User Portal's Main/Orders/Account grouping) get extra breathing
          // room + a divider between groups — no text label, just spacing,
          // so groups read visually without adding another line of chrome.
          // Every other portal's flat menu list is untouched since none of
          // its items carry that field.
          let lastSection = null;
          return activeMenus.map((menu) => {
            const isNewSection = menu.section && menu.section !== lastSection;
            const needsDivider = isNewSection && lastSection !== null;
            if (menu.section) lastSection = menu.section;

            const sectionSpacer = needsDivider && (
              <div className="my-3 mx-2.5 border-t" style={{ borderColor: "#E2EBF4" }} />
            );

            if (menu.children) {
              const isOpen = openMenu === menu.name;
              return (
                <Fragment key={menu.name}>
                  {sectionSpacer}
                  <div>
                    <button
                      type="button"
                      onClick={() => setOpenMenu(isOpen ? null : menu.name)}
                      className="w-full flex items-center gap-3 pr-3 py-2 pl-[9px] text-sm font-medium transition-colors duration-150 hover:bg-white focus:outline-none active:bg-transparent"
                      style={{ ...inactiveItemStyle, background: "transparent", border: "none", boxShadow: "none", appearance: "none" }}
                    >
                      <span style={{ color: "#5B7285" }}>{menu.icon}</span>
                      <span className="flex-1 text-left">{menu.name}</span>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "#94A3B8", transform: isOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.15s" }}>
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>
                    {isOpen && (
                      <div className="mt-0.5 space-y-0.5 pl-6">
                        {menu.children.filter((child) => !child.hidden).map((child) =>
                          child.path ? (
                            <NavLink
                              key={child.name}
                              to={`${base}${child.path}`}
                              className="block pr-3 py-1.5 pl-[9px] text-[13px] font-medium transition-colors duration-150 hover:bg-white"
                              style={({ isActive }) => (isActive ? activeItemStyle : { color: "#4B5F72", borderLeft: "3px solid transparent" })}
                            >
                              {child.name}
                            </NavLink>
                          ) : (
                            <span
                              key={child.name}
                              className="block pr-3 py-1.5 pl-[9px] text-[13px] font-medium cursor-not-allowed"
                              style={{ color: "#94A3B8", borderLeft: "3px solid transparent" }}
                              title="Coming soon"
                            >
                              {child.name}
                            </span>
                          )
                        )}
                      </div>
                    )}
                  </div>
                </Fragment>
              );
            }

            // Plain items default to NavLink's own prefix-matched `isActive`,
            // but a sibling menu's children can live under a path that's a
            // prefix of this item's own path too (e.g. "My Orders" is
            // `/orders`, and "Create Order" > "eSign" is `/orders/create/eSign`
            // — both start with `/orders`). When that happens the sibling's
            // child claims the route, so this item must not also light up.
            const claimedBySibling = activeMenus.some((m) =>
              m.children?.some((child) => child.path && location.pathname === `${base}${child.path}`)
            );

            return (
              <Fragment key={menu.path}>
                {sectionSpacer}
                <NavLink
                  to={`${base}${menu.path}`}
                  className="flex items-center gap-3 pr-3 py-2 pl-[9px] text-sm font-medium transition-colors duration-150 hover:bg-white"
                  style={({ isActive }) => (isActive && !claimedBySibling ? activeItemStyle : inactiveItemStyle)}
                >
                  {({ isActive }) => (
                    <>
                      <span style={{ color: isActive && !claimedBySibling ? INTERACTION_BLUE : "#5B7285" }}>{menu.icon}</span>
                      {menu.name}
                    </>
                  )}
                </NavLink>
              </Fragment>
            );
          });
        })()}
      </nav>

      <div className="p-3 mx-2.5 mb-3 rounded-xl border" style={{ background: "#ffffff", borderColor: "#E2EBF4" }}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0" style={{ background: INTERACTION_BLUE }}>{initial}</div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold leading-none truncate" style={{ color: "#0f172a" }}>{user?.full_name || user?.email || "..."}</p>
            <p className="text-xs mt-0.5 truncate capitalize" style={{ color: "#5B7285" }}>{user?.role || ""}</p>
          </div>
        </div>
        <button
          onClick={logout}
          className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
          style={{ color: "#176B87", border: "1px solid #E8F3FB", background: "#F3F8FB" }}
          onMouseEnter={e => { e.currentTarget.style.background = "#176B87"; e.currentTarget.style.color = "#fff"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "#F3F8FB"; e.currentTarget.style.color = "#176B87"; }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          Logout
        </button>
      </div>
    </div>
  );
};

export default Sidebar;

