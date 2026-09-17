import { useState } from "react";
import { apiRequest } from "../lib/api";

// Generic Cancel Order confirmation — Super Admin only (see OrderReports.jsx,
// the one place this is used). Requires a reason for audit/history, and the
// confirm button stays disabled until one is entered.
const CancelOrderModal = ({ order, onClose, onCancelled }) => {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const handleConfirm = async () => {
    setError("");
    setSaving(true);
    try {
      await apiRequest(`/api/reports/orders/${order.id}/cancel`, {
        method: "POST",
        body: JSON.stringify({ reason: reason.trim() }),
      });
      onCancelled();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,0.5)", backdropFilter: "blur(4px)" }} onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl overflow-hidden shadow-2xl" style={{ background: "#fff" }} onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-5 border-b" style={{ borderColor: "#E2EBF4" }}>
          <h2 className="text-lg font-bold" style={{ color: "#0f172a" }}>Cancel Order</h2>
          <p className="text-xs mt-0.5" style={{ color: "#5B7285" }}>{order.order_no}</p>
        </div>

        <div className="px-6 py-5 space-y-4">
          <p className="text-sm" style={{ color: "#334155" }}>Are you sure you want to cancel this order?</p>

          {error && (
            <p className="text-xs font-medium px-3 py-2 rounded-lg" style={{ background: "#FDECEC", color: "#C0392B" }}>{error}</p>
          )}

          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: "#5B7285" }}>Reason for cancellation *</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Enter reason..."
              rows={3}
              className="w-full px-3 py-2.5 text-sm rounded-xl outline-none resize-none"
              style={{ background: "#F3F8FB", border: "1px solid #D8E6F0", color: "#1e293b" }}
            />
          </div>
        </div>

        <div className="px-6 py-4 border-t flex justify-end gap-2" style={{ borderColor: "#E2EBF4", background: "#F3F8FB" }}>
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-60"
            style={{ background: "#fff", border: "1px solid #D8E6F0", color: "#5B7285" }}
          >
            Keep Order
          </button>
          <button
            onClick={handleConfirm}
            disabled={!reason.trim() || saving}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ background: "#C0392B" }}
          >
            {saving ? "Cancelling..." : "Cancel Order"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CancelOrderModal;
