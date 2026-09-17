import { useEffect, useState } from "react";
import { apiRequest } from "../lib/api";
import { isValidMobile, isValidEmail, sanitizeMobileInput } from "../lib/validation";
import Modal from "../components/Modal";
import SuccessModal from "../components/SuccessModal";
import StatusBadge from "../components/StatusBadge";

const inputClass = "w-full px-4 py-2.5 text-sm rounded-xl outline-none transition-all disabled:cursor-not-allowed";
const inputStyle = { background: "#F3F8FB", border: "1px solid #D8E6F0", color: "#1e293b" };

const ALLOWED_SERVICES = ["eSign", "eStamp", "eKYC"];

const Field = ({ label, children }) => (
  <div>
    <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#5B7285" }}>{label}</label>
    {children}
  </div>
);

const BadgeList = ({ items }) =>
  !items?.length ? (
    <span style={{ color: "#cbd5e1" }}>—</span>
  ) : (
    <div className="flex flex-wrap gap-1 max-w-[220px]">
      {items.map((item) => (
        <span key={item} className="px-2 py-0.5 rounded-full text-xs font-semibold" style={{ background: "#E8F3FB", color: "#1E6091" }}>{item}</span>
      ))}
    </div>
  );

const emptyForm = {
  company_name: "",
  contact_person: "",
  email: "",
  mobile: "",
  callback_url: "",
  allowed_services: [],
  is_active: true,
};

const ApiClientModal = ({ client, onClose, onSaved }) => {
  const isEdit = Boolean(client);
  const [form, setForm] = useState(
    client
      ? {
          company_name: client.company_name || "",
          contact_person: client.contact_person || "",
          email: client.email || "",
          mobile: client.mobile || "",
          callback_url: client.callback_url || "",
          allowed_services: client.allowed_services || [],
          is_active: client.is_active,
        }
      : emptyForm
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm({ ...form, [name]: name === "mobile" ? sanitizeMobileInput(value) : value });
  };

  const toggleService = (service) => {
    setForm((prev) => ({
      ...prev,
      allowed_services: prev.allowed_services.includes(service)
        ? prev.allowed_services.filter((s) => s !== service)
        : [...prev.allowed_services, service],
    }));
  };

  const handleSubmit = async () => {
    if (!form.company_name || !form.contact_person || !form.email) {
      setError("Company name, contact person and email are required");
      return;
    }
    if (!isValidEmail(form.email)) {
      setError("Enter a valid email address");
      return;
    }
    if (form.mobile && !isValidMobile(form.mobile)) {
      setError("Mobile number must be exactly 10 digits");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const body = {
        company_name: form.company_name,
        contact_person: form.contact_person || null,
        email: form.email,
        mobile: form.mobile || null,
        callback_url: form.callback_url || null,
        allowed_services: form.allowed_services,
        is_active: form.is_active,
      };
      const saved = isEdit
        ? await apiRequest(`/api/api-clients/${client.id}`, { method: "PATCH", body: JSON.stringify(body) })
        : await apiRequest("/api/api-clients", { method: "POST", body: JSON.stringify(body) });
      onSaved(saved, isEdit);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal title={isEdit ? "Edit API Client" : "Add API Client"} subtitle={client?.company_name} onClose={onClose}>
      {error && <p className="text-xs font-medium mb-3 px-3 py-2 rounded-lg" style={{ background: "#E8F3FB", color: "#1E6091" }}>{error}</p>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Company Name *">
          <input name="company_name" value={form.company_name} onChange={handleChange} placeholder="ABC Technologies" className={inputClass} style={inputStyle} />
        </Field>
        <Field label="Contact Person *">
          <input name="contact_person" value={form.contact_person} onChange={handleChange} placeholder="Rahul Sharma" className={inputClass} style={inputStyle} />
        </Field>
        <Field label="Email *">
          <input type="email" name="email" value={form.email} onChange={handleChange} placeholder="abc@gmail.com" className={inputClass} style={inputStyle} />
        </Field>
        <Field label="Mobile">
          <input type="text" inputMode="numeric" maxLength={10} name="mobile" value={form.mobile} onChange={handleChange} placeholder="9876543210" className={inputClass} style={inputStyle} />
        </Field>
        <div className="md:col-span-2">
          <Field label="Callback URL (optional)">
            <input name="callback_url" value={form.callback_url} onChange={handleChange} placeholder="https://abc.com/webhook" className={inputClass} style={inputStyle} />
          </Field>
        </div>
        <div className="md:col-span-2">
          <Field label="Allowed Services">
            <div className="flex flex-wrap items-center gap-4 py-1">
              {ALLOWED_SERVICES.map((service) => (
                <label key={service} className="flex items-center gap-2 cursor-pointer text-sm font-medium" style={{ color: "#334155" }}>
                  <input type="checkbox" checked={form.allowed_services.includes(service)} onChange={() => toggleService(service)} className="accent-[#1E6091]" />
                  {service}
                </label>
              ))}
            </div>
          </Field>
        </div>
        <div className="md:col-span-2">
          <Field label="Status">
            <div className="flex items-center gap-6 py-1">
              {[{ value: true, label: "Active" }, { value: false, label: "Inactive" }].map((opt) => (
                <label key={opt.label} className="flex items-center gap-2 cursor-pointer text-sm font-medium" style={{ color: form.is_active === opt.value ? "#1E6091" : "#5B7285" }}>
                  <input type="radio" name="is_active" checked={form.is_active === opt.value} onChange={() => setForm({ ...form, is_active: opt.value })} className="accent-[#1E6091]" />
                  {opt.label}
                </label>
              ))}
            </div>
          </Field>
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="px-5 py-2.5 rounded-xl text-sm font-semibold" style={{ background: "#E2EBF4", color: "#334155" }}>Cancel</button>
        <button onClick={handleSubmit} disabled={loading} className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>
          {loading ? "Saving..." : isEdit ? "Save Changes" : "Create Client"}
        </button>
      </div>
    </Modal>
  );
};

const CredentialRow = ({ label, value }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#5B7285" }}>{label}</label>
      <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl" style={{ background: "#F3F8FB", border: "1px solid #D8E6F0" }}>
        <code className="flex-1 text-sm break-all" style={{ color: "#1e293b" }}>{value}</code>
        <button onClick={handleCopy} className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: copied ? "#E6F5EA" : "#E8F3FB", color: copied ? "#3D7A1F" : "#1E6091" }}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
};

// Shown once, right after a client is created — the api_key is also visible
// later via the table's reveal toggle, but this is the moment the admin is
// most likely to actually copy it into the client's system.
const CredentialsModal = ({ client, onClose }) => (
  <Modal title="API Credentials Generated" subtitle={client.company_name} onClose={onClose}>
    <p className="text-xs font-medium mb-4 px-3 py-2 rounded-lg" style={{ background: "#FEF3E2", color: "#92400E" }}>
      Share these with {client.company_name} securely — treat the API Key like a password.
    </p>
    <div className="space-y-4">
      <CredentialRow label="API ID" value={client.api_id} />
      <CredentialRow label="API Key" value={client.api_key} />
    </div>
    <div className="mt-5 flex justify-end">
      <button onClick={onClose} className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>Done</button>
    </div>
  </Modal>
);

const ApiClients = () => {
  const [clients, setClients] = useState([]);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [newCredentials, setNewCredentials] = useState(null);
  const [revealedId, setRevealedId] = useState(null);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4500);
  };

  const loadClients = () => {
    apiRequest("/api/api-clients").then(setClients).catch(() => setClients([]));
  };

  useEffect(() => {
    loadClients();
  }, []);

  const handleToggleStatus = async (id, currentStatus) => {
    try {
      await apiRequest(`/api/api-clients/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: !currentStatus }),
      });
      setClients(clients.map((c) => (c.id === id ? { ...c, is_active: !currentStatus } : c)));
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const closeModal = () => setModal(null);

  const filtered = clients.filter((c) => {
    const query = search.trim().toLowerCase();
    const matchSearch =
      query === "" ||
      [c.company_name, c.contact_person, c.email, c.mobile].some((field) => field?.toLowerCase().includes(query));
    const matchStatus = filterStatus === "all" || (filterStatus === "active" ? c.is_active : !c.is_active);
    return matchSearch && matchStatus;
  });

  return (
    <div>
      {toast && (
        <div className="fixed top-5 right-5 z-50 px-5 py-3 rounded-xl text-sm font-semibold shadow-lg text-white transition-all max-w-xl" style={{ background: toast.type === "error" ? "#176B87" : "#16A34A" }}>
          {toast.msg}
        </div>
      )}

      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "#0f172a" }}>API Clients</h1>
          <p className="text-sm mt-1" style={{ color: "#5B7285" }}>Companies authorized to use LegalDesk's APIs</p>
        </div>
        <button onClick={() => setModal({ type: "add" })} className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>
          + Add API Client
        </button>
      </div>

      <div className="rounded-2xl p-4 mb-5 flex flex-wrap gap-3 items-center" style={{ background: "#fff", border: "1px solid #D8E6F0" }}>
        <div className="relative flex-1 min-w-48">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5B7285" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" placeholder="Search by company, contact, email or mobile..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 text-sm rounded-xl outline-none" style={{ background: "#F3F8FB", border: "1px solid #D8E6F0", color: "#1e293b" }} />
        </div>
        <div className="flex gap-2">
          {["all", "active", "disabled"].map((s) => (
            <button key={s} onClick={() => setFilterStatus(s)}
              className="px-4 py-2 rounded-xl text-sm font-medium capitalize transition-all"
              style={filterStatus === s ? { background: "#1E6091", color: "#fff" } : { background: "#E2EBF4", color: "#5B7285" }}>
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl overflow-hidden" style={{ background: "#fff", border: "1px solid #D8E6F0", boxShadow: "0 8px 24px rgba(30,96,145,0.1)" }}>
        <div className="h-1.5" style={{ background: "linear-gradient(90deg, #1E6091, #176B87, #16A34A)" }}></div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ background: "linear-gradient(180deg, #EAF3FA, #F3F8FB)", borderBottom: "1px solid #D8E6F0" }}>
                <th className="text-left px-5 py-3.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: "#1E6091" }}>Company Name</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: "#1E6091" }}>API ID</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: "#1E6091" }}>API Key</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: "#1E6091" }}>Contact Person</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: "#1E6091" }}>Email / Mobile</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: "#1E6091" }}>Allowed Services</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: "#1E6091" }}>Status</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: "#1E6091" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((client, i) => (
                <tr key={client.id} className="border-t transition-colors hover:bg-[#E8F3FB]/60" style={{ borderColor: "#E2EBF4", background: i % 2 === 1 ? "#F8FBFD" : "#fff" }}>
                  <td className="px-5 py-4">
                    <p className="text-sm font-semibold" style={{ color: "#1e293b" }}>{client.company_name}</p>
                    {client.callback_url && <p className="text-xs truncate max-w-[220px]" style={{ color: "#94A3B8" }}>{client.callback_url}</p>}
                  </td>
                  <td className="px-5 py-4 text-sm font-mono" style={{ color: "#1e293b" }}>{client.api_id || "-"}</td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-1.5">
                      <code className="text-xs" style={{ color: "#1e293b" }}>
                        {revealedId === client.id ? client.api_key : `${client.api_key?.slice(0, 8) || ""}${"•".repeat(10)}`}
                      </code>
                      <button onClick={() => setRevealedId(revealedId === client.id ? null : client.id)} className="shrink-0 px-2 py-1 rounded-lg text-xs font-semibold" style={{ background: "#E2EBF4", color: "#334155" }}>
                        {revealedId === client.id ? "Hide" : "Show"}
                      </button>
                      <button onClick={() => navigator.clipboard.writeText(client.api_key)} className="shrink-0 px-2 py-1 rounded-lg text-xs font-semibold" style={{ background: "#E8F3FB", color: "#1E6091" }}>Copy</button>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-sm" style={{ color: "#1e293b" }}>{client.contact_person || "-"}</td>
                  <td className="px-5 py-4">
                    <p className="text-sm" style={{ color: "#1e293b" }}>{client.email}</p>
                    <p className="text-xs" style={{ color: "#94A3B8" }}>{client.mobile || "-"}</p>
                  </td>
                  <td className="px-5 py-4"><BadgeList items={client.allowed_services} /></td>
                  <td className="px-5 py-4"><StatusBadge status={client.is_active} /></td>
                  <td className="px-5 py-4">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button onClick={() => setModal({ type: "edit", client })} className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors" style={{ background: "#E6F5EA", color: "#3D7A1F" }}>Edit</button>
                      <button onClick={() => handleToggleStatus(client.id, client.is_active)} className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors" style={{ background: client.is_active ? "#E8F3FB" : "#E6F5EA", color: client.is_active ? "#1E6091" : "#3D7A1F" }}>
                        {client.is_active ? "Deactivate" : "Activate"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan="8" className="text-center py-16">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: "#E2EBF4" }}>
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
                      </div>
                      <p className="font-semibold" style={{ color: "#5B7285" }}>No API clients found</p>
                      <p className="text-sm" style={{ color: "#cbd5e1" }}>Try adjusting your search or filters</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex justify-between items-center px-5 py-4 border-t" style={{ borderColor: "#E2EBF4" }}>
          <p className="text-sm" style={{ color: "#5B7285" }}>Showing <span className="font-semibold" style={{ color: "#1e293b" }}>{filtered.length}</span> of {clients.length} clients</p>
        </div>
      </div>

      {(modal?.type === "add" || modal?.type === "edit") && (
        <ApiClientModal
          client={modal.type === "edit" ? modal.client : null}
          onClose={closeModal}
          onSaved={(saved, isEdit) => {
            loadClients();
            closeModal();
            if (isEdit) {
              setShowSuccess(true);
            } else {
              setNewCredentials(saved);
            }
          }}
        />
      )}

      {showSuccess && <SuccessModal title="Saved Successfully" message="API client details saved successfully" onOk={() => setShowSuccess(false)} />}
      {newCredentials && <CredentialsModal client={newCredentials} onClose={() => setNewCredentials(null)} />}
    </div>
  );
};

export default ApiClients;
