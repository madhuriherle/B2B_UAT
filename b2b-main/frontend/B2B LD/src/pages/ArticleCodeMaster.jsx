import { useEffect, useState } from "react";
import { apiRequest } from "../lib/api";
import { useConfirm } from "../components/ConfirmProvider";


const emptyForm = { stateId: "", articleCode: "", articleName: "" };

const tagIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12.586 2.586a2 2 0 0 0-2.828 0L2.586 9.757a2 2 0 0 0 0 2.829l8.828 8.828a2 2 0 0 0 2.828 0l7.172-7.171a2 2 0 0 0 0-2.829z" />
    <circle cx="7.5" cy="7.5" r="1.25" fill="currentColor" stroke="none" />
  </svg>
);

// Super Admin's master list of Article Codes an eStamp-type Bulk order picks
// from (see PartnerUserCreateEstampBulk.jsx / partner_user.list_my_article_codes).
// Configured per-state — the same code (e.g. "10") can mean a different
// article under a different state's Stamp Act, so uniqueness/lookup is
// scoped to state, not global (see backend/app/routes/article_codes.py).
const ArticleCodeMaster = () => {
  const { confirm, alert } = useConfirm();
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [codes, setCodes] = useState([]);
  const [states, setStates] = useState([]);
  const [stateFilter, setStateFilter] = useState("");
  const [formData, setFormData] = useState(emptyForm);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4500);
  };

  const load = () => {
    apiRequest("/api/article-codes").then(setCodes).catch(() => setCodes([]));
  };

  useEffect(load, []);
  useEffect(() => {
    apiRequest("/api/catalog/states").then(setStates).catch(() => setStates([]));
  }, []);

  const stateNameById = (id) => states.find((s) => String(s.id) === String(id))?.state_name;

  const visibleCodes = stateFilter ? codes.filter((c) => String(c.state_id) === String(stateFilter)) : codes;

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
    if (errors[name]) setErrors({ ...errors, [name]: "" });
  };

  const validate = () => {
    const e = {};
    if (!formData.stateId) e.stateId = "State is required";
    if (!formData.articleCode.trim()) e.articleCode = "Article Code is required";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const body = JSON.stringify({
        state_id: formData.stateId,
        article_code: formData.articleCode.trim(),
        description: formData.articleName.trim() || null,
      });
      if (editingId) {
        await apiRequest(`/api/article-codes/${editingId}`, { method: "PATCH", body });
      } else {
        await apiRequest("/api/article-codes", { method: "POST", body });
      }
      handleCloseModal();
      load();
      showToast(editingId ? "Article Code updated" : "Article Code added");
    } catch (err) {
      setErrors({ ...errors, general: err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (code) => {
    setEditingId(code.id);
    setFormData({ stateId: code.state_id || "", articleCode: code.article_code, articleName: code.description || "" });
    setErrors({});
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setEditingId(null);
    setFormData(emptyForm);
    setErrors({});
  };

  const handleDelete = async (id) => {
    if (!await confirm("Delete this Article Code?")) return;
    try {
      await apiRequest(`/api/article-codes/${id}`, { method: "DELETE" });
      setCodes(codes.filter((c) => c.id !== id));
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const inputStyle = { background: "#F3F8FB", border: "1px solid #D8E6F0", color: "#1e293b", width: "100%", padding: "10px 14px", borderRadius: "10px", fontSize: "14px", outline: "none" };
  const errorStyle = { ...inputStyle, border: "1px solid #176B87" };

  return (
    <div>
      {toast && (
        <div className="fixed top-5 right-5 z-50 px-5 py-3 rounded-xl text-sm font-semibold shadow-lg text-white transition-all max-w-xl" style={{ background: toast.type === "error" ? "#176B87" : "#16A34A" }}>
          {toast.msg}
        </div>
      )}

      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "#0f172a" }}>Article Codes</h1>
          <p className="text-sm mt-1" style={{ color: "#5B7285" }}>Master list used by eStamp-type Bulk orders — Partners pick from this list, scoped to their selected state</p>
        </div>
        <button onClick={() => setShowModal(true)} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>
          + Add Article Code
        </button>
      </div>

      <div className="mb-4 max-w-xs">
        <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#5B7285" }}>Filter by State</label>
        <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)} style={inputStyle}>
          <option value="">All States</option>
          {states.map((s) => (<option key={s.id} value={s.id}>{s.state_name}</option>))}
        </select>
      </div>

      <div className="rounded-2xl overflow-hidden" style={{ background: "#fff", border: "1px solid #D8E6F0", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ background: "#F3F8FB", borderBottom: "1px solid #D8E6F0" }}>
                {["State", "Article Code", "Article Name", "Actions"].map((h) => (
                  <th key={h} className="text-left px-5 py-3.5 text-xs font-semibold uppercase tracking-wider" style={{ color: "#5B7285" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleCodes.map((c) => (
                <tr key={c.id} className="border-t transition-colors hover:bg-slate-50/50" style={{ borderColor: "#E2EBF4" }}>
                  <td className="px-5 py-4"><span className="text-sm" style={{ color: "#334155" }}>{c.state_name || stateNameById(c.state_id) || "Unassigned"}</span></td>
                  <td className="px-5 py-4"><span className="text-sm font-bold" style={{ color: "#0f172a" }}>{c.article_code}</span></td>
                  <td className="px-5 py-4"><span className="text-sm" style={{ color: "#334155" }}>{c.description || "-"}</span></td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2">
                      <button onClick={() => handleEdit(c)} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: "#E6F5EA", color: "#3D7A1F" }}>Edit</button>
                      <button onClick={() => handleDelete(c.id)} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: "#E8F3FB", color: "#1E6091" }}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
              {visibleCodes.length === 0 && (
                <tr>
                  <td colSpan="4" className="text-center py-16">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: "#E2EBF4", color: "#5B7285" }}>{tagIcon}</div>
                      <p className="font-semibold" style={{ color: "#5B7285" }}>{stateFilter ? "No Article Codes for this state yet" : "No Article Codes yet"}</p>
                      <button onClick={() => setShowModal(true)} className="text-sm font-semibold px-4 py-2 rounded-xl text-white" style={{ background: "#1E6091" }}>Add your first Article Code</button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,0.5)", backdropFilter: "blur(4px)" }}>
          <div className="w-full max-w-md rounded-2xl overflow-hidden shadow-2xl" style={{ background: "#fff" }}>
            <div className="px-6 py-5 border-b flex items-center justify-between" style={{ borderColor: "#E2EBF4" }}>
              <div>
                <h2 className="text-lg font-bold" style={{ color: "#0f172a" }}>{editingId ? "Edit Article Code" : "Add Article Code"}</h2>
              </div>
              <button onClick={handleCloseModal} className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors" style={{ background: "#E2EBF4", color: "#5B7285" }}>✕</button>
            </div>

            <div className="p-6 space-y-4">
              {errors.general && (
                <div className="rounded-lg px-4 py-3 text-sm font-semibold" style={{ background: "#E8F3FB", color: "#1E6091" }}>{errors.general}</div>
              )}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#5B7285" }}>State *</label>
                <select name="stateId" value={formData.stateId} onChange={handleChange} style={errors.stateId ? errorStyle : inputStyle} autoFocus>
                  <option value="">Select State</option>
                  {states.map((s) => (<option key={s.id} value={s.id}>{s.state_name}</option>))}
                </select>
                {errors.stateId && <p className="text-xs mt-1" style={{ color: "#176B87" }}>{errors.stateId}</p>}
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#5B7285" }}>Article Code *</label>
                <input type="text" name="articleCode" value={formData.articleCode} onChange={handleChange} placeholder="e.g. 5(h)(A)(iv)" style={errors.articleCode ? errorStyle : inputStyle} />
                {errors.articleCode && <p className="text-xs mt-1" style={{ color: "#176B87" }}>{errors.articleCode}</p>}
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#5B7285" }}>Article Name</label>
                <input type="text" name="articleName" value={formData.articleName} onChange={handleChange} placeholder="e.g. Adoption Deed" style={inputStyle} />
              </div>
            </div>

            <div className="px-6 py-4 border-t flex gap-3 justify-end" style={{ borderColor: "#E2EBF4", background: "#F3F8FB" }}>
              <button onClick={handleCloseModal} className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors" style={{ background: "#fff", border: "1px solid #D8E6F0", color: "#5B7285" }}>
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving} className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>
                {saving ? "Saving..." : editingId ? "Update Article Code" : "Save Article Code"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ArticleCodeMaster;
