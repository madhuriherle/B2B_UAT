import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "../../lib/api";
import { formatCurrency } from "../../lib/format";
import { theme, serif, card } from "../../lib/userPortalTheme";

const formatDate = (value) =>
  value ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "-";

const inputStyle = { background: theme.bg, border: `1px solid ${theme.border}`, color: "#1e293b" };
const inputClass = "w-full px-3 py-2.5 text-sm rounded outline-none";

// Every wallet debit/credit description follows a "... · <what it was for>"
// convention (see partner.py's _debit_wallet call sites — "Order ORD-000065
// · eStamp Bulk · Stamp Value", "... · Service Charge", "... · Delivery
// Charge", etc.) — there's no separate structured transaction-type column on
// wallet_transactions, so the filter derives one from the description's
// last segment instead of requiring a schema/backend change for it.
const deriveTxnType = (description) => {
  if (!description) return "Other";
  const parts = description.split("·").map((p) => p.trim()).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : description;
};

const TransactionTable = ({ transactions }) =>
  !transactions?.length ? (
    <p className="text-sm" style={{ color: theme.slate }}>No transactions match these filters.</p>
  ) : (
    <div className="rounded overflow-hidden" style={{ border: `1px solid ${theme.border}` }}>
      <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr style={{ background: theme.bg }}>
            {["Date", "Description", "Type", "Amount", "Running Balance"].map((h) => (
              <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold uppercase" style={{ color: theme.slate }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {transactions.map((t) => (
            <tr key={t.id} className="border-t" style={{ borderColor: theme.border }}>
              <td className="px-4 py-2.5 text-sm whitespace-nowrap" style={{ color: theme.slate }}>{formatDate(t.created_at)}</td>
              <td className="px-4 py-2.5 text-sm" style={{ color: theme.ink }}>{t.description || "-"}</td>
              <td className="px-4 py-2.5">
                <span
                  className="text-xs font-semibold px-2.5 py-1 rounded capitalize"
                  style={t.type === "credit"
                    ? { background: theme.successSoft, color: theme.success, border: `1px solid ${theme.success}33` }
                    : { background: theme.dangerSoft, color: theme.danger, border: `1px solid ${theme.danger}33` }}
                >
                  {t.type}
                </span>
              </td>
              <td className="px-4 py-2.5 text-sm font-semibold" style={{ color: t.type === "credit" ? theme.success : theme.ink }}>
                {t.type === "credit" ? "+ " : "− "}{formatCurrency(t.amount)}
              </td>
              <td className="px-4 py-2.5 text-sm font-semibold" style={{ color: theme.ink }}>{formatCurrency(t.balance_after)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );

const PartnerUserWallet = () => {
  const [wallet, setWallet] = useState(null);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [directionFilter, setDirectionFilter] = useState("");
  const [txnTypeFilter, setTxnTypeFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  useEffect(() => {
    apiRequest("/api/partner-user/wallet")
      .then(setWallet)
      .catch(() => setWallet(null))
      .finally(() => setLoading(false));
  }, []);

  // Already newest-first from the backend (ORDER BY created_at DESC, see
  // partner_user.get_my_wallet) — filtering below never re-sorts it.
  const transactions = useMemo(() => wallet?.transactions || [], [wallet]);

  const txnTypeOptions = useMemo(
    () => Array.from(new Set(transactions.map((t) => deriveTxnType(t.description)))).sort(),
    [transactions]
  );

  const filtered = transactions.filter((t) => {
    const query = search.trim().toLowerCase();
    if (query && !(t.description || "").toLowerCase().includes(query)) return false;
    if (directionFilter && t.type !== directionFilter) return false;
    if (txnTypeFilter && deriveTxnType(t.description) !== txnTypeFilter) return false;
    const day = t.created_at ? t.created_at.slice(0, 10) : null;
    if (dateFrom && (!day || day < dateFrom)) return false;
    if (dateTo && (!day || day > dateTo)) return false;
    return true;
  });

  const clearFilters = () => {
    setSearch("");
    setDirectionFilter("");
    setTxnTypeFilter("");
    setDateFrom("");
    setDateTo("");
  };
  const hasFilters = search || directionFilter || txnTypeFilter || dateFrom || dateTo;

  return (
    <div>
      <div className="mb-6 pb-4 border-b" style={{ borderColor: theme.border }}>
        <h1 className="text-2xl font-bold" style={{ color: theme.ink, fontFamily: serif }}>My Wallet</h1>
        <p className="text-sm mt-1" style={{ color: theme.slate }}>Balance funded by your partner — every order deducts from this automatically</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="rounded-lg p-5" style={card}>
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: theme.slate }}>Current Balance</p>
          <p className="text-2xl font-bold mt-1.5" style={{ color: theme.navy, fontFamily: serif }}>{loading ? "..." : formatCurrency(wallet?.balance)}</p>
        </div>
        <div className="rounded-lg p-5" style={card}>
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: theme.slate }}>Available Balance</p>
          <p className="text-2xl font-bold mt-1.5" style={{ color: theme.success, fontFamily: serif }}>{loading ? "..." : formatCurrency(wallet?.available_balance)}</p>
          <p className="text-xs mt-1" style={{ color: theme.slate }}>What a new order is checked against</p>
        </div>
        <div className="rounded-lg p-5" style={card}>
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: theme.slate }}>Blocked / Reserved</p>
          <p className="text-2xl font-bold mt-1.5" style={{ color: "#92400E", fontFamily: serif }}>{loading ? "..." : formatCurrency(wallet?.blocked_amount)}</p>
          <p className="text-xs mt-1" style={{ color: theme.slate }}>Held for orders not yet Completed</p>
        </div>
        <div className="rounded-lg p-5" style={card}>
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: theme.slate }}>Total Credited</p>
          <p className="text-2xl font-bold mt-1.5" style={{ color: theme.success, fontFamily: serif }}>{loading ? "..." : formatCurrency(wallet?.total_credits)}</p>
        </div>
        <div className="rounded-lg p-5" style={card}>
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: theme.slate }}>Total Debited</p>
          <p className="text-2xl font-bold mt-1.5" style={{ color: theme.danger, fontFamily: serif }}>{loading ? "..." : formatCurrency(wallet?.total_debits)}</p>
        </div>
      </div>

      <section className="rounded-lg p-6" style={card}>
        <h2 className="text-base font-bold mb-4" style={{ color: theme.ink, fontFamily: serif }}>Transaction History</h2>

        {!loading && transactions.length > 0 && (
          <div className="rounded p-4 mb-4" style={{ background: theme.bg, border: `1px solid ${theme.border}` }}>
            <div className="flex flex-wrap gap-3 items-end">
              <div className="flex-1 min-w-[180px]">
                <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: theme.slate }}>Search</label>
                <input type="text" placeholder="Order #, description..." value={search} onChange={(e) => setSearch(e.target.value)} className={inputClass} style={inputStyle} />
              </div>
              <div className="w-40">
                <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: theme.slate }}>Credit / Debit</label>
                <select value={directionFilter} onChange={(e) => setDirectionFilter(e.target.value)} className={inputClass} style={inputStyle}>
                  <option value="">All</option>
                  <option value="credit">Credit</option>
                  <option value="debit">Debit</option>
                </select>
              </div>
              <div className="w-48">
                <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: theme.slate }}>Transaction Type</label>
                <select value={txnTypeFilter} onChange={(e) => setTxnTypeFilter(e.target.value)} className={inputClass} style={inputStyle}>
                  <option value="">All Types</option>
                  {txnTypeOptions.map((t) => (<option key={t} value={t}>{t}</option>))}
                </select>
              </div>
              <div className="w-40">
                <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: theme.slate }}>From</label>
                <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={inputClass} style={inputStyle} />
              </div>
              <div className="w-40">
                <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: theme.slate }}>To</label>
                <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={inputClass} style={inputStyle} />
              </div>
            </div>
            {hasFilters && (
              <button onClick={clearFilters} className="mt-3 text-xs font-semibold" style={{ color: theme.navy }}>Clear filters</button>
            )}
          </div>
        )}

        {loading ? <p className="text-sm" style={{ color: theme.slate }}>Loading...</p> : <TransactionTable transactions={filtered} />}
      </section>
    </div>
  );
};

export default PartnerUserWallet;
