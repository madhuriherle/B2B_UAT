import { useEffect, useState } from "react";
import { apiRequest, downloadFile } from "../../lib/api";
import { formatCurrency } from "../../lib/format";

const inputClass = "px-3 py-2 text-sm rounded-xl outline-none";
const inputStyle = { background: "#F3F8FB", border: "1px solid #D8E6F0", color: "#1e293b" };

const formatDate = (value) =>
  value ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "-";

const AdminInvoicesTab = () => {
  const [invoices, setInvoices] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const loadInvoices = (overrides = {}) => {
    setLoading(true);
    const searchValue = overrides.search ?? search;
    const params = new URLSearchParams({ limit: "100" });
    if (searchValue.trim()) params.set("search", searchValue.trim());
    apiRequest(`/api/admin/invoices?${params.toString()}`)
      .then((data) => {
        setInvoices(data.invoices || []);
        setTotal(data.total || 0);
      })
      .catch(() => {
        setInvoices([]);
        setTotal(0);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadInvoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearch = (e) => {
    e.preventDefault();
    loadInvoices();
  };

  const handleSearchChange = (e) => {
    const value = e.target.value;
    setSearch(value);
    if (value.trim() === "" && search.trim() !== "") {
      loadInvoices({ search: "" });
    }
  };

  const handleExportCsv = () => downloadFile("/api/admin/invoices/export-csv", "legaldesk_invoices.csv").catch(() => {});
  const handleDownloadPdf = (id, invoiceNumber) => downloadFile(`/api/admin/invoices/${id}/pdf`, `${invoiceNumber}.pdf`).catch(() => {});

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "#0f172a" }}>B2C Invoices</h1>
          <p className="text-sm mt-1" style={{ color: "#5B7285" }}>{total} invoices from paid orders</p>
        </div>
        <button onClick={handleExportCsv} className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>
          Export CSV
        </button>
      </div>

      <form onSubmit={handleSearch} className="rounded-2xl p-4 mb-5 flex flex-wrap gap-3 items-center" style={{ background: "#fff", border: "1px solid #D8E6F0" }}>
        <input value={search} onChange={handleSearchChange} placeholder="Search by invoice number, customer, or document..." className={`flex-1 min-w-48 ${inputClass}`} style={inputStyle} />
        <button type="submit" className="px-5 py-2 rounded-xl text-sm font-semibold text-white" style={{ background: "#1E6091" }}>Search</button>
      </form>

      <div className="rounded-2xl overflow-hidden" style={{ background: "#fff", border: "1px solid #D8E6F0", boxShadow: "0 8px 24px rgba(30,96,145,0.1)" }}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ background: "#F3F8FB" }}>
                {["Invoice #", "Customer", "Document", "Amount", "GST", "Invoice Date", "Actions"].map((h) => (
                  <th key={h} className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: "#5B7285" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="text-center py-12 text-sm" style={{ color: "#5B7285" }}>Loading...</td></tr>
              ) : invoices.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-12 text-sm" style={{ color: "#5B7285" }}>No invoices found.</td></tr>
              ) : (
                invoices.map((inv) => (
                  <tr key={inv.id} className="border-t" style={{ borderColor: "#EEF3F8" }}>
                    <td className="px-5 py-3 text-sm font-mono font-semibold" style={{ color: "#6B21A8" }}>{inv.invoice_number}</td>
                    <td className="px-5 py-3 text-sm" style={{ color: "#1e293b" }}>
                      <p className="font-semibold">{inv.customer_name}</p>
                      <p className="text-xs" style={{ color: "#94A3B8" }}>{inv.customer_email}</p>
                    </td>
                    <td className="px-5 py-3 text-sm" style={{ color: "#5B7285" }}>{inv.document_name}</td>
                    <td className="px-5 py-3 text-sm font-semibold" style={{ color: "#0f172a" }}>{formatCurrency(inv.amount)}</td>
                    <td className="px-5 py-3 text-sm" style={{ color: "#5B7285" }}>{formatCurrency(inv.gst)}</td>
                    <td className="px-5 py-3 text-sm whitespace-nowrap" style={{ color: "#94A3B8" }}>{formatDate(inv.invoice_date)}</td>
                    <td className="px-5 py-3">
                      <button onClick={() => handleDownloadPdf(inv.id, inv.invoice_number)} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: "#E6F5EA", color: "#3D7A1F" }}>PDF</button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default AdminInvoicesTab;
