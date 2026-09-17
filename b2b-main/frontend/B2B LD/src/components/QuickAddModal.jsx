import { useState } from "react";

const inputStyle = { background: "#F3F8FB", border: "1px solid #D8E6F0", color: "#1e293b", width: "100%", padding: "10px 14px", borderRadius: "10px", fontSize: "14px", outline: "none" };

const QuickAddModal = ({ title, nameLabel, namePlaceholder, showDescription = false, onClose, onSave }) => {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) {
      setError(`${nameLabel} is required`);
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave({ name: name.trim(), description: description.trim() || null });
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,0.5)", backdropFilter: "blur(4px)" }}>
      <div className="w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl" style={{ background: "#fff" }}>
        <div className="px-6 py-5 border-b flex items-center justify-between" style={{ borderColor: "#E2EBF4" }}>
          <h2 className="text-lg font-bold" style={{ color: "#0f172a" }}>{title}</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors" style={{ background: "#E2EBF4", color: "#5B7285" }}>✕</button>
        </div>

        <div className="p-6 space-y-4">
          {error && (
            <div className="rounded-lg px-4 py-3 text-sm font-semibold" style={{ background: "#E8F3FB", color: "#1E6091" }}>{error}</div>
          )}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#5B7285" }}>{nameLabel} *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={namePlaceholder}
              style={inputStyle}
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
            />
          </div>
          {showDescription && (
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#5B7285" }}>Description</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} style={{ ...inputStyle, resize: "none" }} placeholder="Optional" />
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t flex gap-3 justify-end" style={{ borderColor: "#E2EBF4", background: "#F3F8FB" }}>
          <button onClick={onClose} className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors" style={{ background: "#fff", border: "1px solid #D8E6F0", color: "#5B7285" }}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving} className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default QuickAddModal;
