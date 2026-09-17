import { useEffect, useState } from "react";
import { apiRequest, downloadFile } from "../lib/api";
import { formatCurrency } from "../lib/format";

const formatDate = (value) =>
  value ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "-";

const inputClass = "w-full px-3 py-2 text-sm rounded-lg outline-none";
const inputStyle = { background: "#fff", border: "1px solid #D8E6F0", color: "#1e293b" };

const Field = ({ label, children }) => (
  <div>
    <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: "#5B7285" }}>{label}</p>
    <div className="text-sm font-medium" style={{ color: "#1e293b" }}>{children}</div>
  </div>
);

const editableItem = (it) => ({
  description: it.description,
  hsn_sac: it.hsn_sac || "",
  qty: Number(it.qty),
  rate: Number(it.rate),
  cgst_percentage: Number(it.cgst_percentage || 0),
  sgst_percentage: Number(it.sgst_percentage || 0),
  igst_percentage: Number(it.igst_percentage || 0),
});

// Invoice detail popup — shared by the Super Admin Accounts > Invoices list
// (view AND edit, see AccountsB2BInvoices.jsx) and the read-only Partner
// User Invoices page, since GET .../invoices/{id} returns the identical
// shape (items + totals + display extras via accounts.get_invoice) on both
// sides, just scoped by a different auth dependency. Every field here is
// exactly what the PDF (see accounts._invoice_pdf_elements) renders, sourced
// from that same response — nothing is recomputed or hardcoded a second time
// here. `editable` swaps Due Date/Terms/line items to inputs and PATCHes the
// same fetchUrl (accounts.update_invoice) on Save — no separate edit screen,
// no duplicate invoice logic. Invoice Number/Type/Date, Customer (Bill To),
// Place of Supply and the Order reference are never editable here —
// update_invoice's own InvoiceUpdate model doesn't accept them either.
// Supplier details and Payment/Bank Details are intentionally not shown in
// this popup at all (still present on the downloaded PDF) — this view is
// meant for a quick "what's on this invoice" check, not a duplicate of the
// document itself.
const InvoiceViewModal = ({ fetchUrl, downloadUrl, onClose, editable = false, onSaved }) => {
  const [invoice, setInvoice] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [downloadError, setDownloadError] = useState("");

  const [dueDate, setDueDate] = useState("");
  const [terms, setTerms] = useState("");
  const [items, setItems] = useState([]);
  const [reimbursementRate, setReimbursementRate] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    apiRequest(fetchUrl)
      .then(setInvoice)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [fetchUrl]);

  // Seeds the editable fields every time a (fresh) invoice loads — including
  // right after Save re-fetches it — so the inputs always start from what's
  // actually persisted, never from stale local state.
  useEffect(() => {
    if (!invoice) return;
    setDueDate(invoice.due_date || "");
    setTerms(invoice.terms || "");
    if (invoice.invoice_type === "Reimbursement") {
      setReimbursementRate(Number(invoice.items?.[0]?.rate || 0));
    } else {
      setItems((invoice.items || []).map(editableItem));
    }
  }, [invoice]);

  const handleDownload = async () => {
    setDownloadError("");
    try {
      await downloadFile(downloadUrl, `${invoice.invoice_number.replace(/\//g, "-")}.pdf`);
    } catch (err) {
      setDownloadError(err.message);
    }
  };

  const updateItem = (index, field, value) => {
    setItems(items.map((it, i) => (i === index ? { ...it, [field]: value } : it)));
  };

  const handleSave = async () => {
    if (invoice.invoice_type === "Invoice" && items.some((it) => !it.description || !it.rate)) {
      setSaveError("Every line item needs a description and a rate");
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      const payload = {
        due_date: dueDate || null,
        terms,
        items: invoice.invoice_type === "Reimbursement"
          ? [{ description: "Stamp Duty Recovery", qty: 1, rate: reimbursementRate }]
          : items,
      };
      await apiRequest(fetchUrl, { method: "PATCH", body: JSON.stringify(payload) });
      // Re-fetched (not just the PATCH response) so the display-only extras
      // computed in get_invoice — Place of Supply, Total In Words, Bank
      // details, etc. — reflect the saved totals too.
      const fresh = await apiRequest(fetchUrl);
      setInvoice(fresh);
      onSaved?.(fresh);
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const billToLines = invoice
    ? [invoice.address, [invoice.city, invoice.postal_code].filter(Boolean).join(", ") || null, invoice.gstin ? `GSTIN ${invoice.gstin}` : null].filter(Boolean)
    : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,0.5)", backdropFilter: "blur(4px)" }}>
      <div className="w-full max-w-2xl rounded-2xl overflow-hidden shadow-2xl flex flex-col" style={{ background: "#fff", maxHeight: "90vh" }}>
        <div className="px-6 py-5 border-b flex items-center justify-between shrink-0" style={{ borderColor: "#E2EBF4" }}>
          <div className="min-w-0">
            <h2 className="text-lg font-bold" style={{ color: "#0f172a" }}>{editable ? "Edit Invoice" : "Invoice"}</h2>
            {invoice && <p className="text-xs mt-0.5" style={{ color: "#5B7285" }}>{invoice.invoice_number}</p>}
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors shrink-0" style={{ background: "#E2EBF4", color: "#5B7285" }}>✕</button>
        </div>

        <div className="p-6 overflow-y-auto space-y-5">
          {error && <p className="text-sm" style={{ color: "#176B87" }}>{error}</p>}
          {!error && loading && <p className="text-sm" style={{ color: "#5B7285" }}>Loading...</p>}
          {!error && !loading && invoice && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Invoice Number">{invoice.invoice_number}</Field>
                <Field label="Invoice Type">{invoice.invoice_type}</Field>
                <Field label="Invoice Date">{formatDate(invoice.invoice_date)}</Field>
                <Field label="Place of Supply">{invoice.place_of_supply || "-"}</Field>
                <Field label="Order Reference">{invoice.order_no || "-"}</Field>

                <Field label="Due Date">
                  {editable ? (
                    <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputClass} style={inputStyle} />
                  ) : (
                    formatDate(invoice.due_date)
                  )}
                </Field>
                <Field label="Terms">
                  {editable ? (
                    <input value={terms} onChange={(e) => setTerms(e.target.value)} className={inputClass} style={inputStyle} />
                  ) : (
                    invoice.terms || "-"
                  )}
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-xl p-4" style={{ background: "#F3F8FB", border: "1px solid #D8E6F0" }}>
                  <p className="text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#5B7285" }}>Bill To</p>
                  <p className="text-sm font-medium" style={{ color: "#1e293b" }}>{invoice.company_name || "-"}</p>
                  {billToLines.map((line) => (
                    <p key={line} className="text-sm" style={{ color: "#5B7285" }}>{line}</p>
                  ))}
                </div>
                <div className="rounded-xl p-4" style={{ background: "#F3F8FB", border: "1px solid #D8E6F0" }}>
                  <p className="text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#5B7285" }}>Ship To</p>
                  <p className="text-sm" style={{ color: "#5B7285" }}>-</p>
                </div>
              </div>

              <div className="rounded-xl overflow-hidden" style={{ border: "1px solid #D8E6F0" }}>
                <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: "#F3F8FB" }}>
                      {["Description", "Qty", "Rate", "Amount"].map((h) => (
                        <th key={h} className="text-left px-3 py-2 text-xs font-semibold uppercase" style={{ color: "#5B7285" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {editable && invoice.invoice_type === "Reimbursement" ? (
                      <tr className="border-t" style={{ borderColor: "#E2EBF4" }}>
                        <td className="px-3 py-2" style={{ color: "#1e293b" }}>Stamp Duty Recovery</td>
                        <td className="px-3 py-2" style={{ color: "#1e293b" }}>1</td>
                        <td className="px-3 py-2 w-28"><input type="number" min={0} value={reimbursementRate} onChange={(e) => setReimbursementRate(Number(e.target.value))} className={inputClass} style={inputStyle} /></td>
                        <td className="px-3 py-2 font-semibold" style={{ color: "#1e293b" }}>{formatCurrency(reimbursementRate)}</td>
                      </tr>
                    ) : editable ? (
                      items.map((item, i) => (
                        <tr key={i} className="border-t" style={{ borderColor: "#E2EBF4" }}>
                          <td className="px-3 py-2"><input value={item.description} onChange={(e) => updateItem(i, "description", e.target.value)} className={inputClass} style={inputStyle} /></td>
                          <td className="px-3 py-2 w-20"><input type="number" min={0} value={item.qty} onChange={(e) => updateItem(i, "qty", Number(e.target.value))} className={inputClass} style={inputStyle} /></td>
                          <td className="px-3 py-2 w-28"><input type="number" min={0} value={item.rate} onChange={(e) => updateItem(i, "rate", Number(e.target.value))} className={inputClass} style={inputStyle} /></td>
                          <td className="px-3 py-2 font-semibold whitespace-nowrap" style={{ color: "#1e293b" }}>{formatCurrency(item.qty * item.rate)}</td>
                        </tr>
                      ))
                    ) : (
                      (invoice.items || []).map((item) => (
                        <tr key={item.id} className="border-t" style={{ borderColor: "#E2EBF4" }}>
                          <td className="px-3 py-2" style={{ color: "#1e293b" }}>{item.description}</td>
                          <td className="px-3 py-2" style={{ color: "#1e293b" }}>{item.qty}</td>
                          <td className="px-3 py-2" style={{ color: "#1e293b" }}>{formatCurrency(item.rate)}</td>
                          <td className="px-3 py-2 font-semibold" style={{ color: "#1e293b" }}>{formatCurrency(item.amount)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: "#5B7285" }}>Total In Words</p>
                    <p className="text-sm" style={{ color: "#1e293b" }}>{invoice.amount_in_words}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: "#5B7285" }}>Note</p>
                    <p className="text-sm" style={{ color: "#1e293b" }}>{invoice.note}</p>
                  </div>
                </div>
                <div className="rounded-xl p-4 space-y-1.5 text-sm" style={{ background: "#F3F8FB", border: "1px solid #D8E6F0" }}>
                  <div className="flex justify-between"><span style={{ color: "#5B7285" }}>Subtotal</span><span style={{ color: "#1e293b" }}>{formatCurrency(invoice.subtotal)}</span></div>
                  {Number(invoice.cgst_amount) > 0 && <div className="flex justify-between"><span style={{ color: "#5B7285" }}>CGST</span><span style={{ color: "#1e293b" }}>{formatCurrency(invoice.cgst_amount)}</span></div>}
                  {Number(invoice.sgst_amount) > 0 && <div className="flex justify-between"><span style={{ color: "#5B7285" }}>SGST</span><span style={{ color: "#1e293b" }}>{formatCurrency(invoice.sgst_amount)}</span></div>}
                  {Number(invoice.igst_amount) > 0 && <div className="flex justify-between"><span style={{ color: "#5B7285" }}>IGST</span><span style={{ color: "#1e293b" }}>{formatCurrency(invoice.igst_amount)}</span></div>}
                  <div className="flex justify-between pt-1.5 border-t font-semibold" style={{ borderColor: "#D8E6F0", color: "#0f172a" }}><span>Total</span><span>{formatCurrency(invoice.total)}</span></div>
                  <div className="flex justify-between font-semibold" style={{ color: "#0f172a" }}><span>Balance Due</span><span>{formatCurrency(invoice.balance_due)}</span></div>
                </div>
              </div>

              {editable && (
                <p className="text-xs" style={{ color: "#94A3B8" }}>
                  Totals, Total In Words and Balance Due reflect the last saved amounts — they update after Save Changes.
                </p>
              )}

              {invoice.terms_conditions && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#5B7285" }}>Terms & Conditions</p>
                  <div className="text-sm space-y-0.5" style={{ color: "#1e293b" }}>
                    {invoice.terms_conditions.split("\n").filter((line) => line.trim()).map((line, i) => (
                      <p key={i}>- {line.trim()}</p>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end pt-2">
                <div className="text-center text-sm" style={{ color: "#1e293b" }}>
                  <p className="mb-8">For {invoice.company?.name}</p>
                  <p className="pt-2 border-t" style={{ borderColor: "#D8E6F0" }}>Authorized Signature</p>
                </div>
              </div>

              {downloadError && <p className="text-xs" style={{ color: "#176B87" }}>{downloadError}</p>}
              {saveError && <p className="text-xs" style={{ color: "#176B87" }}>{saveError}</p>}
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t flex items-center justify-end gap-3 shrink-0" style={{ borderColor: "#E2EBF4", background: "#F3F8FB" }}>
          {invoice && (
            <button
              onClick={handleDownload}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-90"
              style={editable ? { background: "#E8F3FB", color: "#1E6091" } : { background: "linear-gradient(135deg, #1E6091, #16A34A)", color: "#fff" }}
            >
              Download{editable ? " PDF" : ""}
            </button>
          )}
          {editable ? (
            <>
              <button onClick={onClose} className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors" style={{ background: "#fff", border: "1px solid #D8E6F0", color: "#5B7285" }}>
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving || !invoice} className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>
                {saving ? "Saving..." : "Save Changes"}
              </button>
            </>
          ) : (
            <button onClick={onClose} className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors" style={{ background: "#fff", border: "1px solid #D8E6F0", color: "#5B7285" }}>
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default InvoiceViewModal;
