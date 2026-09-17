import { useEffect, useState } from "react";
import { apiRequest } from "../lib/api";

const card = { background: "#fff", border: "1px solid #D8E6F0" };

const formatDateTime = (value) =>
  value
    ? new Date(value).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : null;

const AccountsInvoiceTerms = () => {
  const [content, setContent] = useState("");
  const [updatedAt, setUpdatedAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4500);
  };

  useEffect(() => {
    apiRequest("/api/accounts/terms")
      .then((res) => {
        setContent(res.content || "");
        setUpdatedAt(res.updated_at || null);
      })
      .catch((err) => showToast(err.message, "error"))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await apiRequest("/api/accounts/terms", {
        method: "PUT",
        body: JSON.stringify({ content }),
      });
      setUpdatedAt(res.updated_at || null);
      showToast("Terms & Condition saved");
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setSaving(false);
    }
  };

  const previewLines = content.split("\n").map((l) => l.trim()).filter(Boolean);

  return (
    <div>
      {toast && (
        <div className="fixed top-5 right-5 z-50 px-5 py-3 rounded-xl text-sm font-semibold shadow-lg text-white transition-all max-w-xl" style={{ background: toast.type === "error" ? "#176B87" : "#16A34A" }}>
          {toast.msg}
        </div>
      )}

      <div className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: "#0f172a" }}>Terms & Condition</h1>
        <p className="text-sm mt-1" style={{ color: "#5B7285" }}>
          Shown as the "Terms &amp; Condition" section on every generated Invoice, Reimbursement and Receipt PDF. One line per bullet point.
        </p>
      </div>

      {loading ? (
        <p className="text-sm" style={{ color: "#5B7285" }}>Loading...</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-2xl p-6" style={card}>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#5B7285" }}>Content</label>
              {updatedAt && <span className="text-xs" style={{ color: "#94A3B8" }}>Last updated {formatDateTime(updatedAt)}</span>}
            </div>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={12}
              placeholder={"One bullet per line, e.g.\nThis is not a service charge, but a direct pass-through of a statutory obligation borne on your behalf."}
              className="w-full px-3 py-2.5 text-sm rounded-lg outline-none resize-y"
              style={{ background: "#F3F8FB", border: "1px solid #D8E6F0", color: "#1e293b" }}
            />
            <div className="flex justify-end mt-4">
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
                style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>

          <div className="rounded-2xl p-6" style={card}>
            <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "#5B7285" }}>Preview on invoice PDF</p>
            <div className="rounded-xl p-4" style={{ background: "#F3F8FB", border: "1px solid #D8E6F0" }}>
              <p className="text-sm font-bold mb-2" style={{ color: "#0f172a" }}>Terms & Condition</p>
              {previewLines.length === 0 ? (
                <p className="text-xs" style={{ color: "#94A3B8" }}>Nothing to show yet — type a line on the left.</p>
              ) : (
                <div className="space-y-1">
                  {previewLines.map((line, i) => (
                    <p key={i} className="text-xs" style={{ color: "#334155" }}>- {line}</p>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AccountsInvoiceTerms;
