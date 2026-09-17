import { useEffect, useState } from "react";
import { apiRequest } from "../../lib/api";

const formatDateTime = (value) =>
  value ? new Date(value).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "-";

const StatusBadge = ({ status }) => (
  <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-semibold" style={status === "open" ? { background: "#FEF3C7", color: "#92400E" } : { background: "#E6F5EA", color: "#3D7A1F" }}>
    {status === "open" ? "Open" : "Resolved"}
  </span>
);

const AdminSupportTab = () => {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [updatingId, setUpdatingId] = useState(null);

  const loadRequests = () => {
    setLoading(true);
    const params = filter !== "all" ? `?status=${filter}` : "";
    apiRequest(`/api/admin/support-requests${params}`)
      .then((data) => setRequests(data || []))
      .catch(() => setRequests([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const toggleStatus = async (req) => {
    const nextStatus = req.status === "open" ? "resolved" : "open";
    setUpdatingId(req.id);
    try {
      await apiRequest(`/api/admin/support-requests/${req.id}/status`, {
        method: "PUT",
        body: JSON.stringify({ status: nextStatus }),
      });
      loadRequests();
    } catch {
      // no-op — leave as-is, admin can retry
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: "#0f172a" }}>Support Requests</h1>
        <p className="text-sm mt-1" style={{ color: "#5B7285" }}>B2C customer support tickets</p>
      </div>

      <div className="flex gap-1 rounded-full p-1 mb-5 w-fit" style={{ background: "#F3F8FB", border: "1px solid #D8E6F0" }}>
        {["all", "open", "resolved"].map((s) => (
          <button key={s} onClick={() => setFilter(s)} className="px-4 py-1.5 rounded-full text-sm font-medium capitalize transition-all"
            style={filter === s ? { background: "#1E6091", color: "#fff" } : { color: "#5B7285" }}>
            {s}
          </button>
        ))}
      </div>

      <div className="rounded-2xl overflow-hidden" style={{ background: "#fff", border: "1px solid #D8E6F0", boxShadow: "0 8px 24px rgba(30,96,145,0.1)" }}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ background: "#F3F8FB" }}>
                {["Customer", "Order", "Message", "Status", "Received", "Actions"].map((h) => (
                  <th key={h} className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: "#5B7285" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="text-center py-12 text-sm" style={{ color: "#5B7285" }}>Loading...</td></tr>
              ) : requests.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-12 text-sm" style={{ color: "#5B7285" }}>No support requests found.</td></tr>
              ) : (
                requests.map((r) => (
                  <tr key={r.id} className="border-t" style={{ borderColor: "#EEF3F8" }}>
                    <td className="px-5 py-3 text-sm" style={{ color: "#1e293b" }}>
                      <p className="font-semibold">{r.user_name}</p>
                      <p className="text-xs" style={{ color: "#94A3B8" }}>{r.user_email}</p>
                    </td>
                    <td className="px-5 py-3 text-sm font-mono" style={{ color: "#5B7285" }}>{r.user_doc_id ? `#${r.user_doc_id}` : "-"}</td>
                    <td className="px-5 py-3 text-sm max-w-sm" style={{ color: "#1e293b" }}>{r.message}</td>
                    <td className="px-5 py-3"><StatusBadge status={r.status} /></td>
                    <td className="px-5 py-3 text-sm whitespace-nowrap" style={{ color: "#94A3B8" }}>{formatDateTime(r.created_at)}</td>
                    <td className="px-5 py-3">
                      <button onClick={() => toggleStatus(r)} disabled={updatingId === r.id} className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-60" style={{ background: "#E8F3FB", color: "#1E6091" }}>
                        Mark {r.status === "open" ? "Resolved" : "Open"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default AdminSupportTab;
