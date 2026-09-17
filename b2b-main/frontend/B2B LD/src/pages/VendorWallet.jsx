import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiRequest } from "../lib/api";
import { formatCurrency } from "../lib/format";
import { useAuth } from "../lib/AuthContext";
import { portalBase } from "../lib/roleHome";
import SuccessModal from "../components/SuccessModal";
import PlaceholderNotice from "../components/PlaceholderNotice";

const inputClass = "w-full px-4 py-2.5 text-sm rounded-xl outline-none transition-all disabled:cursor-not-allowed";
const inputStyle = { background: "#F3F8FB", border: "1px solid #D8E6F0", color: "#1e293b" };
const card = { background: "#fff", border: "1px solid #D8E6F0", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" };

const Field = ({ label, children }) => (
  <div>
    <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#5B7285" }}>{label}</label>
    {children}
  </div>
);

const formatDate = (value) =>
  value ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "-";

const TransactionTable = ({ transactions }) =>
  !transactions?.length ? (
    <p className="text-sm" style={{ color: "#5B7285" }}>No transactions yet.</p>
  ) : (
    <div className="rounded-xl overflow-hidden" style={{ border: "1px solid #D8E6F0" }}>
      <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr style={{ background: "#F3F8FB" }}>
            {["Date", "Type", "Amount", "Balance After", "Description"].map((h) => (
              <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold uppercase" style={{ color: "#5B7285" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {transactions.map((t) => (
            <tr key={t.id} className="border-t" style={{ borderColor: "#E2EBF4" }}>
              <td className="px-4 py-2.5 text-sm" style={{ color: "#5B7285" }}>{formatDate(t.created_at)}</td>
              <td className="px-4 py-2.5">
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full capitalize" style={{ background: t.type === "credit" ? "#E6F5EA" : "#E8F3FB", color: t.type === "credit" ? "#3D7A1F" : "#1E6091" }}>{t.type}</span>
              </td>
              <td className="px-4 py-2.5 text-sm font-semibold" style={{ color: "#1e293b" }}>{formatCurrency(t.amount)}</td>
              <td className="px-4 py-2.5 text-sm" style={{ color: "#1e293b" }}>{formatCurrency(t.balance_after)}</td>
              <td className="px-4 py-2.5 text-sm" style={{ color: "#5B7285" }}>{t.description || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );

const VendorWallet = () => {
  const { vendorId } = useParams();
  const { user } = useAuth();
  const base = portalBase(user);
  const [vendor, setVendor] = useState(null);
  const [wallet, setWallet] = useState(null);
  const [walletLoading, setWalletLoading] = useState(true);
  const [creditForm, setCreditForm] = useState({ amount: "", description: "" });
  const [debitForm, setDebitForm] = useState({ amount: "", description: "" });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4500);
  };

  const loadWallet = () => {
    setWalletLoading(true);
    apiRequest(`/api/vendors/${vendorId}/wallet`)
      .then(setWallet)
      .catch(() => setWallet(null))
      .finally(() => setWalletLoading(false));
  };

  useEffect(() => {
    apiRequest(`/api/vendors/${vendorId}`).then(setVendor).catch(() => setVendor(null));
    loadWallet();
  }, [vendorId]);

  const handleTransaction = async (type, form, resetForm) => {
    const amount = Number(form.amount);
    if (!amount || amount <= 0) {
      showToast("Enter a valid amount", "error");
      return;
    }
    // Only recharges (credits) require a description — debits keep it optional.
    if (type === "credit" && !form.description.trim()) {
      showToast("Enter a description for this recharge", "error");
      return;
    }
    setSaving(true);
    try {
      await apiRequest(`/api/vendors/${vendorId}/wallet/transactions`, {
        method: "POST",
        body: JSON.stringify({ type, amount, description: form.description.trim() || null }),
      });
      loadWallet();
      resetForm();
      setSuccessMessage(`Vendor wallet ${type === "credit" ? "credited" : "debited"} successfully`);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setSaving(false);
    }
  };

  if (vendor && vendor.payment_mode === "PPS") {
    return (
      <div>
        <div className="mb-6">
          <Link to={`${base}/vendor-list`} className="text-xs font-semibold inline-flex items-center gap-1 mb-2" style={{ color: "#16A34A" }}>← Back to Vendor List</Link>
          <h1 className="text-2xl font-bold" style={{ color: "#0f172a" }}>Wallet Management</h1>
          <p className="text-sm mt-1" style={{ color: "#5B7285" }}>{vendor.vendor_name}</p>
        </div>
        <PlaceholderNotice title="Not applicable" message="This vendor uses Self PPS (Pay Per Service), not a wallet." />
      </div>
    );
  }

  return (
    <div>
      {toast && (
        <div className="fixed top-5 right-5 z-50 px-5 py-3 rounded-xl text-sm font-semibold shadow-lg text-white transition-all max-w-xl" style={{ background: toast.type === "error" ? "#176B87" : "#16A34A" }}>
          {toast.msg}
        </div>
      )}

      <div className="mb-6">
        <Link to={`${base}/vendor-list`} className="text-xs font-semibold inline-flex items-center gap-1 mb-2" style={{ color: "#16A34A" }}>
          ← Back to Vendor List
        </Link>
        <h1 className="text-2xl font-bold" style={{ color: "#0f172a" }}>Wallet Management</h1>
        <p className="text-sm mt-1" style={{ color: "#5B7285" }}>
          {vendor ? vendor.vendor_name : "Loading vendor..."}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {[
          { label: "Current Wallet Balance", value: wallet?.balance, color: "#1E6091" },
          { label: "Total Credits", value: wallet?.total_credits, color: "#3D7A1F" },
          { label: "Total Debits", value: wallet?.total_debits, color: "#1E6091" },
        ].map((c) => (
          <div key={c.label} className="rounded-2xl p-5" style={card}>
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#5B7285" }}>{c.label}</p>
            <p className="text-2xl font-bold mt-1.5" style={{ color: c.color }}>{walletLoading ? "..." : formatCurrency(c.value)}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <section className="rounded-2xl p-6" style={card}>
          <h2 className="text-base font-bold mb-1" style={{ color: "#0f172a" }}>Credit Wallet</h2>
          <p className="text-xs mb-4" style={{ color: "#5B7285" }}>Add funds to the vendor's wallet balance</p>
          <div className="grid grid-cols-1 gap-3">
            <Field label="Amount">
              <input type="number" min="0" value={creditForm.amount} onChange={(e) => setCreditForm({ ...creditForm, amount: e.target.value })} className={inputClass} style={inputStyle} />
            </Field>
            <Field label="Description *">
              <input value={creditForm.description} onChange={(e) => setCreditForm({ ...creditForm, description: e.target.value })} className={inputClass} style={inputStyle} placeholder="Reason for this recharge" />
            </Field>
          </div>
          <div className="mt-3 flex justify-end">
            <button onClick={() => handleTransaction("credit", creditForm, () => setCreditForm({ amount: "", description: "" }))} disabled={saving} className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>
              {saving ? "Processing..." : "Credit Wallet"}
            </button>
          </div>
        </section>

        <section className="rounded-2xl p-6" style={card}>
          <h2 className="text-base font-bold mb-1" style={{ color: "#0f172a" }}>Debit Wallet</h2>
          <p className="text-xs mb-4" style={{ color: "#5B7285" }}>Deduct funds from the vendor's wallet balance</p>
          <div className="grid grid-cols-1 gap-3">
            <Field label="Amount">
              <input type="number" min="0" value={debitForm.amount} onChange={(e) => setDebitForm({ ...debitForm, amount: e.target.value })} className={inputClass} style={inputStyle} />
            </Field>
            <Field label="Description">
              <input value={debitForm.description} onChange={(e) => setDebitForm({ ...debitForm, description: e.target.value })} className={inputClass} style={inputStyle} placeholder="Optional note" />
            </Field>
          </div>
          <div className="mt-3 flex justify-end">
            <button onClick={() => handleTransaction("debit", debitForm, () => setDebitForm({ amount: "", description: "" }))} disabled={saving} className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60" style={{ background: "#176B87" }}>
              {saving ? "Processing..." : "Debit Wallet"}
            </button>
          </div>
        </section>
      </div>

      <section className="rounded-2xl p-6" style={card}>
        <h2 className="text-base font-bold mb-4" style={{ color: "#0f172a" }}>Transaction History</h2>
        {walletLoading ? <p className="text-sm" style={{ color: "#5B7285" }}>Loading...</p> : <TransactionTable transactions={wallet?.transactions} />}
      </section>

      {successMessage && (
        <SuccessModal title="Saved Successfully" message={successMessage} onOk={() => setSuccessMessage(null)} />
      )}
    </div>
  );
};

export default VendorWallet;
