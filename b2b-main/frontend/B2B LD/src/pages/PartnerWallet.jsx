import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { apiRequest } from "../lib/api";
import { formatCurrency } from "../lib/format";
import { useAuth } from "../lib/AuthContext";
import { portalBase } from "../lib/roleHome";
import Modal from "../components/Modal";
import SuccessModal from "../components/SuccessModal";

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

const statusBadge = (isActive) =>
  isActive ? (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold" style={{ background: "#E6F5EA", color: "#3D7A1F" }}>
      <span className="w-1.5 h-1.5 rounded-full bg-[#16A34A]"></span>Active
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold" style={{ background: "#E8F3FB", color: "#1E6091" }}>
      <span className="w-1.5 h-1.5 rounded-full bg-[#176B87]"></span>Inactive
    </span>
  );

// Credit transactions get a wallet-recharge Reimbursement invoice, but not
// automatically — the wallet is credited immediately (see
// organizations.create_wallet_transaction). A credit raised specifically to
// cover a real order (t.order_id set — see organizations.credit_user_wallet /
// create_wallet_transaction) already gets its Reimbursement invoice
// auto-generated the moment that order reaches Completed (see
// partner._auto_generate_wallet_reimbursement_invoices_on_completion) — never
// a manual action here. Only a genuinely standalone recharge (no order_id,
// e.g. this section's own "Credit Partner/User Wallet" forms, which have no
// order to attach to) ever needs its invoice generated explicitly, via the
// action column below (organizations.generate_wallet_transaction_invoice).
const TransactionTable = ({ transactions, organizationId, onInvoiceGenerated }) => {
  const [generatingId, setGeneratingId] = useState(null);

  if (!transactions?.length) {
    return <p className="text-sm" style={{ color: "#5B7285" }}>No transactions yet.</p>;
  }

  const handleGenerate = async (transactionId) => {
    setGeneratingId(transactionId);
    try {
      await apiRequest(`/api/organizations/${organizationId}/wallet/transactions/${transactionId}/generate-invoice`, {
        method: "POST",
      });
      onInvoiceGenerated?.();
    } finally {
      setGeneratingId(null);
    }
  };

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: "1px solid #D8E6F0" }}>
      <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr style={{ background: "#F3F8FB" }}>
            {["Date", "Type", "Amount", "Balance After", "Description", "Reimbursement Invoice"].map((h) => (
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
              <td className="px-4 py-2.5 text-sm">
                {t.type !== "credit" ? (
                  <span style={{ color: "#cbd5e1" }}>-</span>
                ) : t.order_id ? (
                  <span className="text-xs" style={{ color: "#5B7285" }}>Part of an order — invoiced on completion</span>
                ) : t.has_invoice ? (
                  <span className="text-xs font-semibold" style={{ color: "#3D7A1F" }}>Invoiced</span>
                ) : (
                  <button
                    onClick={() => handleGenerate(t.id)}
                    disabled={generatingId === t.id}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-60"
                    style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}
                  >
                    {generatingId === t.id ? "Generating..." : "Generate Invoice"}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
};

const CreditUserWalletModal = ({ organizationId, user, partnerBalance, onClose, onCredited }) => {
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    const value = Number(amount);
    if (!value || value <= 0) {
      setError("Enter a valid amount");
      return;
    }
    if (value > Number(partnerBalance || 0)) {
      setError("Insufficient partner wallet balance");
      return;
    }
    if (!description.trim()) {
      setError("Enter a description for this recharge");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await apiRequest(`/api/organizations/${organizationId}/users/${user.membership_id}/wallet/credit`, {
        method: "POST",
        body: JSON.stringify({ amount: value, description: description.trim() }),
      });
      onCredited();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Credit User Wallet" subtitle={`${user.full_name} · ${user.email}`} onClose={onClose}>
      {error && <p className="text-xs font-medium mb-3 px-3 py-2 rounded-lg" style={{ background: "#E8F3FB", color: "#1E6091" }}>{error}</p>}
      <p className="text-xs mb-4" style={{ color: "#5B7285" }}>
        This amount is transferred from the partner wallet (current balance: {formatCurrency(partnerBalance)}) to this user's wallet.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Amount *">
          <input type="number" min="0" value={amount} onChange={(e) => { setAmount(e.target.value); setError(""); }} className={inputClass} style={inputStyle} />
        </Field>
        <Field label="Description *">
          <input value={description} onChange={(e) => { setDescription(e.target.value); setError(""); }} placeholder="Reason for this recharge" className={inputClass} style={inputStyle} />
        </Field>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="px-5 py-2.5 rounded-xl text-sm font-semibold" style={{ background: "#E2EBF4", color: "#334155" }}>Cancel</button>
        <button onClick={handleSubmit} disabled={saving} className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>
          {saving ? "Crediting..." : "Credit Wallet"}
        </button>
      </div>
    </Modal>
  );
};

const UserWalletHistoryModal = ({ organizationId, user, onClose }) => {
  const [wallet, setWallet] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    apiRequest(`/api/organizations/${organizationId}/users/${user.membership_id}/wallet`)
      .then(setWallet)
      .catch(() => setWallet(null))
      .finally(() => setLoading(false));
  };

  useEffect(load, [organizationId, user.membership_id]);

  return (
    <Modal title="User Wallet Transactions" subtitle={`${user.full_name} · ${user.email}`} onClose={onClose} width="max-w-2xl">
      <div className="rounded-xl p-5 mb-5" style={{ background: "#F3F8FB", border: "1px solid #D8E6F0" }}>
        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#5B7285" }}>Current Balance</p>
        <p className="text-2xl font-bold mt-1" style={{ color: "#0f172a" }}>{loading ? "..." : formatCurrency(wallet?.balance)}</p>
      </div>
      <h3 className="text-sm font-bold mb-3" style={{ color: "#0f172a" }}>Transactions</h3>
      {loading ? (
        <p className="text-sm" style={{ color: "#5B7285" }}>Loading...</p>
      ) : (
        <TransactionTable transactions={wallet?.transactions} organizationId={organizationId} onInvoiceGenerated={load} />
      )}
    </Modal>
  );
};

const PartnerWallet = () => {
  const { organizationId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const base = portalBase(user);
  const [partner, setPartner] = useState(null);
  const [wallet, setWallet] = useState(null);
  const [walletLoading, setWalletLoading] = useState(true);
  const [userWallets, setUserWallets] = useState([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [form, setForm] = useState({ amount: "", description: "" });
  const [saving, setSaving] = useState(false);
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4500);
  };

  const loadWallet = () => {
    setWalletLoading(true);
    apiRequest(`/api/organizations/${organizationId}/wallet`)
      .then(setWallet)
      .catch(() => setWallet(null))
      .finally(() => setWalletLoading(false));
  };

  const loadUserWallets = () => {
    setUsersLoading(true);
    apiRequest(`/api/organizations/${organizationId}/wallets/users`)
      .then(setUserWallets)
      .catch(() => setUserWallets([]))
      .finally(() => setUsersLoading(false));
  };

  useEffect(() => {
    apiRequest(`/api/organizations/${organizationId}`).then(setPartner).catch(() => setPartner(null));
    loadWallet();
    loadUserWallets();
  }, [organizationId]);

  const closeModal = () => setModal(null);

  // Credits the wallet immediately, same as debit — a recharge is a single
  // action. The Reimbursement invoice is a separate, later step: it starts
  // out "Pending" in Partner Transaction History below until explicitly
  // generated from that table. General wallet recharges are never orders.
  const handleSubmit = async () => {
    const amount = Number(form.amount);
    if (!amount || amount <= 0) {
      showToast("Enter a valid amount", "error");
      return;
    }
    if (!form.description.trim()) {
      showToast("Enter a description for this recharge", "error");
      return;
    }
    setSaving(true);
    try {
      await apiRequest(`/api/organizations/${organizationId}/wallet/transactions`, {
        method: "POST",
        body: JSON.stringify({
          type: "credit", amount, description: form.description.trim(),
        }),
      });
      loadWallet();
      setForm({ amount: "", description: "" });
      setSuccessMessage("Partner wallet credited successfully");
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      {toast && (
        <div className="fixed top-5 right-5 z-50 px-5 py-3 rounded-xl text-sm font-semibold shadow-lg text-white transition-all max-w-xl" style={{ background: toast.type === "error" ? "#176B87" : "#16A34A" }}>
          {toast.msg}
        </div>
      )}

      <div className="mb-6">
        <Link to={`${base}/customer-list`} className="text-xs font-semibold inline-flex items-center gap-1 mb-2" style={{ color: "#16A34A" }}>
          ← Back to Partner List
        </Link>
        <h1 className="text-2xl font-bold" style={{ color: "#0f172a" }}>Wallet Management</h1>
        <p className="text-sm mt-1" style={{ color: "#5B7285" }}>
          {partner ? partner.organization_name : "Loading partner..."}
        </p>
      </div>

      {/* Partner Wallet summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: "Current Wallet Balance", value: wallet?.balance, color: "#1E6091" },
          { label: "Total Credits", value: wallet?.total_credits, color: "#3D7A1F" },
          { label: "Total Debits", value: wallet?.total_debits, color: "#1E6091" },
          { label: "Available Balance", value: wallet?.balance, color: "#1E6091" },
        ].map((c) => (
          <div key={c.label} className="rounded-2xl p-5" style={card}>
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#5B7285" }}>{c.label}</p>
            <p className="text-2xl font-bold mt-1.5" style={{ color: c.color }}>{walletLoading ? "..." : formatCurrency(c.value)}</p>
          </div>
        ))}
      </div>

      {/* Credit partner wallet */}
      <section className="rounded-2xl p-6 mb-6" style={card}>
        <h2 className="text-base font-bold mb-1" style={{ color: "#0f172a" }}>Credit Partner Wallet</h2>
        <p className="text-xs mb-4" style={{ color: "#5B7285" }}>Super Admin adds funds to the partner's wallet balance</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-end">
          <Field label="Amount">
            <input type="number" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className={inputClass} style={inputStyle} />
          </Field>
          <Field label="Description *">
            <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputClass} style={inputStyle} placeholder="Reason for this recharge" />
          </Field>
        </div>
        <div className="mt-3 flex justify-end">
          <button onClick={handleSubmit} disabled={saving} className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>
            {saving ? "Crediting..." : "Credit Wallet"}
          </button>
        </div>
      </section>

      {/* Partner transaction history */}
      <section className="rounded-2xl p-6 mb-6" style={card}>
        <h2 className="text-base font-bold mb-1" style={{ color: "#0f172a" }}>Partner Transaction History</h2>
        <p className="text-xs mb-4" style={{ color: "#5B7285" }}>Standalone recharges need their Reimbursement invoice generated here; order-linked ones invoice automatically when that order completes</p>
        {walletLoading ? (
          <p className="text-sm" style={{ color: "#5B7285" }}>Loading...</p>
        ) : (
          <TransactionTable transactions={wallet?.transactions} organizationId={organizationId} onInvoiceGenerated={loadWallet} />
        )}
      </section>

      {/* User wallets */}
      <section className="rounded-2xl overflow-hidden" style={card}>
        <div className="px-6 py-5 border-b" style={{ borderColor: "#E2EBF4" }}>
          <h2 className="text-base font-bold" style={{ color: "#0f172a" }}>User Wallets</h2>
          <p className="text-xs mt-0.5" style={{ color: "#5B7285" }}>Credit individual users under this partner from the partner wallet</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ background: "#F3F8FB", borderBottom: "1px solid #D8E6F0" }}>
                {["User Name", "Email", "Current Balance", "Status", "Created Date", "Actions"].map((h) => (
                  <th key={h} className="text-left px-5 py-3.5 text-xs font-semibold uppercase tracking-wider" style={{ color: "#5B7285" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {userWallets.map((u) => (
                <tr key={u.membership_id} className="border-t transition-colors hover:bg-slate-50/50" style={{ borderColor: "#E2EBF4" }}>
                  <td className="px-5 py-4"><p className="text-sm font-semibold" style={{ color: "#1e293b" }}>{u.full_name}</p></td>
                  <td className="px-5 py-4 text-sm" style={{ color: "#1e293b" }}>{u.email}</td>
                  <td className="px-5 py-4 text-sm font-semibold" style={{ color: "#0f172a" }}>{formatCurrency(u.balance)}</td>
                  <td className="px-5 py-4">{statusBadge(u.is_active)}</td>
                  <td className="px-5 py-4 text-sm whitespace-nowrap" style={{ color: "#5B7285" }}>{formatDate(u.created_at)}</td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2">
                      <button onClick={() => setModal({ type: "creditUser", user: u })} className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors" style={{ background: "#E6F5EA", color: "#3D7A1F" }}>Credit Wallet</button>
                      <button onClick={() => setModal({ type: "userHistory", user: u })} className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors" style={{ background: "#E8F3FB", color: "#1E6091" }}>View Transactions</button>
                    </div>
                  </td>
                </tr>
              ))}
              {!usersLoading && userWallets.length === 0 && (
                <tr>
                  <td colSpan="6" className="text-center py-16 text-sm" style={{ color: "#5B7285" }}>No users under this partner yet.</td>
                </tr>
              )}
              {usersLoading && (
                <tr>
                  <td colSpan="6" className="text-center py-16 text-sm" style={{ color: "#5B7285" }}>Loading users...</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {modal?.type === "creditUser" && (
        <CreditUserWalletModal
          organizationId={organizationId}
          user={modal.user}
          partnerBalance={wallet?.balance}
          onClose={closeModal}
          onCredited={() => {
            loadWallet();
            loadUserWallets();
            const name = modal.user.full_name;
            closeModal();
            setSuccessMessage(`Credited ${name}'s wallet successfully`);
          }}
        />
      )}
      {modal?.type === "userHistory" && (
        <UserWalletHistoryModal organizationId={organizationId} user={modal.user} onClose={closeModal} />
      )}

      {successMessage && (
        <SuccessModal
          title="Saved Successfully"
          message={successMessage}
          onOk={() => navigate(`${base}/partners/${organizationId}/profile?tab=wallet`)}
        />
      )}
    </div>
  );
};

export default PartnerWallet;
