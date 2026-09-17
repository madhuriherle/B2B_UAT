import { useEffect, useState } from "react";
import { apiRequest } from "../../lib/api";
import Modal from "../../components/Modal";

const inputClass = "px-3 py-2 text-sm rounded-xl outline-none";
const inputStyle = { background: "#F3F8FB", border: "1px solid #D8E6F0", color: "#1e293b" };

const STATUS_BADGE = {
  completed: { bg: "#E6F5EA", color: "#3D7A1F", label: "Completed" },
  in_progress: { bg: "#FEF3C7", color: "#92400E", label: "In Progress" },
  review: { bg: "#E8F3FB", color: "#1E6091", label: "Review" },
  editing: { bg: "#EFE8FB", color: "#6B21A8", label: "Editing" },
};

const Badge = ({ value }) => {
  const s = STATUS_BADGE[value] || { bg: "#E2EBF4", color: "#5B7285", label: value || "-" };
  return <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap" style={{ background: s.bg, color: s.color }}>{s.label}</span>;
};

const DetailModal = ({ userDocId, onClose }) => {
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    apiRequest(`/api/admin/user-docs/${userDocId}`).then(setDetail).catch(() => setDetail(null));
  }, [userDocId]);

  return (
    <Modal title={detail ? detail.doc_type : "Loading..."} subtitle={`Order #${userDocId} · ${detail?.user_name || ""}`} onClose={onClose} width="max-w-2xl">
      {!detail ? (
        <p className="text-sm" style={{ color: "#5B7285" }}>Loading...</p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><span style={{ color: "#94A3B8" }}>Customer: </span><span style={{ color: "#1e293b" }}>{detail.user_name} ({detail.user_email})</span></div>
            <div><span style={{ color: "#94A3B8" }}>Language: </span><span style={{ color: "#1e293b" }} className="capitalize">{detail.language}</span></div>
            <div><span style={{ color: "#94A3B8" }}>Created: </span><span style={{ color: "#1e293b" }}>{detail.created_at}</span></div>
            <div><span style={{ color: "#94A3B8" }}>Modified: </span><span style={{ color: "#1e293b" }}>{detail.modified_at}</span></div>
          </div>
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid #D8E6F0" }}>
            <div className="overflow-x-auto">
            <table className="w-full">
              <tbody>
                {detail.fields.length === 0 ? (
                  <tr><td className="px-4 py-6 text-center text-sm" style={{ color: "#94A3B8" }}>No fields filled in yet.</td></tr>
                ) : (
                  detail.fields.map((f, i) => (
                    <tr key={i} className="border-t" style={{ borderColor: "#EEF3F8" }}>
                      <td className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide w-1/3" style={{ color: "#5B7285", background: "#F3F8FB" }}>{f.label}</td>
                      <td className="px-4 py-2.5 text-sm" style={{ color: "#1e293b" }}>{f.value}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
};

const AdminUserDocsTab = () => {
  const [docs, setDocs] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [viewingId, setViewingId] = useState(null);

  const loadDocs = (overrides = {}) => {
    setLoading(true);
    const statusValue = overrides.status ?? status;
    const searchValue = overrides.search ?? search;
    const params = new URLSearchParams({ limit: "50" });
    if (statusValue !== "all") params.set("status", statusValue);
    if (searchValue.trim()) params.set("search", searchValue.trim());
    apiRequest(`/api/admin/user-docs?${params.toString()}`)
      .then((data) => {
        setDocs(data.docs || []);
        setTotal(data.total || 0);
      })
      .catch(() => {
        setDocs([]);
        setTotal(0);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadDocs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const handleSearch = (e) => {
    e.preventDefault();
    loadDocs();
  };

  const handleSearchChange = (e) => {
    const value = e.target.value;
    setSearch(value);
    if (value.trim() === "" && search.trim() !== "") {
      loadDocs({ search: "" });
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: "#0f172a" }}>User Documents</h1>
        <p className="text-sm mt-1" style={{ color: "#5B7285" }}>{total} in-progress and completed B2C document forms</p>
      </div>

      <form onSubmit={handleSearch} className="rounded-2xl p-4 mb-5 flex flex-wrap gap-3 items-center" style={{ background: "#fff", border: "1px solid #D8E6F0" }}>
        <input value={search} onChange={handleSearchChange} placeholder="Search by name, email, or order ID..." className={`flex-1 min-w-48 ${inputClass}`} style={inputStyle} />
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputClass} style={inputStyle}>
          {["all", "in_progress", "review", "editing", "completed"].map((s) => (
            <option key={s} value={s}>{s === "all" ? "All Statuses" : s.replace("_", " ")}</option>
          ))}
        </select>
        <button type="submit" className="px-5 py-2 rounded-xl text-sm font-semibold text-white" style={{ background: "#1E6091" }}>Search</button>
      </form>

      <div className="rounded-2xl overflow-hidden" style={{ background: "#fff", border: "1px solid #D8E6F0", boxShadow: "0 8px 24px rgba(30,96,145,0.1)" }}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ background: "#F3F8FB" }}>
                {["Order ID", "Customer", "Document", "Preview", "Status", "Modified", "Actions"].map((h) => (
                  <th key={h} className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: "#5B7285" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="text-center py-12 text-sm" style={{ color: "#5B7285" }}>Loading...</td></tr>
              ) : docs.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-12 text-sm" style={{ color: "#5B7285" }}>No documents found.</td></tr>
              ) : (
                docs.map((d) => (
                  <tr key={d.user_doc_id} className="border-t" style={{ borderColor: "#EEF3F8" }}>
                    <td className="px-5 py-3 text-sm font-mono font-semibold" style={{ color: "#6B21A8" }}>#{d.user_doc_id}</td>
                    <td className="px-5 py-3 text-sm" style={{ color: "#1e293b" }}>
                      <p className="font-semibold">{d.user_name}</p>
                      <p className="text-xs" style={{ color: "#94A3B8" }}>{d.user_email}</p>
                    </td>
                    <td className="px-5 py-3 text-sm" style={{ color: "#5B7285" }}>{d.doc_type}</td>
                    <td className="px-5 py-3 text-sm" style={{ color: "#5B7285" }}>{d.preview}</td>
                    <td className="px-5 py-3"><Badge value={d.status} /></td>
                    <td className="px-5 py-3 text-sm whitespace-nowrap" style={{ color: "#94A3B8" }}>{d.modified_at}</td>
                    <td className="px-5 py-3">
                      <button onClick={() => setViewingId(d.user_doc_id)} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: "#E8F3FB", color: "#1E6091" }}>View</button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {viewingId && <DetailModal userDocId={viewingId} onClose={() => setViewingId(null)} />}
    </div>
  );
};

export default AdminUserDocsTab;
