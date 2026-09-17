import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import ProtectedRoute from "./components/ProtectedRoute";
import ErrorBoundary from "./components/ErrorBoundary";
import { AuthProvider, useAuth } from "./lib/AuthContext";
import { homeFor } from "./lib/roleHome";

import Dashboard from "./pages/Dashboard";
import CustomerOnboard from "./pages/CustomerOnboard";
import CustomerList from "./pages/CustomerList";
import ManageUsers from "./pages/ManageUsers";
import PartnerWallet from "./pages/PartnerWallet";
import PartnerProfile from "./pages/PartnerProfile";
import WalletOverview from "./pages/WalletOverview";
import VendorOnboard from "./pages/VendorOnboard";
import VendorList from "./pages/VendorList";
import VendorProfile from "./pages/VendorProfile";
import VendorWallet from "./pages/VendorWallet";
import VendorWalletOverview from "./pages/VendorWalletOverview";
import VendorOrders from "./pages/VendorOrders";
import VendorReports from "./pages/VendorReports";
import Quotation from "./pages/Quotation";
import StampDenomination from "./pages/StampDenomination";
import ArticleCodeMaster from "./pages/ArticleCodeMaster";
import OrderReports from "./pages/OrderReports";
import OrderDetail from "./pages/OrderDetail";
import SbtrChallanReports from "./pages/SbtrChallanReports";
import QuoteAccess from "./pages/QuoteAccess";
import SetPassword from "./pages/SetPassword";
import EsignComplete from "./pages/EsignComplete";
import Login from "./pages/Login";
import PartnerDashboard from "./pages/partner/PartnerDashboard";
import PartnerManageServices from "./pages/partner/PartnerManageServices";
import PartnerCreateUser from "./pages/partner/PartnerCreateUser";
import PartnerManageUsers from "./pages/partner/PartnerManageUsers";
import PartnerUserDetails from "./pages/partner/PartnerUserDetails";
import PartnerMyWallet from "./pages/partner/PartnerMyWallet";
import PartnerUserWallets from "./pages/partner/PartnerUserWallets";
import PartnerTransactions from "./pages/partner/PartnerTransactions";
import PartnerSbtrChallanReports from "./pages/partner/PartnerSbtrChallanReports";
import PartnerInvoices from "./pages/partner/PartnerInvoices";
import PartnerRetailers from "./pages/partner/PartnerRetailers";
import PartnerCreateRetailer from "./pages/partner/PartnerCreateRetailer";
import PartnerCreateOrder from "./pages/partner/orders/PartnerCreateOrder";
import PartnerEkycBulk from "./pages/partner/orders/PartnerEkycBulk";
import PartnerCreateManualEstamp from "./pages/partner/orders/PartnerCreateManualEstamp";
import PartnerManualEstampOrderDetails from "./pages/partner/orders/PartnerManualEstampOrderDetails";
import PartnerCreateEstampBulk from "./pages/partner/orders/PartnerCreateEstampBulk";
import PartnerEstampBulkOrderDetails from "./pages/partner/orders/PartnerEstampBulkOrderDetails";
import PartnerDraftOrders from "./pages/partner/orders/PartnerDraftOrders";
import PartnerMyOrders from "./pages/partner/orders/PartnerMyOrders";
import PartnerOrderDetails from "./pages/partner/orders/PartnerOrderDetails";
import PartnerUserCreateOrder from "./pages/partner-user/PartnerUserCreateOrder";
import PartnerUserOrders from "./pages/partner-user/PartnerUserOrders";
import PartnerUserOrderDetails from "./pages/partner-user/PartnerUserOrderDetails";
import PartnerUserDashboard from "./pages/partner-user/PartnerUserDashboard";
import PartnerUserServices from "./pages/partner-user/PartnerUserServices";
import PartnerUserReports from "./pages/partner-user/PartnerUserReports";
import PartnerUserWallet from "./pages/partner-user/PartnerUserWallet";
import PartnerUserInvoices from "./pages/partner-user/PartnerUserInvoices";

import CustomersB2B from "./pages/CustomersB2B";
import CustomersB2C from "./pages/CustomersB2C";
import CustomerProfile from "./pages/CustomerProfile";
import AccountsB2BInvoices from "./pages/AccountsB2BInvoices";
import AccountsB2BInvoiceForm from "./pages/AccountsB2BInvoiceForm";
import AccountsInvoiceSettings from "./pages/AccountsInvoiceSettings";
import AccountsInvoiceTerms from "./pages/AccountsInvoiceTerms";
import ApiClients from "./pages/ApiClients";
import PartnerUserCreateManualEstamp from "./pages/partner-user/PartnerUserCreateManualEstamp";
import PartnerUserManualEstampOrderDetails from "./pages/partner-user/PartnerUserManualEstampOrderDetails";
import PartnerUserCreateEstampBulk from "./pages/partner-user/PartnerUserCreateEstampBulk";
import PartnerUserEkycBulk from "./pages/partner-user/PartnerUserEkycBulk";
import PartnerUserEstampBulkOrderDetails from "./pages/partner-user/PartnerUserEstampBulkOrderDetails";

// Admin Portal (platform_admin role only) — see src/pages/b2c-admin/.
// AdminDashboard.jsx is not routed on its own; it's rendered as a section
// inside pages/Dashboard.jsx, gated to platform_admin there.
import B2CAdminOrders from "./pages/b2c-admin/AdminOrdersTab";
import B2CAdminOrderDetail from "./pages/b2c-admin/AdminOrderDetail";
import B2CAdminReports from "./pages/b2c-admin/AdminReportsTab";
import B2CAdminUserDocs from "./pages/b2c-admin/AdminUserDocsTab";
import B2CAdminInvoices from "./pages/b2c-admin/AdminInvoicesTab";
import B2CAdminTemplates from "./pages/b2c-admin/AdminDocTemplatesTab";
import B2CAdminStates from "./pages/b2c-admin/AdminStatesTab";
import B2CAdminPrintDelivery from "./pages/b2c-admin/AdminPrintDeliveryTab";
import B2CAdminSupport from "./pages/b2c-admin/AdminSupportTab";

const RootRedirect = () => {
  const { user, isAuthenticated, loading } = useAuth();
  if (loading) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Navigate to={homeFor(user)} replace />;
};

// Keeps a logged-in user from landing on another portal's pages if they type
// a URL outside their own base path. The API layer enforces the real
// security boundary; this is just so the UI doesn't show a broken page.
const RequireRole = ({ role, children }) => {
  const { user } = useAuth();
  const allowedRoles = Array.isArray(role) ? role : [role];
  if (user && !allowedRoles.includes(user.role)) {
    return <Navigate to={homeFor(user)} replace />;
  }
  return children;
};

const PortalLayout = ({ role }) => (
  <ProtectedRoute>
    <RequireRole role={role}>
      <Layout />
    </RequireRole>
  </ProtectedRoute>
);

// Routes shared by both B2B admin portals — Admin Portal (platform_admin,
// mounted at /admin) and Super Admin Portal (admin, mounted at /superadmin).
// Defined once and mounted under each base path below so the two portals
// can't drift apart by accident.
const sharedAdminRoutes = [
  { path: "dashboard", element: <Dashboard /> },
  { path: "customer-onboard", element: <CustomerOnboard /> },
  { path: "customer-list", element: <CustomerList /> },
  { path: "partners/:organizationId/users", element: <ManageUsers /> },
  { path: "partners/:organizationId/wallet", element: <PartnerWallet /> },
  { path: "partners/:organizationId/profile", element: <PartnerProfile /> },
  { path: "wallet", element: <WalletOverview /> },
  { path: "vendor-onboard", element: <VendorOnboard /> },
  { path: "vendor-list", element: <VendorList /> },
  { path: "vendors/:vendorId/profile", element: <VendorProfile /> },
  { path: "vendors/:vendorId/wallet", element: <VendorWallet /> },
  { path: "vendor-wallet", element: <VendorWalletOverview /> },
  { path: "vendor-orders", element: <VendorOrders /> },
  { path: "vendor-reports", element: <VendorReports /> },
  { path: "quotation", element: <Quotation /> },
  { path: "stamp-denomination", element: <StampDenomination /> },
  { path: "article-codes", element: <ArticleCodeMaster /> },
  { path: "reports/orders", element: <OrderReports /> },
  { path: "reports/orders/:orderId", element: <OrderDetail /> },
  { path: "reports/sbtr-challans", element: <SbtrChallanReports /> },
  { path: "customers/b2b", element: <CustomersB2B /> },
  { path: "accounts/b2b-invoices", element: <AccountsB2BInvoices /> },
  { path: "accounts/b2b-invoices/new", element: <AccountsB2BInvoiceForm /> },
  { path: "accounts/b2b-invoices/:invoiceId", element: <AccountsB2BInvoiceForm /> },
  { path: "accounts/invoice-settings", element: <AccountsInvoiceSettings /> },
  { path: "accounts/terms", element: <AccountsInvoiceTerms /> },
  { path: "api-clients", element: <ApiClients /> },
  // B2C Orders/Reports/Customers — the slice of the B2C admin module Super
  // Admin also gets (backend: admin_orders.py/admin_reports.py/customers.py
  // depend on get_current_admin, not the platform_admin-only
  // get_current_b2c_admin).
  { path: "b2c-admin/orders", element: <B2CAdminOrders /> },
  { path: "b2c-admin/orders/:userDocId", element: <B2CAdminOrderDetail /> },
  { path: "b2c-admin/reports", element: <B2CAdminReports /> },
  { path: "customers/b2c", element: <CustomersB2C /> },
  { path: "customers/b2c/:userId/profile", element: <CustomerProfile /> },
];

// Admin Portal only — B2C admin module, platform_admin exclusive.
const platformAdminOnlyRoutes = [
  { path: "b2c-admin/user-docs", element: <B2CAdminUserDocs /> },
  { path: "b2c-admin/invoices", element: <B2CAdminInvoices /> },
  { path: "b2c-admin/templates", element: <B2CAdminTemplates /> },
  { path: "b2c-admin/states", element: <B2CAdminStates /> },
  { path: "b2c-admin/print-delivery", element: <B2CAdminPrintDelivery /> },
  { path: "b2c-admin/support", element: <B2CAdminSupport /> },
];

function App() {
  return (
    <ErrorBoundary>
    <AuthProvider>
      <Routes>
          <Route path="/quote/:quoteId" element={<QuoteAccess />} />
          <Route path="/set-password/:token" element={<SetPassword />} />
          <Route path="/esign/complete" element={<EsignComplete />} />
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<RootRedirect />} />

          {/* Admin Portal — platform_admin (B2B + B2C) */}
          <Route path="/admin" element={<PortalLayout role="platform_admin" />}>
            <Route index element={<Navigate to="dashboard" replace />} />
            {sharedAdminRoutes.map((r) => (
              <Route key={r.path} path={r.path} element={r.element} />
            ))}
            {platformAdminOnlyRoutes.map((r) => (
              <Route key={r.path} path={r.path} element={r.element} />
            ))}
          </Route>

          {/* Super Admin Portal — admin (B2B-only) */}
          <Route path="/superadmin" element={<PortalLayout role="admin" />}>
            <Route index element={<Navigate to="dashboard" replace />} />
            {sharedAdminRoutes.map((r) => (
              <Route key={r.path} path={r.path} element={r.element} />
            ))}
          </Route>

          {/* Partner Portal */}
          <Route path="/partner" element={<PortalLayout role="partner" />}>
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<PartnerDashboard />} />
            <Route path="services" element={<PartnerManageServices />} />
            <Route path="users" element={<PartnerManageUsers />} />
            <Route path="users/create" element={<PartnerCreateUser />} />
            <Route path="users/:membershipId" element={<PartnerUserDetails />} />
            <Route path="wallet" element={<PartnerMyWallet />} />
            <Route path="wallet/users" element={<PartnerUserWallets />} />
            <Route path="wallet/transactions" element={<PartnerTransactions />} />
            <Route path="reports/sbtr-challans" element={<PartnerSbtrChallanReports />} />
            <Route path="invoices" element={<PartnerInvoices />} />
            <Route path="retailers" element={<PartnerRetailers />} />
            <Route path="retailers/create" element={<PartnerCreateRetailer />} />
            <Route path="orders/create" element={<PartnerCreateOrder />} />
            <Route path="orders/create/manual-estamp" element={<PartnerCreateManualEstamp />} />
            <Route path="orders/create/eKYC-bulk" element={<PartnerEkycBulk />} />
            <Route path="orders/create/estamp-bulk" element={<PartnerCreateEstampBulk />} />
            <Route path="orders/create/:service" element={<PartnerCreateOrder />} />
            <Route path="orders/drafts" element={<PartnerDraftOrders />} />
            <Route path="orders" element={<PartnerMyOrders />} />
            <Route path="orders/manual-estamp/:orderId" element={<PartnerManualEstampOrderDetails />} />
            <Route path="orders/estamp-bulk/:orderId" element={<PartnerEstampBulkOrderDetails />} />
            <Route path="orders/:orderId" element={<PartnerOrderDetails />} />
          </Route>

          {/* User Portal — member (Partner User / Cyber Shop) */}
          <Route path="/user" element={<PortalLayout role="member" />}>
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<PartnerUserDashboard />} />
            <Route path="orders/create" element={<PartnerUserCreateOrder />} />
            <Route path="orders/create/manual-estamp" element={<PartnerUserCreateManualEstamp />} />
            <Route path="orders/create/estamp-bulk" element={<PartnerUserCreateEstampBulk />} />
            <Route path="orders/create/eKYC-bulk" element={<PartnerUserEkycBulk />} />
            <Route path="orders/create/:service" element={<PartnerUserCreateOrder />} />
            <Route path="orders" element={<PartnerUserOrders />} />
            <Route path="orders/manual-estamp/:orderId" element={<PartnerUserManualEstampOrderDetails />} />
            <Route path="orders/estamp-bulk/:orderId" element={<PartnerUserEstampBulkOrderDetails />} />
            <Route path="orders/:orderId" element={<PartnerUserOrderDetails />} />
            <Route path="services" element={<PartnerUserServices />} />
            <Route path="wallet" element={<PartnerUserWallet />} />
            <Route path="invoices" element={<PartnerUserInvoices />} />
            <Route path="reports/sbtr-challans" element={<PartnerUserReports />} />
          </Route>

          <Route path="*" element={<RootRedirect />} />
      </Routes>
    </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;
