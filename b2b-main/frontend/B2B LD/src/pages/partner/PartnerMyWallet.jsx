import { useEffect, useState } from "react";
import { apiRequest } from "../../lib/api";
import { formatCurrency } from "../../lib/format";

const card = { background: "#fff", border: "1px solid #D8E6F0", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" };

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
            {["Date", "Type", "Amount", "Description", "Balance After Transaction"].map((h) => (
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
              <td className="px-4 py-2.5 text-sm" style={{ color: "#5B7285" }}>{t.description || "-"}</td>
              <td className="px-4 py-2.5 text-sm" style={{ color: "#1e293b" }}>{formatCurrency(t.balance_after)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );

const PartnerMyWallet = () => {
  const [wallet, setWallet] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiRequest("/api/partner/wallet")
      .then(setWallet)
      .catch(() => setWallet(null))
      .finally(() => setLoading(false));
  }, []);

  const cards = [
    { label: "Current Balance", value: wallet?.balance, color: "#1E6091" },
    { label: "Total Credits", value: wallet?.total_credits, color: "#3D7A1F" },
    { label: "Total Debits", value: wallet?.total_debits, color: "#1E6091" },
    { label: "Available Balance", value: wallet?.balance, color: "#1E6091" },
  ];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: "#0f172a" }}>My Wallet</h1>
        <p className="text-sm mt-1" style={{ color: "#5B7285" }}>Balance given by Super Admin — view only</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        {cards.map((c) => (
          <div key={c.label} className="rounded-2xl p-5" style={card}>
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#5B7285" }}>{c.label}</p>
            <p className="text-2xl font-bold mt-1.5" style={{ color: c.color }}>{loading ? "..." : formatCurrency(c.value)}</p>
          </div>
        ))}
      </div>

      <section className="rounded-2xl p-6" style={card}>
        <h2 className="text-base font-bold mb-4" style={{ color: "#0f172a" }}>Transaction History</h2>
        {loading ? <p className="text-sm" style={{ color: "#5B7285" }}>Loading...</p> : <TransactionTable transactions={wallet?.transactions} />}
      </section>
    </div>
  );
};

export default PartnerMyWallet;

