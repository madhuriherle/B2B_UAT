import { useEffect, useState } from "react";
import { apiRequest } from "../lib/api";
import { useConfirm } from "../components/ConfirmProvider";


const card = { background: "#fff", border: "1px solid #D8E6F0" };

const SERIES_LABELS = {
  invoice: "Invoice Number",
  reimbursement: "Reimbursement Number",
  receipt: "Receipt Number",
};

const formatDate = (value) =>
  value ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "-";

const AccountsInvoiceSettings = () => {
  const { confirm, alert } = useConfirm();
  const [series, setSeries] = useState([]);
  const [activeFinancialYear, setActiveFinancialYear] = useState(null);
  const [financialYears, setFinancialYears] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingSeries, setSavingSeries] = useState(null);
  const [newFyStartYear, setNewFyStartYear] = useState("");
  const [addingFy, setAddingFy] = useState(false);
  const [activatingFyId, setActivatingFyId] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4500);
  };

  const loadAll = () => {
    setLoading(true);
    Promise.all([
      apiRequest("/api/accounts/invoice-settings"),
      apiRequest("/api/accounts/financial-years"),
    ])
      .then(([settingsRes, fyRes]) => {
        setSeries(settingsRes.series || []);
        setActiveFinancialYear(settingsRes.active_financial_year || null);
        setFinancialYears(fyRes || []);
      })
      .catch((err) => showToast(err.message, "error"))
      .finally(() => setLoading(false));
  };

  useEffect(loadAll, []);

  const updateSeriesField = (seriesKey, field, value) => {
    setSeries((prev) => prev.map((s) => (s.series_key === seriesKey ? { ...s, [field]: value } : s)));
  };

  const handleSaveSeries = async (seriesKey) => {
    const row = series.find((s) => s.series_key === seriesKey);
    if (!row.prefix || !row.prefix.trim()) {
      showToast("Prefix is required", "error");
      return;
    }
    setSavingSeries(seriesKey);
    try {
      await apiRequest(`/api/accounts/invoice-settings/${seriesKey}`, {
        method: "PUT",
        body: JSON.stringify({ prefix: row.prefix.trim(), use_financial_year: row.use_financial_year }),
      });
      showToast(`${SERIES_LABELS[seriesKey]} settings saved`);
      loadAll();
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setSavingSeries(null);
    }
  };

  const handleAddFinancialYear = async () => {
    const startYear = parseInt(newFyStartYear, 10);
    if (!startYear || startYear < 2000 || startYear > 2100) {
      showToast("Enter a valid starting year, e.g. 2027 for FY 2027-28", "error");
      return;
    }
    setAddingFy(true);
    try {
      await apiRequest("/api/accounts/financial-years", {
        method: "POST",
        body: JSON.stringify({ start_year: startYear }),
      });
      setNewFyStartYear("");
      showToast("Financial year added");
      loadAll();
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setAddingFy(false);
    }
  };

  const handleActivateFinancialYear = async (fy) => {
    if (fy.is_active) return;
    if (!await confirm(`Set ${fy.label} as the Active Financial Year? Invoice/Reimbursement/Receipt numbering will continue from ${fy.label}'s own last number.`)) return;
    setActivatingFyId(fy.id);
    try {
      await apiRequest(`/api/accounts/financial-years/${fy.id}/activate`, { method: "POST" });
      showToast(`${fy.label} is now the Active Financial Year`);
      loadAll();
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setActivatingFyId(null);
    }
  };

  if (loading) {
    return <p className="text-sm" style={{ color: "#5B7285" }}>Loading invoice settings...</p>;
  }

  return (
    <div>
      {toast && (
        <div className="fixed top-5 right-5 z-50 px-5 py-3 rounded-xl text-sm font-semibold shadow-lg text-white transition-all max-w-xl" style={{ background: toast.type === "error" ? "#176B87" : "#16A34A" }}>
          {toast.msg}
        </div>
      )}

      <div className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: "#0f172a" }}>Invoice Settings</h1>
        <p className="text-sm mt-1" style={{ color: "#5B7285" }}>
          Configure how Invoice, Reimbursement and Receipt numbers are generated, and which Financial Year they're currently numbered under.
        </p>
      </div>

      <div className="rounded-2xl p-6 mb-6" style={card}>
        <h2 className="text-base font-bold mb-1" style={{ color: "#0f172a" }}>Numbering Series</h2>
        <p className="text-xs mb-4" style={{ color: "#5B7285" }}>
          Each series has its own prefix and its own running number. When "Financial year based numbering" is on, the number also carries the Active Financial Year's digits and resumes from that FY's own last-used number if you switch back to it later.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {series.map((s) => (
            <div key={s.series_key} className="rounded-xl p-4" style={{ background: "#F3F8FB", border: "1px solid #D8E6F0" }}>
              <p className="text-sm font-bold mb-3" style={{ color: "#0f172a" }}>{SERIES_LABELS[s.series_key] || s.series_key}</p>
              <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#5B7285" }}>Prefix</label>
              <input
                type="text"
                value={s.prefix}
                onChange={(e) => updateSeriesField(s.series_key, "prefix", e.target.value)}
                maxLength={20}
                className="w-full px-3 py-2 text-sm rounded-lg outline-none mb-3"
                style={{ background: "#fff", border: "1px solid #D8E6F0", color: "#1e293b" }}
              />
              <label className="flex items-center gap-2 mb-4 text-sm font-medium cursor-pointer" style={{ color: "#1e293b" }}>
                <input
                  type="checkbox"
                  checked={s.use_financial_year}
                  onChange={(e) => updateSeriesField(s.series_key, "use_financial_year", e.target.checked)}
                  className="h-4 w-4"
                />
                Financial year based numbering
              </label>
              <button
                onClick={() => handleSaveSeries(s.series_key)}
                disabled={savingSeries === s.series_key}
                className="w-full px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60"
                style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}
              >
                {savingSeries === s.series_key ? "Saving..." : "Save"}
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl p-6" style={card}>
        <div className="flex items-start justify-between gap-3 mb-1">
          <h2 className="text-base font-bold" style={{ color: "#0f172a" }}>Financial Year</h2>
        </div>
        <p className="text-xs mb-4" style={{ color: "#5B7285" }}>
          Exactly one Financial Year is Active at a time — every series with "Financial year based numbering" on numbers against whichever one that is.
          {activeFinancialYear && (
            <> Currently active: <span className="font-semibold" style={{ color: "#16A34A" }}>{activeFinancialYear.label}</span>.</>
          )}
        </p>

        <div className="flex items-end gap-3 mb-5">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#5B7285" }}>Starting Year</label>
            <input
              type="number"
              placeholder="e.g. 2027"
              value={newFyStartYear}
              onChange={(e) => setNewFyStartYear(e.target.value)}
              className="w-40 px-3 py-2 text-sm rounded-lg outline-none"
              style={{ background: "#F3F8FB", border: "1px solid #D8E6F0", color: "#1e293b" }}
            />
          </div>
          <button
            onClick={handleAddFinancialYear}
            disabled={addingFy}
            className="px-5 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60"
            style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}
          >
            {addingFy ? "Adding..." : "+ Add New Financial Year"}
          </button>
        </div>

        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid #D8E6F0" }}>
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "#F3F8FB" }}>
                <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase" style={{ color: "#5B7285" }}>Financial Year</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase" style={{ color: "#5B7285" }}>Status</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase" style={{ color: "#5B7285" }}>Added</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {financialYears.map((fy) => (
                <tr key={fy.id} className="border-t" style={{ borderColor: "#E2EBF4" }}>
                  <td className="px-4 py-3 font-semibold" style={{ color: "#1e293b" }}>{fy.label}</td>
                  <td className="px-4 py-3">
                    {fy.is_active ? (
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold" style={{ background: "#E6F5EA", color: "#16A34A" }}>Active</span>
                    ) : (
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold" style={{ background: "#E2EBF4", color: "#5B7285" }}>Inactive</span>
                    )}
                  </td>
                  <td className="px-4 py-3" style={{ color: "#5B7285" }}>{formatDate(fy.created_at)}</td>
                  <td className="px-4 py-3 text-right">
                    {!fy.is_active && (
                      <button
                        onClick={() => handleActivateFinancialYear(fy)}
                        disabled={activatingFyId === fy.id}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-60"
                        style={{ background: "#E8F3FB", color: "#1E6091" }}
                      >
                        {activatingFyId === fy.id ? "Setting..." : "Set Active"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {financialYears.length === 0 && (
                <tr>
                  <td colSpan="4" className="text-center py-8" style={{ color: "#5B7285" }}>No financial years added yet</td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AccountsInvoiceSettings;
