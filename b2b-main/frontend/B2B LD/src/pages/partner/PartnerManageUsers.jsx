import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { apiRequest } from "../../lib/api";
import { formatCurrency } from "../../lib/format";
import { isValidMobile, sanitizeMobileInput } from "../../lib/validation";
import Modal from "../../components/Modal";

const inputClass = "w-full px-4 py-2.5 text-sm rounded-xl outline-none transition-all disabled:cursor-not-allowed";
const inputStyle = { background: "#F3F8FB", border: "1px solid #D8E6F0", color: "#1e293b" };
const card = { background: "#fff", border: "1px solid #D8E6F0", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" };

const Field = ({ label, children }) => (
  <div>
    <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#5B7285" }}>{label}</label>
    {children}
  </div>
);

const statusBadge = (isActive) =>
  isActive ? (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold" style={{ background: "#E6F5EA", color: "#3D7A1F" }}>
      <span className="w-1.5 h-1.5 rounded-full bg-[#16A34A]"></span>Active
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold" style={{ background: "#E8F3FB", color: "#1E6091" }}>
      <span className="w-1.5 h-1.5 rounded-full bg-[#176B87]"></span>Inactive
    </span>
  );

const formatDate = (value) =>
  value ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "-";

const EditUserModal = ({ user, onClose, onSaved }) => {
  const [form, setForm] = useState({
    full_name: user.full_name || "",
    email: user.email || "",
    mobile: user.mobile || "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSave = async () => {
    if (!form.full_name || !form.email || !form.mobile) {
      setError("Full name, email and mobile number are required");
      return;
    }
    if (!isValidMobile(form.mobile)) {
      setError("Mobile number must be exactly 10 digits");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await apiRequest(`/api/partner/users/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify(form),
      });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Edit User" subtitle={user.full_name} onClose={onClose}>
      {error && <p className="text-xs font-medium mb-3 px-3 py-2 rounded-lg" style={{ background: "#E8F3FB", color: "#1E6091" }}>{error}</p>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Full Name *">
          <input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} className={inputClass} style={inputStyle} />
        </Field>
        <Field label="Email *">
          <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputClass} style={inputStyle} />
        </Field>
        <Field label="Mobile Number *">
          <input type="text" inputMode="numeric" maxLength={10} value={form.mobile} onChange={(e) => setForm({ ...form, mobile: sanitizeMobileInput(e.target.value) })} className={inputClass} style={inputStyle} />
        </Field>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="px-5 py-2.5 rounded-xl text-sm font-semibold" style={{ background: "#E2EBF4", color: "#334155" }}>Cancel</button>
        <button onClick={handleSave} disabled={saving} className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </Modal>
  );
};

const ManageUserServicesModal = ({ user, onClose, onSaved }) => {
  const [services, setServices] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [selectedServices, setSelectedServices] = useState(new Set());
  const [selectedDocuments, setSelectedDocuments] = useState(new Set());

  useEffect(() => {
    apiRequest(`/api/partner/users/${user.id}/services`)
      .then((data) => {
        setServices(data.services || []);
        setDocuments(data.documents || []);
        setSelectedServices(new Set((data.services || []).filter((s) => s.assigned).map((s) => s.service_pricing_id)));
        setSelectedDocuments(new Set((data.documents || []).filter((d) => d.assigned).map((d) => d.document_config_id)));
      })
      .catch(() => setError("Could not load services"))
      .finally(() => setLoading(false));
  }, [user.id]);

  const toggleService = (id) => {
    setSelectedServices((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleDocument = (id) => {
    setSelectedDocuments((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      await apiRequest(`/api/partner/users/${user.id}/services`, {
        method: "PUT",
        body: JSON.stringify({
          service_pricing_ids: [...selectedServices],
          document_config_ids: [...selectedDocuments],
        }),
      });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const nothingAssignable = !loading && services.length === 0 && documents.length === 0;

  return (
    <Modal title="Manage Services" subtitle={`${user.full_name} — services this user may use`} onClose={onClose} width="max-w-2xl">
      {error && <p className="text-xs font-medium mb-3 px-3 py-2 rounded-lg" style={{ background: "#E8F3FB", color: "#1E6091" }}>{error}</p>}

      {loading && <p className="text-sm text-center py-8" style={{ color: "#5B7285" }}>Loading...</p>}

      {nothingAssignable && (
        <p className="text-sm text-center py-8" style={{ color: "#5B7285" }}>No services have been assigned to your organization by the Super Admin.</p>
      )}

      {!loading && !nothingAssignable && (
        <div className="space-y-6 max-h-[55vh] overflow-y-auto">
          {documents.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#5B7285" }}>Document Services</h3>
              <div className="space-y-1.5">
                {documents.map((d) => (
                  <label key={d.document_config_id} className="flex items-center justify-between px-3 py-2.5 rounded-lg cursor-pointer" style={{ background: "#F3F8FB" }}>
                    <span className="flex items-center gap-2.5 text-sm font-medium" style={{ color: "#1e293b" }}>
                      <input type="checkbox" checked={selectedDocuments.has(d.document_config_id)} onChange={() => toggleDocument(d.document_config_id)} className="w-4 h-4 accent-[#1E6091]" />
                      {d.doc_name}{d.state_name ? ` (${d.state_name})` : ""}
                    </span>
                    <span className="text-xs font-semibold" style={{ color: "#5B7285" }}>{d.base_price != null ? formatCurrency(d.base_price) : "-"}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {services.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#5B7285" }}>eServices</h3>
              <div className="space-y-1.5">
                {services.map((s) => (
                  <label key={s.service_pricing_id} className="flex items-center justify-between px-3 py-2.5 rounded-lg cursor-pointer" style={{ background: "#F3F8FB" }}>
                    <span className="flex items-center gap-2.5 text-sm font-medium" style={{ color: "#1e293b" }}>
                      <input type="checkbox" checked={selectedServices.has(s.service_pricing_id)} onChange={() => toggleService(s.service_pricing_id)} className="w-4 h-4 accent-[#1E6091]" />
                      {s.service_name}
                    </span>
                    <span className="text-xs font-semibold" style={{ color: "#5B7285" }}>{s.price != null ? formatCurrency(s.price) : "-"}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="px-5 py-2.5 rounded-xl text-sm font-semibold" style={{ background: "#E2EBF4", color: "#334155" }}>Cancel</button>
        {!nothingAssignable && (
          <button onClick={handleSave} disabled={saving || loading} className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>
            {saving ? "Saving..." : "Save Assignment"}
          </button>
        )}
      </div>
    </Modal>
  );
};

const PartnerManageUsers = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [filterStatus, setFilterStatus] = useState("all");
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4500);
  };

  const loadUsers = () => {
    setLoading(true);
    apiRequest("/api/partner/users")
      .then(setUsers)
      .catch(() => setUsers([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const closeModal = () => setModal(null);

  const handleToggleStatus = async (user) => {
    try {
      await apiRequest(`/api/partner/users/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: !user.is_active }),
      });
      setUsers(users.map((u) => (u.id === user.id ? { ...u, is_active: !user.is_active } : u)));
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const filtered = users.filter((u) => {
    const matchSearch =
      u.full_name?.toLowerCase().includes(search.toLowerCase()) ||
      u.email?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === "all" || (filterStatus === "active" ? u.is_active : !u.is_active);
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
          <h1 className="text-2xl font-bold" style={{ color: "#0f172a" }}>Manage Users</h1>
          <p className="text-sm mt-1" style={{ color: "#5B7285" }}>View and manage the users under your account</p>
        </div>
        <button onClick={() => navigate("/partner/users/create")} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>
          + Create User
        </button>
      </div>

      <div className="rounded-2xl p-4 mb-5 flex flex-wrap gap-3 items-center" style={card}>
        <div className="relative flex-1 min-w-48">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5B7285" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" placeholder="Search by name or email..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 text-sm rounded-xl outline-none" style={inputStyle} />
        </div>
        <div className="flex gap-2">
          {["all", "active", "inactive"].map((s) => (
            <button key={s} onClick={() => setFilterStatus(s)}
              className="px-4 py-2 rounded-xl text-sm font-medium capitalize transition-all"
              style={filterStatus === s ? { background: "#1E6091", color: "#fff" } : { background: "#E2EBF4", color: "#5B7285" }}>
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl overflow-hidden" style={card}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ background: "#F3F8FB", borderBottom: "1px solid #D8E6F0" }}>
                {["User Name", "Email", "Mobile Number", "Wallet Balance", "Status", "Created Date", "Actions"].map((h) => (
                  <th key={h} className="text-left px-5 py-3.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: "#5B7285" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((user) => (
                <tr key={user.id} className="border-t transition-colors hover:bg-slate-50/50" style={{ borderColor: "#E2EBF4" }}>
                  <td className="px-5 py-4"><p className="text-sm font-semibold" style={{ color: "#1e293b" }}>{user.full_name}</p></td>
                  <td className="px-5 py-4 text-sm" style={{ color: "#1e293b" }}>{user.email}</td>
                  <td className="px-5 py-4 text-sm" style={{ color: "#1e293b" }}>{user.mobile || "-"}</td>
                  <td className="px-5 py-4 text-sm font-semibold" style={{ color: "#0f172a" }}>{formatCurrency(user.wallet_balance)}</td>
                  <td className="px-5 py-4">{statusBadge(user.is_active)}</td>
                  <td className="px-5 py-4 text-sm whitespace-nowrap" style={{ color: "#5B7285" }}>{formatDate(user.created_at)}</td>
                  <td className="px-5 py-4">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button onClick={() => navigate(`/partner/users/${user.id}`)} className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors" style={{ background: "#E8F3FB", color: "#1E6091" }}>View</button>
                      <button onClick={() => setModal({ type: "edit", user })} className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors" style={{ background: "#E6F5EA", color: "#3D7A1F" }}>Edit</button>
                      <button onClick={() => setModal({ type: "services", user })} className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors" style={{ background: "#E3F1F4", color: "#176B87" }}>Manage Services</button>
                      <button onClick={() => handleToggleStatus(user)} className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors" style={{ background: user.is_active ? "#E8F3FB" : "#E6F5EA", color: user.is_active ? "#1E6091" : "#3D7A1F" }}>
                        {user.is_active ? "Deactivate" : "Activate"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan="7" className="text-center py-16">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: "#E2EBF4" }}>
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
                      </div>
                      <p className="font-semibold" style={{ color: "#5B7285" }}>No users found</p>
                      <button onClick={() => navigate("/partner/users/create")} className="text-sm font-semibold px-4 py-2 rounded-xl text-white" style={{ background: "#1E6091" }}>Create a user</button>
                    </div>
                  </td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td colSpan="7" className="text-center py-16 text-sm" style={{ color: "#5B7285" }}>Loading users...</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex justify-between items-center px-5 py-4 border-t" style={{ borderColor: "#E2EBF4" }}>
          <p className="text-sm" style={{ color: "#5B7285" }}>Showing <span className="font-semibold" style={{ color: "#1e293b" }}>{filtered.length}</span> of {users.length} users</p>
        </div>
      </div>

      {modal?.type === "edit" && (
        <EditUserModal user={modal.user} onClose={closeModal} onSaved={() => { loadUsers(); closeModal(); }} />
      )}
      {modal?.type === "services" && (
        <ManageUserServicesModal
          user={modal.user}
          onClose={closeModal}
          onSaved={() => { showToast(`Services updated for ${modal.user.full_name}`); closeModal(); }}
        />
      )}
    </div>
  );
};

export default PartnerManageUsers;

