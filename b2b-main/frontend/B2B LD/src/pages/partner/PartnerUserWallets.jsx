import { useEffect, useState } from "react";
import { apiRequest } from "../../lib/api";
import { formatCurrency } from "../../lib/format";
import Modal from "../../components/Modal";

const inputClass = "w-full px-4 py-2.5 text-sm rounded-xl outline-none transition-all";
const inputStyle = { background: "#F3F8FB", border: "1px solid #D8E6F0", color: "#1e293b" };
const card = { background: "#fff", border: "1px solid #D8E6F0", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" };

const Field = ({ label, children }) => (
  <div>
    <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#5B7285" }}>{label}</label>
    {children}
  </div>
);

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
            {["Date", "Type", "Amount", "Balance After", "Remarks"].map((h) => (
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

const CreditUserWalletModal = ({ user, partnerBalance, onClose, onCredited }) => {
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
      setError("Cannot credit more than your wallet balance");
      return;
    }
    if (!description.trim()) {
      setError("Enter a remark for this recharge");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await apiRequest(`/api/partner/users/${user.membership_id}/wallet/credit`, {
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
    <Modal title="Credit Wallet" subtitle={`${user.full_name} · ${user.email}`} onClose={onClose}>
      {error && <p className="text-xs font-medium mb-3 px-3 py-2 rounded-lg" style={{ background: "#E8F3FB", color: "#1E6091" }}>{error}</p>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="User"><p className="text-sm font-medium py-2.5" style={{ color: "#1e293b" }}>{user.full_name}</p></Field>
        <Field label="Current Balance"><p className="text-sm font-medium py-2.5" style={{ color: "#1e293b" }}>{formatCurrency(user.balance)}</p></Field>
        <Field label="Amount *">
          <input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputClass} style={inputStyle} />
        </Field>
        <Field label="Remarks *">
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Reason for this recharge" className={inputClass} style={inputStyle} />
        </Field>
      </div>
      <p className="text-xs mt-3" style={{ color: "#5B7285" }}>
        Your wallet balance: {formatCurrency(partnerBalance)}
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="px-5 py-2.5 rounded-xl text-sm font-semibold" style={{ background: "#E2EBF4", color: "#334155" }}>Cancel</button>
        <button onClick={handleSubmit} disabled={saving} className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>
          {saving ? "Crediting..." : "Credit"}
        </button>
      </div>
    </Modal>
  );
};

const UserWalletHistoryModal = ({ user, onClose }) => {
  const [wallet, setWallet] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiRequest(`/api/partner/users/${user.membership_id}/wallet`)
      .then(setWallet)
      .catch(() => setWallet(null))
      .finally(() => setLoading(false));
  }, [user.membership_id]);

  return (
    <Modal title="User Wallet Transactions" subtitle={`${user.full_name} · ${user.email}`} onClose={onClose} width="max-w-2xl">
      <div className="rounded-xl p-5 mb-5" style={{ background: "#F3F8FB", border: "1px solid #D8E6F0" }}>
        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#5B7285" }}>Current Balance</p>
        <p className="text-2xl font-bold mt-1" style={{ color: "#0f172a" }}>{loading ? "..." : formatCurrency(wallet?.balance)}</p>
      </div>
      <h3 className="text-sm font-bold mb-3" style={{ color: "#0f172a" }}>Transactions</h3>
      {loading ? <p className="text-sm" style={{ color: "#5B7285" }}>Loading...</p> : <TransactionTable transactions={wallet?.transactions} />}
    </Modal>
  );
};

const PartnerUserWallets = () => {
  const [wallet, setWallet] = useState(null);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4500);
  };

  const loadWallet = () => {
    apiRequest("/api/partner/wallet").then(setWallet).catch(() => setWallet(null));
  };

  const loadUsers = () => {
    setLoading(true);
    apiRequest("/api/partner/wallets/users")
      .then(setUsers)
      .catch(() => setUsers([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadWallet();
    loadUsers();
  }, []);

  const closeModal = () => setModal(null);

  return (
    <div>
      {toast && (
        <div className="fixed top-5 right-5 z-50 px-5 py-3 rounded-xl text-sm font-semibold shadow-lg text-white transition-all max-w-xl" style={{ background: toast.type === "error" ? "#176B87" : "#16A34A" }}>
          {toast.msg}
        </div>
      )}

      <div className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: "#0f172a" }}>User Wallets</h1>
        <p className="text-sm mt-1" style={{ color: "#5B7285" }}>
          Credit money to your users from your own wallet balance ({formatCurrency(wallet?.balance)} available)
        </p>
      </div>

      <div className="rounded-2xl overflow-hidden" style={card}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ background: "#F3F8FB", borderBottom: "1px solid #D8E6F0" }}>
                {["User Name", "Email", "Current Balance", "Status", "Actions"].map((h) => (
                  <th key={h} className="text-left px-5 py-3.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: "#5B7285" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.membership_id} className="border-t transition-colors hover:bg-slate-50/50" style={{ borderColor: "#E2EBF4" }}>
                  <td className="px-5 py-4"><p className="text-sm font-semibold" style={{ color: "#1e293b" }}>{u.full_name}</p></td>
                  <td className="px-5 py-4 text-sm" style={{ color: "#1e293b" }}>{u.email}</td>
                  <td className="px-5 py-4 text-sm font-semibold" style={{ color: "#0f172a" }}>{formatCurrency(u.balance)}</td>
                  <td className="px-5 py-4">{statusBadge(u.is_active)}</td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2">
                      <button onClick={() => setModal({ type: "credit", user: u })} className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors" style={{ background: "#E6F5EA", color: "#3D7A1F" }}>Credit Wallet</button>
                      <button onClick={() => setModal({ type: "history", user: u })} className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors" style={{ background: "#E8F3FB", color: "#1E6091" }}>View Transactions</button>
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && users.length === 0 && (
                <tr>
                  <td colSpan="5" className="text-center py-16 text-sm" style={{ color: "#5B7285" }}>No users yet.</td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td colSpan="5" className="text-center py-16 text-sm" style={{ color: "#5B7285" }}>Loading users...</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modal?.type === "credit" && (
        <CreditUserWalletModal
          user={modal.user}
          partnerBalance={wallet?.balance}
          onClose={closeModal}
          onCredited={() => {
            loadWallet();
            loadUsers();
            closeModal();
            showToast(`Credited ${modal.user.full_name}'s wallet`);
          }}
        />
      )}
      {modal?.type === "history" && <UserWalletHistoryModal user={modal.user} onClose={closeModal} />}
    </div>
  );
};

export default PartnerUserWallets;

