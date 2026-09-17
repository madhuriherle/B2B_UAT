import { useEffect, useState } from "react";
import { apiRequest } from "../../lib/api";

const inputClass = "w-full px-4 py-2.5 text-sm rounded-xl outline-none transition-all";
const inputStyle = { background: "#F3F8FB", border: "1px solid #D8E6F0", color: "#1e293b" };

const Field = ({ label, children }) => (
  <div>
    <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#5B7285" }}>{label}</label>
    {children}
  </div>
);

const AdminStatesTab = () => {
  const [states, setStates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stateVal, setStateVal] = useState("");
  const [langVal, setLangVal] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [editingId, setEditingId] = useState(null);

  const loadAll = () => {
    apiRequest("/api/admin/states")
      .then((data) => setStates(data || []))
      .catch(() => setStates([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadAll();
  }, []);

  const resetForm = () => {
    setEditingId(null);
    setStateVal("");
    setLangVal("");
  };

  const handleSave = async () => {
    if (!stateVal.trim()) {
      setError("State name is required");
      return;
    }
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      if (editingId) {
        await apiRequest(`/api/admin/states/${editingId}`, {
          method: "PUT",
          body: JSON.stringify({ state_name: stateVal.trim(), language_name: langVal.trim() }),
        });
        setSuccess("Updated successfully!");
      } else {
        await apiRequest("/api/admin/states", {
          method: "POST",
          body: JSON.stringify({ state_name: stateVal.trim(), language_name: langVal.trim(), is_active: true }),
        });
        setSuccess("Saved successfully!");
      }
      resetForm();
      loadAll();
    } catch (err) {
      setError(err.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const deleteState = async (id) => {
    try {
      await apiRequest(`/api/admin/states/${id}`, { method: "DELETE" });
      loadAll();
    } catch (err) {
      setError(err.message || "Delete failed");
    }
  };

  const startEdit = (s) => {
    setEditingId(s.id);
    setStateVal(s.state_name);
    setLangVal(s.language_name || "");
    setError("");
    setSuccess("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: "#0f172a" }}>States</h1>
        <p className="text-sm mt-1" style={{ color: "#5B7285" }}>Manage the states and languages served across the B2C catalog</p>
      </div>

      <div className="rounded-2xl p-6 mb-6" style={{ background: "#fff", border: "1px solid #D8E6F0", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        <h2 className="text-base font-bold mb-4" style={{ color: "#0f172a" }}>{editingId ? "Edit State & Language" : "Add State & Language"}</h2>
        {error && <p className="text-xs font-medium mb-3 px-3 py-2 rounded-lg" style={{ background: "#FDECEC", color: "#C0392B" }}>{error}</p>}
        {success && <p className="text-xs font-medium mb-3 px-3 py-2 rounded-lg" style={{ background: "#E6F5EA", color: "#3D7A1F" }}>{success}</p>}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <Field label="State Name">
            <input value={stateVal} onChange={(e) => setStateVal(e.target.value)} placeholder="e.g. Karnataka" className={inputClass} style={inputStyle} />
          </Field>
          <Field label="Language Name">
            <input value={langVal} onChange={(e) => setLangVal(e.target.value)} placeholder="e.g. Kannada" className={inputClass} style={inputStyle} />
          </Field>
        </div>
        <div className="flex gap-2">
          <button onClick={handleSave} disabled={saving} className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>
            {saving ? "Saving..." : editingId ? "Update" : "Save"}
          </button>
          {editingId && (
            <button onClick={resetForm} className="px-5 py-2.5 rounded-xl text-sm font-semibold" style={{ background: "#E2EBF4", color: "#334155" }}>Cancel</button>
          )}
        </div>
      </div>

      <div className="rounded-2xl overflow-hidden" style={{ background: "#fff", border: "1px solid #D8E6F0", boxShadow: "0 8px 24px rgba(30,96,145,0.1)" }}>
        <div className="h-1.5" style={{ background: "linear-gradient(90deg, #1E6091, #176B87, #16A34A)" }}></div>
        <div className="flex items-center gap-3 px-5 py-3.5 border-b" style={{ borderColor: "#D8E6F0", background: "#F3F8FB" }}>
          <span className="text-sm font-bold" style={{ color: "#0f172a" }}>States & Languages</span>
          <span className="ml-auto px-3 py-1 rounded-full text-xs font-bold" style={{ background: "#E8F3FB", color: "#1E6091" }}>{states.length}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ background: "#F3F8FB" }}>
                {["#", "State", "Language", "Actions"].map((h) => (
                  <th key={h} className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: "#5B7285" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={4} className="text-center py-12 text-sm" style={{ color: "#5B7285" }}>Loading...</td></tr>
              ) : states.length === 0 ? (
                <tr><td colSpan={4} className="text-center py-12 text-sm" style={{ color: "#5B7285" }}>No entries yet. Add your first state above.</td></tr>
              ) : (
                states.map((s, i) => (
                  <tr key={s.id} className="border-t transition-colors hover:bg-[#F3F8FB]" style={{ borderColor: "#EEF3F8" }}>
                    <td className="px-5 py-3 text-xs font-semibold" style={{ color: "#94A3B8" }}>{i + 1}</td>
                    <td className="px-5 py-3 text-sm font-semibold" style={{ color: "#1e293b" }}>{s.state_name}</td>
                    <td className="px-5 py-3 text-sm" style={{ color: "#5B7285" }}>{s.language_name || "-"}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => startEdit(s)} className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors hover:opacity-80" style={{ background: "#E6F5EA", color: "#3D7A1F" }}>Edit</button>
                        <button onClick={() => deleteState(s.id)} className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors hover:opacity-80" style={{ background: "#FDECEC", color: "#C0392B" }}>Delete</button>
                      </div>
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

export default AdminStatesTab;
