import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiRequest, downloadFile } from "../lib/api";
import { formatCurrency } from "../lib/format";
import { useAuth } from "../lib/AuthContext";
import { portalBase } from "../lib/roleHome";
import SuccessModal from "../components/SuccessModal";

const inputClass = "w-full px-4 py-2.5 text-sm rounded-xl outline-none transition-all disabled:cursor-not-allowed";
const inputStyle = { background: "#F3F8FB", border: "1px solid #D8E6F0", color: "#1e293b" };
const disabledStyle = { background: "#E2EBF4", border: "1px solid #D8E6F0", color: "#5B7285" };

const Field = ({ label, children }) => (
  <div>
    <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#5B7285" }}>{label}</label>
    {children}
  </div>
);

const isKarnataka = (state) => (state || "").trim().toLowerCase() === "karnataka";

const emptyItem = () => ({ description: "", hsn_sac: "", qty: 1, rate: 0, cgst_percentage: 0, sgst_percentage: 0, igst_percentage: 0 });

const lineAmount = (item) => Number(item.qty || 0) * Number(item.rate || 0);

// Local calendar date (not UTC) so "today" in the date input matches the
// user's own clock instead of shifting a day near midnight in some timezones.
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const AccountsB2BInvoiceForm = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const base = portalBase(user);
  const { invoiceId } = useParams();
  const isEdit = Boolean(invoiceId);

  const [customers, setCustomers] = useState([]);
  const [customerId, setCustomerId] = useState("");
  const [invoiceNumberDisplay, setInvoiceNumberDisplay] = useState("");
  const [invoiceType, setInvoiceType] = useState("Invoice");
  const [invoiceDate, setInvoiceDate] = useState(isEdit ? "" : todayIso());
  const [dueDate, setDueDate] = useState("");
  const [terms, setTerms] = useState("Due on Receipt");
  const [items, setItems] = useState([emptyItem()]);
  const [reimbursementRate, setReimbursementRate] = useState(0);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showSuccess, setShowSuccess] = useState(false);

  useEffect(() => {
    apiRequest("/api/customers").then(setCustomers).catch(() => setCustomers([]));
  }, []);

  // Preview only — the real number is assigned atomically on the server at
  // creation time (see accounts.py:_next_invoice_number), so if another
  // invoice of the same series is created in between, this preview can go
  // stale until it refetches. Depends only on invoice_type/series now — the
  // fiscal-year segment always comes from whichever Financial Year is
  // Active (see Accounts > Invoice Settings), not from invoice_date.
  useEffect(() => {
    if (isEdit) return;
    apiRequest(`/api/accounts/invoices/next-number?invoice_type=${encodeURIComponent(invoiceType)}`)
      .then((s) => setInvoiceNumberDisplay(s.invoice_number))
      .catch(() => setInvoiceNumberDisplay(""));
  }, [isEdit, invoiceType]);

  useEffect(() => {
    if (!isEdit) return;
    apiRequest(`/api/accounts/invoices/${invoiceId}`)
      .then((inv) => {
        setCustomerId(inv.customer_id);
        setInvoiceNumberDisplay(inv.invoice_number);
        setInvoiceType(inv.invoice_type);
        setInvoiceDate(inv.invoice_date || "");
        setDueDate(inv.due_date || "");
        setTerms(inv.terms || "Due on Receipt");
        if (inv.invoice_type === "Reimbursement") {
          setReimbursementRate(Number(inv.items?.[0]?.rate || 0));
        } else {
          setItems(
            (inv.items || []).map((it) => ({
              description: it.description,
              hsn_sac: it.hsn_sac || "",
              qty: Number(it.qty),
              rate: Number(it.rate),
              cgst_percentage: Number(it.cgst_percentage),
              sgst_percentage: Number(it.sgst_percentage),
              igst_percentage: Number(it.igst_percentage),
            }))
          );
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [isEdit, invoiceId]);

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === customerId) || null,
    [customers, customerId]
  );
  const karnataka = isKarnataka(selectedCustomer?.state);

  const totals = useMemo(() => {
    const rows = invoiceType === "Reimbursement" ? [{ qty: 1, rate: reimbursementRate, cgst_percentage: 0, sgst_percentage: 0, igst_percentage: 0 }] : items;
    const subtotal = rows.reduce((s, r) => s + lineAmount(r), 0);
    const cgst = rows.reduce((s, r) => s + (lineAmount(r) * Number(r.cgst_percentage || 0)) / 100, 0);
    const sgst = rows.reduce((s, r) => s + (lineAmount(r) * Number(r.sgst_percentage || 0)) / 100, 0);
    const igst = rows.reduce((s, r) => s + (lineAmount(r) * Number(r.igst_percentage || 0)) / 100, 0);
    return { subtotal, cgst, sgst, igst, total: subtotal + cgst + sgst + igst };
  }, [invoiceType, items, reimbursementRate]);

  const updateItem = (index, field, value) => {
    setItems(items.map((it, i) => (i === index ? { ...it, [field]: value } : it)));
  };
  const addItem = () => setItems([...items, emptyItem()]);
  const removeItem = (index) => setItems(items.filter((_, i) => i !== index));

  const handleSubmit = async () => {
    if (!customerId) {
      setError("Select a customer");
      return;
    }
    if (invoiceType === "Invoice" && items.some((it) => !it.description || !it.rate)) {
      setError("Every line item needs a description and a rate");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const payload = {
        customer_id: customerId,
        invoice_type: invoiceType,
        invoice_date: invoiceDate || null,
        due_date: dueDate || null,
        terms,
        items:
          invoiceType === "Reimbursement"
            ? [{ description: "Stamp Duty Recovery", qty: 1, rate: reimbursementRate }]
            : items,
      };
      if (isEdit) {
        await apiRequest(`/api/accounts/invoices/${invoiceId}`, { method: "PATCH", body: JSON.stringify(payload) });
      } else {
        await apiRequest("/api/accounts/invoices", { method: "POST", body: JSON.stringify(payload) });
      }
      setShowSuccess(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-sm" style={{ color: "#5B7285" }}>Loading...</p>;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: "#0f172a" }}>{isEdit ? "Edit Invoice" : "Create Invoice"}</h1>
        <p className="text-sm mt-1" style={{ color: "#5B7285" }}>B2B manual invoice</p>
      </div>

      {error && <p className="text-sm font-medium mb-4 px-4 py-2.5 rounded-xl" style={{ background: "#E8F3FB", color: "#1E6091" }}>{error}</p>}

      <div className="rounded-2xl p-6 mb-5" style={{ background: "#fff", border: "1px solid #D8E6F0" }}>
        <h2 className="font-semibold mb-4" style={{ color: "#0f172a" }}>Customer</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Customer *">
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={inputClass} style={inputStyle}>
              <option value="">Select a customer</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.company_name}</option>
              ))}
            </select>
          </Field>
          <Field label="GSTIN">
            <input disabled value={selectedCustomer?.gstin || ""} className={inputClass} style={disabledStyle} />
          </Field>
          <Field label="City">
            <input disabled value={selectedCustomer?.city || ""} className={inputClass} style={disabledStyle} />
          </Field>
          <Field label="State">
            <input disabled value={selectedCustomer?.state || ""} className={inputClass} style={disabledStyle} />
          </Field>
          <div className="md:col-span-2">
            <Field label="Address">
              <textarea disabled value={selectedCustomer?.address || ""} rows={2} className={inputClass} style={{ ...disabledStyle, resize: "none" }} />
            </Field>
          </div>
        </div>
      </div>

      <div className="rounded-2xl p-6 mb-5" style={{ background: "#fff", border: "1px solid #D8E6F0" }}>
        <h2 className="font-semibold mb-4" style={{ color: "#0f172a" }}>Invoice Details</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <Field label="Invoice Number">
            <input disabled value={invoiceNumberDisplay || "Generating..."} className={inputClass} style={disabledStyle} />
            {!isEdit && (
              <p className="text-xs mt-1" style={{ color: "#94A3B8" }}>Auto-generated based on Invoice Number Settings</p>
            )}
          </Field>
          <Field label="Invoice Date">
            <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className={inputClass} style={inputStyle} />
          </Field>
          <Field label="Due Date">
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputClass} style={inputStyle} />
          </Field>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <Field label="Invoice Type *">
            <div className="flex items-center gap-6 py-2">
              {["Reimbursement", "Invoice"].map((t) => (
                <label key={t} className="flex items-center gap-2 cursor-pointer text-sm font-medium" style={{ color: invoiceType === t ? "#1E6091" : "#5B7285" }}>
                  <input type="radio" name="invoice_type" checked={invoiceType === t} onChange={() => setInvoiceType(t)} className="accent-[#1E6091]" />
                  {t}
                </label>
              ))}
            </div>
          </Field>
        </div>
        <Field label="Terms">
          <input value={terms} onChange={(e) => setTerms(e.target.value)} className={inputClass} style={inputStyle} />
        </Field>
      </div>

      {invoiceType === "Reimbursement" ? (
        <div className="rounded-2xl p-6 mb-5" style={{ background: "#fff", border: "1px solid #D8E6F0" }}>
          <h2 className="font-semibold mb-4" style={{ color: "#0f172a" }}>Particulars</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Particulars">
              <input disabled value="Stamp Duty Recovery" className={inputClass} style={disabledStyle} />
            </Field>
            <Field label="Rate (₹) *">
              <input type="number" min={0} value={reimbursementRate} onChange={(e) => setReimbursementRate(Number(e.target.value))} className={inputClass} style={inputStyle} />
            </Field>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl p-6 mb-5" style={{ background: "#fff", border: "1px solid #D8E6F0" }}>
          <div className="flex justify-between items-center mb-4">
            <h2 className="font-semibold" style={{ color: "#0f172a" }}>
              Line Items
              {selectedCustomer && (
                <span className="ml-2 text-xs font-normal" style={{ color: "#5B7285" }}>
                  ({karnataka ? "Karnataka — CGST + SGST" : "Out-of-state — IGST only"})
                </span>
              )}
            </h2>
            <button onClick={addItem} className="px-4 py-2 rounded-xl text-xs font-semibold" style={{ background: "#E8F3FB", color: "#1E6091" }}>+ Add Line</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr style={{ background: "#F3F8FB" }}>
                  {["Description", "HSN/SAC", "Qty", "Rate", karnataka ? "CGST %" : null, karnataka ? "SGST %" : null, !karnataka ? "IGST %" : null, "Amount", ""]
                    .filter(Boolean)
                    .map((h) => (
                      <th key={h} className="text-left px-3 py-2.5 text-xs font-semibold uppercase" style={{ color: "#1E6091" }}>{h}</th>
                    ))}
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  <tr key={i} className="border-t" style={{ borderColor: "#E2EBF4" }}>
                    <td className="px-3 py-2"><input value={item.description} onChange={(e) => updateItem(i, "description", e.target.value)} className={inputClass} style={inputStyle} /></td>
                    <td className="px-3 py-2"><input value={item.hsn_sac} onChange={(e) => updateItem(i, "hsn_sac", e.target.value)} className={inputClass} style={inputStyle} /></td>
                    <td className="px-3 py-2 w-20"><input type="number" min={0} value={item.qty} onChange={(e) => updateItem(i, "qty", Number(e.target.value))} className={inputClass} style={inputStyle} /></td>
                    <td className="px-3 py-2 w-28"><input type="number" min={0} value={item.rate} onChange={(e) => updateItem(i, "rate", Number(e.target.value))} className={inputClass} style={inputStyle} /></td>
                    {karnataka && (
                      <td className="px-3 py-2 w-20"><input type="number" min={0} value={item.cgst_percentage} onChange={(e) => updateItem(i, "cgst_percentage", Number(e.target.value))} className={inputClass} style={inputStyle} /></td>
                    )}
                    {karnataka && (
                      <td className="px-3 py-2 w-20"><input type="number" min={0} value={item.sgst_percentage} onChange={(e) => updateItem(i, "sgst_percentage", Number(e.target.value))} className={inputClass} style={inputStyle} /></td>
                    )}
                    {!karnataka && (
                      <td className="px-3 py-2 w-20"><input type="number" min={0} value={item.igst_percentage} onChange={(e) => updateItem(i, "igst_percentage", Number(e.target.value))} className={inputClass} style={inputStyle} /></td>
                    )}
                    <td className="px-3 py-2 text-sm font-semibold whitespace-nowrap" style={{ color: "#1e293b" }}>{formatCurrency(lineAmount(item))}</td>
                    <td className="px-3 py-2">
                      {items.length > 1 && (
                        <button onClick={() => removeItem(i)} className="px-2 py-1 rounded-lg text-xs font-semibold" style={{ background: "#FCE8E8", color: "#B91C1C" }}>Remove</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="rounded-2xl p-6 mb-5" style={{ background: "#fff", border: "1px solid #D8E6F0" }}>
        <div className="flex flex-col items-end gap-1.5 text-sm">
          <div className="flex justify-between w-64"><span style={{ color: "#5B7285" }}>Subtotal</span><span style={{ color: "#1e293b" }}>{formatCurrency(totals.subtotal)}</span></div>
          {totals.cgst > 0 && <div className="flex justify-between w-64"><span style={{ color: "#5B7285" }}>CGST</span><span style={{ color: "#1e293b" }}>{formatCurrency(totals.cgst)}</span></div>}
          {totals.sgst > 0 && <div className="flex justify-between w-64"><span style={{ color: "#5B7285" }}>SGST</span><span style={{ color: "#1e293b" }}>{formatCurrency(totals.sgst)}</span></div>}
          {totals.igst > 0 && <div className="flex justify-between w-64"><span style={{ color: "#5B7285" }}>IGST</span><span style={{ color: "#1e293b" }}>{formatCurrency(totals.igst)}</span></div>}
          <div className="flex justify-between w-64 pt-1.5 border-t font-bold" style={{ borderColor: "#E2EBF4", color: "#0f172a" }}><span>Total</span><span>{formatCurrency(totals.total)}</span></div>
        </div>
      </div>

      <div className="flex justify-end gap-2">
        {isEdit && (
          <button
            onClick={() => downloadFile(`/api/accounts/invoices/${invoiceId}/pdf`, `${invoiceNumberDisplay || "invoice"}.pdf`)}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold"
            style={{ background: "#E8F3FB", color: "#1E6091" }}
          >
            Download PDF
          </button>
        )}
        <button onClick={() => navigate(`${base}/accounts/b2b-invoices`)} className="px-5 py-2.5 rounded-xl text-sm font-semibold" style={{ background: "#E2EBF4", color: "#334155" }}>Cancel</button>
        <button onClick={handleSubmit} disabled={saving} className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>
          {saving ? "Saving..." : isEdit ? "Save Changes" : "Create Invoice"}
        </button>
      </div>

      {showSuccess && (
        <SuccessModal
          title="Saved Successfully"
          message={isEdit ? "Invoice updated successfully" : "Invoice created successfully"}
          onOk={() => navigate(`${base}/accounts/b2b-invoices`)}
        />
      )}
    </div>
  );
};

export default AccountsB2BInvoiceForm;
