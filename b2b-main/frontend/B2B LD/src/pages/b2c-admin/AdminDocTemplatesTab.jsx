import { useEffect, useState } from "react";
import { apiRequest, apiUrl, getStoredToken } from "../../lib/api";
import Modal from "../../components/Modal";

const inputClass = "w-full px-4 py-2.5 text-sm rounded-xl outline-none";
const inputStyle = { background: "#F3F8FB", border: "1px solid #D8E6F0", color: "#1e293b" };

const Field = ({ label, children }) => (
  <div>
    <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#5B7285" }}>{label}</label>
    {children}
  </div>
);

const EditModal = ({ template, onClose, onSaved }) => {
  const [form, setForm] = useState({
    document_type: template?.document_type || "",
    language: template?.language || "english",
    template_content: template?.template_content || "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (template?.id) {
      apiRequest(`/api/admin/templates/${template.id}`).then((full) =>
        setForm({ document_type: full.document_type, language: full.language, template_content: full.template_content })
      );
    }
  }, [template]);

  const handleSave = async () => {
    if (!form.document_type.trim() || !form.template_content.trim()) {
      setError("Document type and content are required");
      return;
    }
    setLoading(true);
    setError("");
    try {
      if (template?.id) {
        await apiRequest(`/api/admin/templates/${template.id}`, { method: "PUT", body: JSON.stringify(form) });
      } else {
        await apiRequest("/api/admin/templates", { method: "POST", body: JSON.stringify(form) });
      }
      onSaved();
    } catch (err) {
      setError(err.message || "Save failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal title={template?.id ? "Edit Template" : "New Template"} onClose={onClose} width="max-w-2xl">
      {error && <p className="text-xs font-medium mb-3 px-3 py-2 rounded-lg" style={{ background: "#FDECEC", color: "#C0392B" }}>{error}</p>}
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Document Type Key">
            <input value={form.document_type} onChange={(e) => setForm({ ...form, document_type: e.target.value })} placeholder="e.g. name_change" className={inputClass} style={inputStyle} />
          </Field>
          <Field label="Language">
            <input value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })} className={inputClass} style={inputStyle} />
          </Field>
        </div>
        <Field label="Template Content (HTML/text)">
          <textarea value={form.template_content} onChange={(e) => setForm({ ...form, template_content: e.target.value })} rows={12} className={`${inputClass} font-mono`} style={{ ...inputStyle, resize: "vertical" }} />
        </Field>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="px-5 py-2.5 rounded-xl text-sm font-semibold" style={{ background: "#E2EBF4", color: "#334155" }}>Cancel</button>
        <button onClick={handleSave} disabled={loading} className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>
          {loading ? "Saving..." : "Save"}
        </button>
      </div>
    </Modal>
  );
};

const PreviewModal = ({ documentType, onClose }) => {
  const [html, setHtml] = useState(null);

  useEffect(() => {
    const token = getStoredToken();
    fetch(apiUrl(`/api/admin/template-preview/${documentType}`), {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => r.text())
      .then(setHtml)
      .catch(() => setHtml("<p>Failed to render preview.</p>"));
  }, [documentType]);

  return (
    <Modal title="Template Preview" subtitle={documentType} onClose={onClose} width="max-w-3xl">
      {html === null ? (
        <p className="text-sm" style={{ color: "#5B7285" }}>Rendering...</p>
      ) : (
        <iframe title="Template preview" srcDoc={html} className="w-full rounded-xl" style={{ height: "70vh", border: "1px solid #D8E6F0" }} />
      )}
    </Modal>
  );
};

const AdminDocTemplatesTab = () => {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);

  const loadTemplates = () => {
    setLoading(true);
    apiRequest("/api/admin/templates")
      .then((data) => setTemplates(data || []))
      .catch(() => setTemplates([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadTemplates();
  }, []);

  const handleDelete = async (id) => {
    try {
      await apiRequest(`/api/admin/templates/${id}`, { method: "DELETE" });
      loadTemplates();
    } catch {
      // no-op — row stays visible, admin can retry
    }
  };

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "#0f172a" }}>Document Templates</h1>
          <p className="text-sm mt-1" style={{ color: "#5B7285" }}>HTML templates used to generate B2C document content</p>
        </div>
        <button onClick={() => setModal({ type: "edit", template: null })} className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>
          New Template
        </button>
      </div>

      <div className="rounded-2xl overflow-hidden" style={{ background: "#fff", border: "1px solid #D8E6F0", boxShadow: "0 8px 24px rgba(30,96,145,0.1)" }}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ background: "#F3F8FB" }}>
                {["Document Type", "Language", "Preview", "Actions"].map((h) => (
                  <th key={h} className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: "#5B7285" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={4} className="text-center py-12 text-sm" style={{ color: "#5B7285" }}>Loading...</td></tr>
              ) : templates.length === 0 ? (
                <tr><td colSpan={4} className="text-center py-12 text-sm" style={{ color: "#5B7285" }}>No templates yet.</td></tr>
              ) : (
                templates.map((t) => (
                  <tr key={t.id} className="border-t" style={{ borderColor: "#EEF3F8" }}>
                    <td className="px-5 py-3 text-sm font-semibold" style={{ color: "#1e293b" }}>{t.document_type}</td>
                    <td className="px-5 py-3 text-sm capitalize" style={{ color: "#5B7285" }}>{t.language}</td>
                    <td className="px-5 py-3 text-sm max-w-sm truncate" style={{ color: "#94A3B8" }}>{t.preview}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => setModal({ type: "preview", documentType: t.document_type })} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: "#EFE8FB", color: "#6B21A8" }}>Preview</button>
                        <button onClick={() => setModal({ type: "edit", template: t })} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: "#E6F5EA", color: "#3D7A1F" }}>Edit</button>
                        <button onClick={() => handleDelete(t.id)} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: "#FDECEC", color: "#C0392B" }}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modal?.type === "edit" && (
        <EditModal template={modal.template} onClose={() => setModal(null)} onSaved={() => { setModal(null); loadTemplates(); }} />
      )}
      {modal?.type === "preview" && <PreviewModal documentType={modal.documentType} onClose={() => setModal(null)} />}
    </div>
  );
};

export default AdminDocTemplatesTab;
