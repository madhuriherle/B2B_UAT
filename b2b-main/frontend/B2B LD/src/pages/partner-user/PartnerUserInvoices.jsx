import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiRequest, downloadFile } from "../../lib/api";
import { formatCurrency } from "../../lib/format";
import { theme, serif, card } from "../../lib/userPortalTheme";
import InvoiceViewModal from "../../components/InvoiceViewModal";

const formatDate = (value) =>
  value ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "-";

const TYPE_STYLES = {
  Reimbursement: { background: "#E0F2FE", color: "#075985" },
  Invoice: { background: theme.successSoft, color: theme.success },
};

const STATUS_STYLES = {
  Generated: { background: theme.successSoft, color: theme.success },
  Pending: { background: theme.goldSoft, color: theme.navy },
};

const inputStyle = { background: theme.bg, border: `1px solid ${theme.border}`, color: "#1e293b" };
const inputClass = "w-full px-3 py-2.5 text-sm rounded outline-none";

const orderDetailPath = (invoice) => {
  if (invoice.service_name === "eStamp Bulk") return `/user/orders/estamp-bulk/${invoice.order_id}`;
  if (invoice.service_name === "Manual eStamp") return `/user/orders/manual-estamp/${invoice.order_id}`;
  return `/user/orders/${invoice.order_id}`;
};

const typeBadge = (type) => (
  <span
    className="inline-flex items-center px-2.5 py-1 rounded text-xs font-semibold"
    style={TYPE_STYLES[type] || { background: theme.bg, color: theme.slate }}
  >
    {type === "Reimbursement" ? "Reimbursement" : "Service Invoice"}
  </span>
);

const statusBadge = (status) => (
  <span
    className="inline-flex items-center px-2.5 py-1 rounded text-xs font-semibold"
    style={STATUS_STYLES[status] || { background: theme.bg, color: theme.slate }}
  >
    {status}
  </span>
);

const PartnerUserInvoices = () => {
  const [invoices, setInvoices] = useState(null);
  const [error, setError] = useState("");
  const [downloadError, setDownloadError] = useState("");
  const [viewingInvoiceId, setViewingInvoiceId] = useState(null);

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  useEffect(() => {
    apiRequest("/api/partner-user/invoices")
      .then(setInvoices)
      .catch((err) => setError(err.message));
  }, []);

  const handleDownload = async (invoice) => {
    setDownloadError("");
    try {
      await downloadFile(`/api/partner-user/invoices/${invoice.id}/pdf`, `${invoice.invoice_number.replace(/\//g, "-")}.pdf`);
    } catch (err) {
      setDownloadError(err.message);
    }
  };

  const filtered = (invoices || []).filter((inv) => {
    const query = search.trim().toLowerCase();
    if (query && ![inv.invoice_number, inv.order_no, inv.service_name].some((f) => f?.toLowerCase().includes(query))) {
      return false;
    }
    if (typeFilter && inv.invoice_type !== typeFilter) return false;
    if (statusFilter && inv.status !== statusFilter) return false;
    if (dateFrom && (!inv.invoice_date || inv.invoice_date < dateFrom)) return false;
    if (dateTo && (!inv.invoice_date || inv.invoice_date > dateTo)) return false;
    return true;
  });

  const clearFilters = () => {
    setSearch("");
    setTypeFilter("");
    setStatusFilter("");
    setDateFrom("");
    setDateTo("");
  };
  const hasFilters = search || typeFilter || statusFilter || dateFrom || dateTo;

  return (
    <div>
      <div className="mb-6 pb-4 border-b" style={{ borderColor: theme.border }}>
        <h1 className="text-2xl font-bold" style={{ color: theme.ink, fontFamily: serif }}>Invoices</h1>
        <p className="text-sm mt-1" style={{ color: theme.slate }}>
          Reimbursement invoices from eStamp wallet funding, and service invoices for delivery, service charges, eSign and eKYC
        </p>
      </div>

      {downloadError && <p className="text-sm mb-4" style={{ color: theme.danger }}>{downloadError}</p>}

      {invoices && invoices.length > 0 && (
        <div className="rounded-lg p-4 mb-5" style={card}>
          <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
            <div className="md:col-span-2">
              <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: theme.slate }}>Search</label>
              <input type="text" placeholder="Invoice #, order #, service..." value={search} onChange={(e) => setSearch(e.target.value)} className={inputClass} style={inputStyle} />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: theme.slate }}>Type</label>
              <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className={inputClass} style={inputStyle}>
                <option value="">All Types</option>
                <option value="Invoice">Service Invoice</option>
                <option value="Reimbursement">Reimbursement</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: theme.slate }}>Status</label>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={inputClass} style={inputStyle}>
                <option value="">All Statuses</option>
                <option value="Generated">Generated</option>
                <option value="Pending">Pending</option>
              </select>
            </div>
            <div className="min-w-0">
              <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: theme.slate }}>From</label>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={`${inputClass} min-w-0`} style={inputStyle} />
            </div>
            <div className="min-w-0">
              <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: theme.slate }}>To</label>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={`${inputClass} min-w-0`} style={inputStyle} />
            </div>
          </div>
          {hasFilters && (
            <button onClick={clearFilters} className="mt-3 text-xs font-semibold" style={{ color: theme.navy }}>Clear filters</button>
          )}
        </div>
      )}

      <section className="rounded-lg overflow-hidden" style={card}>
        {error ? (
          <p className="text-sm p-6" style={{ color: theme.danger }}>{error}</p>
        ) : !invoices ? (
          <p className="text-sm p-6" style={{ color: theme.slate }}>Loading...</p>
        ) : !invoices.length ? (
          <p className="text-sm p-6" style={{ color: theme.slate }}>No invoices yet.</p>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ background: theme.bg }}>
                {["Invoice #", "Type", "Order", "Date", "Amount", "Status", ""].map((h) => (
                  <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold uppercase" style={{ color: theme.slate }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((inv) => {
                const isPending = inv.status === "Pending";
                return (
                  <tr key={inv.id || `pending-${inv.order_id || inv.transaction_id}`} className="border-t" style={{ borderColor: theme.border }}>
                    <td className="px-4 py-2.5 text-sm font-medium" style={{ color: isPending ? theme.slate : theme.ink }}>
                      {inv.invoice_number || "—"}
                    </td>
                    <td className="px-4 py-2.5">{typeBadge(inv.invoice_type)}</td>
                    <td className="px-4 py-2.5 text-sm" style={{ color: theme.ink }}>
                      {inv.order_id ? (
                        <Link to={orderDetailPath(inv)} style={{ color: theme.navy }}>
                          {inv.order_no || "View order"}
                        </Link>
                      ) : (
                        <span style={{ color: theme.slate }}>eStamp Wallet Funding</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-sm whitespace-nowrap" style={{ color: theme.slate }}>
                      {isPending ? "—" : formatDate(inv.invoice_date)}
                    </td>
                    <td className="px-4 py-2.5 text-sm font-semibold" style={{ color: theme.ink }}>
                      {isPending ? "—" : formatCurrency(inv.total)}
                    </td>
                    <td className="px-4 py-2.5">{statusBadge(inv.status)}</td>
                    <td className="px-4 py-2.5 text-right">
                      {!isPending && (
                        <div className="flex justify-end gap-1.5">
                          <button
                            onClick={() => setViewingInvoiceId(inv.id)}
                            className="px-3 py-1.5 rounded text-xs font-semibold"
                            style={{ background: theme.bg, color: theme.navy, border: `1px solid ${theme.border}` }}
                          >
                            View
                          </button>
                          <button
                            onClick={() => handleDownload(inv)}
                            className="px-3 py-1.5 rounded text-xs font-semibold"
                            style={{ background: theme.navy, color: "#fff" }}
                          >
                            Download
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan="7" className="text-center py-10">
                    <p className="text-sm" style={{ color: theme.slate }}>No invoices match these filters</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        )}
      </section>

      {viewingInvoiceId && (
        <InvoiceViewModal
          fetchUrl={`/api/partner-user/invoices/${viewingInvoiceId}`}
          downloadUrl={`/api/partner-user/invoices/${viewingInvoiceId}/pdf`}
          onClose={() => setViewingInvoiceId(null)}
        />
      )}
    </div>
  );
};

export default PartnerUserInvoices;
