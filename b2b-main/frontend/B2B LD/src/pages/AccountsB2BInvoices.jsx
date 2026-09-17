import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest, downloadFile } from "../lib/api";
import { formatCurrency } from "../lib/format";
import { useAuth } from "../lib/AuthContext";
import { portalBase } from "../lib/roleHome";
import InvoiceViewModal from "../components/InvoiceViewModal";
import { useConfirm } from "../components/ConfirmProvider";


const formatDate = (value) =>
  value ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "-";

const INVOICE_TYPES = ["Invoice", "Reimbursement"];

const AccountsB2BInvoices = () => {
  const { confirm, alert } = useConfirm();
  const navigate = useNavigate();
  const { user } = useAuth();
  const base = portalBase(user);
  const [invoices, setInvoices] = useState([]);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [toast, setToast] = useState(null);
  const [invoiceModal, setInvoiceModal] = useState(null); // { id, editable }

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4500);
  };

  const loadInvoices = () => {
    apiRequest("/api/accounts/invoices").then(setInvoices).catch(() => setInvoices([]));
  };

  useEffect(() => { loadInvoices(); }, []);

  const filtered = invoices.filter((inv) => {
    const query = search.trim().toLowerCase();
    if (query && ![inv.invoice_number, inv.company_name, inv.invoice_type, inv.order_no].some((f) => f?.toLowerCase().includes(query))) {
      return false;
    }
    if (typeFilter && inv.invoice_type !== typeFilter) return false;
    if (dateFrom && (!inv.invoice_date || inv.invoice_date < dateFrom)) return false;
    if (dateTo && (!inv.invoice_date || inv.invoice_date > dateTo)) return false;
    return true;
  });

  const handleDelete = async (invoice) => {
    if (!await confirm(`Delete invoice "${invoice.invoice_number}"?`)) return;
    try {
      await apiRequest(`/api/accounts/invoices/${invoice.id}`, { method: "DELETE" });
      loadInvoices();
      showToast("Invoice deleted");
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const clearFilters = () => {
    setSearch("");
    setTypeFilter("");
    setDateFrom("");
    setDateTo("");
  };

  return (
    <div>
      {toast && (
        <div className="fixed top-5 right-5 z-50 px-5 py-3 rounded-xl text-sm font-semibold shadow-lg text-white transition-all max-w-xl" style={{ background: toast.type === "error" ? "#176B87" : "#16A34A" }}>
          {toast.msg}
        </div>
      )}

      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "#0f172a" }}>Invoices</h1>
          <p className="text-sm mt-1" style={{ color: "#5B7285" }}>Manual invoice creation for B2B customers</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => navigate(`${base}/accounts/b2b-invoices/new`)} className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>
            + Create Invoice
          </button>
        </div>
      </div>

      <div className="rounded-2xl p-4 mb-5" style={{ background: "#fff", border: "1px solid #D8E6F0" }}>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
          <div className="md:col-span-2">
            <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#5B7285" }}>Search</label>
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5B7285" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input type="text" placeholder="Invoice #, order #, customer..." value={search} onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2.5 text-sm rounded-xl outline-none" style={{ background: "#F3F8FB", border: "1px solid #D8E6F0", color: "#1e293b" }} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#5B7285" }}>Type</label>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="w-full px-3 py-2.5 text-sm rounded-xl outline-none" style={{ background: "#F3F8FB", border: "1px solid #D8E6F0", color: "#1e293b" }}>
              <option value="">All Types</option>
              {INVOICE_TYPES.map((t) => (<option key={t} value={t}>{t}</option>))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#5B7285" }}>From</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-full px-3 py-2.5 text-sm rounded-xl outline-none" style={{ background: "#F3F8FB", border: "1px solid #D8E6F0", color: "#1e293b" }} />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#5B7285" }}>To</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-full px-3 py-2.5 text-sm rounded-xl outline-none" style={{ background: "#F3F8FB", border: "1px solid #D8E6F0", color: "#1e293b" }} />
          </div>
        </div>
        {(search || typeFilter || dateFrom || dateTo) && (
          <button onClick={clearFilters} className="mt-3 text-xs font-semibold" style={{ color: "#1E6091" }}>Clear filters</button>
        )}
      </div>

      <div className="rounded-2xl overflow-hidden" style={{ background: "#fff", border: "1px solid #D8E6F0", boxShadow: "0 8px 24px rgba(30,96,145,0.1)" }}>
        <div className="h-1.5" style={{ background: "linear-gradient(90deg, #1E6091, #176B87, #16A34A)" }}></div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ background: "linear-gradient(180deg, #EAF3FA, #F3F8FB)", borderBottom: "1px solid #D8E6F0" }}>
                {["Invoice #", "Customer", "Type", "Invoice Date", "Subtotal", "Tax", "Total", "Actions"].map((h) => (
                  <th key={h} className="text-left px-5 py-3.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: "#1E6091" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((inv, i) => {
                const tax = Number(inv.cgst_amount) + Number(inv.sgst_amount) + Number(inv.igst_amount);
                return (
                  <tr key={inv.id} className="border-t transition-colors hover:bg-[#E8F3FB]/60" style={{ borderColor: "#E2EBF4", background: i % 2 === 1 ? "#F8FBFD" : "#fff" }}>
                    <td className="px-5 py-4"><p className="text-sm font-semibold" style={{ color: "#1e293b" }}>{inv.invoice_number}</p></td>
                    <td className="px-5 py-4 text-sm" style={{ color: "#1e293b" }}>{inv.company_name}</td>
                    <td className="px-5 py-4 text-sm" style={{ color: "#1e293b" }}>{inv.invoice_type}</td>
                    <td className="px-5 py-4 text-sm whitespace-nowrap" style={{ color: "#5B7285" }}>{formatDate(inv.invoice_date)}</td>
                    <td className="px-5 py-4 text-sm" style={{ color: "#1e293b" }}>{formatCurrency(inv.subtotal)}</td>
                    <td className="px-5 py-4 text-sm" style={{ color: "#1e293b" }}>{formatCurrency(tax)}</td>
                    <td className="px-5 py-4 text-sm font-semibold" style={{ color: "#1e293b" }}>{formatCurrency(inv.total)}</td>
                    <td className="px-5 py-4">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button onClick={() => setInvoiceModal({ id: inv.id, editable: false })} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: "#E8F3FB", color: "#1E6091" }}>View</button>
                        <button onClick={() => setInvoiceModal({ id: inv.id, editable: true })} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: "#F3E8FB", color: "#7E22CE" }}>Edit</button>
                        <button
                          onClick={() => downloadFile(`/api/accounts/invoices/${inv.id}/pdf`, `${inv.invoice_number.replace(/\//g, "-")}.pdf`)}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                          style={{ background: "#E6F5EA", color: "#3D7A1F" }}
                        >
                          Download
                        </button>
                        <button onClick={() => handleDelete(inv)} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: "#FCE8E8", color: "#B91C1C" }}>Delete</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan="8" className="text-center py-16">
                    <p className="font-semibold" style={{ color: "#5B7285" }}>No invoices found</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex justify-between items-center px-5 py-4 border-t" style={{ borderColor: "#E2EBF4" }}>
          <p className="text-sm" style={{ color: "#5B7285" }}>Showing <span className="font-semibold" style={{ color: "#1e293b" }}>{filtered.length}</span> of {invoices.length} invoices</p>
        </div>
      </div>

      {invoiceModal && (
        <InvoiceViewModal
          fetchUrl={`/api/accounts/invoices/${invoiceModal.id}`}
          downloadUrl={`/api/accounts/invoices/${invoiceModal.id}/pdf`}
          editable={invoiceModal.editable}
          onClose={() => setInvoiceModal(null)}
          onSaved={() => {
            loadInvoices();
            showToast("Invoice updated");
          }}
        />
      )}
    </div>
  );
};

export default AccountsB2BInvoices;
