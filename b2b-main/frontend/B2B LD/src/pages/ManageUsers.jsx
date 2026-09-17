import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { apiRequest } from "../lib/api";
import { isValidMobile, sanitizeMobileInput } from "../lib/validation";
import { useAuth } from "../lib/AuthContext";
import { portalBase } from "../lib/roleHome";
import Modal from "../components/Modal";
import SuccessModal from "../components/SuccessModal";
import { useConfirm } from "../components/ConfirmProvider";


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

const capitalize = (value) => (value ? value.charAt(0).toUpperCase() + value.slice(1) : value);

const emptyForm = { full_name: "", email: "", mobile: "", role: "user" };

const CreateUserModal = ({ organizationId, roles, onClose, onCreated }) => {
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleCreate = async () => {
    if (!form.full_name || !form.email) {
      setError("Name and email are required");
      return;
    }
    if (form.mobile && !isValidMobile(form.mobile)) {
      setError("Mobile number must be exactly 10 digits");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const result = await apiRequest(`/api/organizations/${organizationId}/users`, {
        method: "POST",
        body: JSON.stringify(form),
      });
      onCreated(result.reset_link ? "User created. Login credentials were emailed to them." : "User created.");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Create User" subtitle="Add a new user under this partner" onClose={onClose}>
      {error && <p className="text-xs font-medium mb-3 px-3 py-2 rounded-lg" style={{ background: "#E8F3FB", color: "#1E6091" }}>{error}</p>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Full Name *">
          <input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} className={inputClass} style={inputStyle} />
        </Field>
        <Field label="Email *">
          <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputClass} style={inputStyle} />
        </Field>
        <Field label="Mobile">
          <input type="text" inputMode="numeric" maxLength={10} value={form.mobile} onChange={(e) => setForm({ ...form, mobile: sanitizeMobileInput(e.target.value) })} className={inputClass} style={inputStyle} />
        </Field>
        <Field label="Role *">
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className={inputClass} style={inputStyle}>
            {roles.map((r) => (
              <option key={r.role_id} value={r.role_name}>{capitalize(r.role_name)}</option>
            ))}
          </select>
        </Field>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="px-5 py-2.5 rounded-xl text-sm font-semibold" style={{ background: "#E2EBF4", color: "#334155" }}>Cancel</button>
        <button onClick={handleCreate} disabled={saving} className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>
          {saving ? "Creating..." : "Create User"}
        </button>
      </div>
    </Modal>
  );
};

const ViewUserModal = ({ user, onClose }) => (
  <Modal title={user.full_name} subtitle="User details" onClose={onClose}>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Field label="Email"><p className="text-sm" style={{ color: "#1e293b" }}>{user.email}</p></Field>
      <Field label="Mobile"><p className="text-sm" style={{ color: "#1e293b" }}>{user.mobile || "-"}</p></Field>
      <Field label="Role"><p className="text-sm capitalize" style={{ color: "#1e293b" }}>{user.organization_role}</p></Field>
      <Field label="Status">{statusBadge(user.is_active)}</Field>
      <Field label="Created"><p className="text-sm" style={{ color: "#1e293b" }}>{formatDate(user.created_at)}</p></Field>
    </div>
  </Modal>
);

const EditUserModal = ({ organizationId, user, roles, onClose, onSaved }) => {
  const [form, setForm] = useState({
    full_name: user.full_name || "",
    email: user.email || "",
    mobile: user.mobile || "",
    role: user.organization_role || "user",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSave = async () => {
    if (!form.full_name || !form.email) {
      setError("Name and email are required");
      return;
    }
    if (form.mobile && !isValidMobile(form.mobile)) {
      setError("Mobile number must be exactly 10 digits");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await apiRequest(`/api/organizations/${organizationId}/users/${user.id}`, {
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
        <Field label="Mobile">
          <input type="text" inputMode="numeric" maxLength={10} value={form.mobile} onChange={(e) => setForm({ ...form, mobile: sanitizeMobileInput(e.target.value) })} className={inputClass} style={inputStyle} />
        </Field>
        <Field label="Role *">
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className={inputClass} style={inputStyle}>
            {roles.map((r) => (
              <option key={r.role_id} value={r.role_name}>{capitalize(r.role_name)}</option>
            ))}
          </select>
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

const ManageUsers = () => {
  const { confirm, alert } = useConfirm();
  const { organizationId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const base = portalBase(user);
  const [partner, setPartner] = useState(null);
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4500);
  };

  const loadUsers = () => {
    setLoading(true);
    apiRequest(`/api/organizations/${organizationId}/users`)
      .then(setUsers)
      .catch(() => setUsers([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    apiRequest(`/api/organizations/${organizationId}`).then(setPartner).catch(() => setPartner(null));
    apiRequest("/api/roles")
      .then((data) => setRoles(data.filter((r) => r.status)))
      .catch(() => setRoles([]));
    loadUsers();
  }, [organizationId]);

  const closeModal = () => setModal(null);

  const handleToggleStatus = async (user) => {
    try {
      await apiRequest(`/api/organizations/${organizationId}/users/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: !user.is_active }),
      });
      setUsers(users.map((u) => (u.id === user.id ? { ...u, is_active: !user.is_active } : u)));
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const handleResetPassword = async (user) => {
    if (!await confirm(`Send a new login link to ${user.full_name} (${user.email})?`)) return;
    try {
      const result = await apiRequest(`/api/organizations/${organizationId}/users/${user.id}/reset-password`, {
        method: "POST",
      });
      if (result.mail_sent) {
        showToast(`Login link emailed to ${user.email}`);
      } else {
        showToast(`Could not send email (${result.mail_error}). Link: ${result.reset_link}`, "error");
      }
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  return (
    <div>
      {toast && (
        <div className="fixed top-5 right-5 z-50 px-5 py-3 rounded-xl text-sm font-semibold shadow-lg text-white transition-all max-w-xl" style={{ background: toast.type === "error" ? "#176B87" : "#16A34A" }}>
          {toast.msg}
        </div>
      )}

      <div className="flex justify-between items-start mb-6">
        <div>
          <Link to={`${base}/customer-list`} className="text-xs font-semibold inline-flex items-center gap-1 mb-2" style={{ color: "#16A34A" }}>
            ← Back to Partner List
          </Link>
          <h1 className="text-2xl font-bold" style={{ color: "#0f172a" }}>Manage Users</h1>
          <p className="text-sm mt-1" style={{ color: "#5B7285" }}>
            {partner ? `Users under ${partner.organization_name}` : "Loading partner..."}
          </p>
        </div>
        <button onClick={() => setModal({ type: "create" })} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>
          + Create User
        </button>
      </div>

      <div className="rounded-2xl overflow-hidden" style={card}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ background: "#F3F8FB", borderBottom: "1px solid #D8E6F0" }}>
                {["User Name", "Email", "Mobile", "Status", "Created Date", "Actions"].map((h) => (
                  <th key={h} className="text-left px-5 py-3.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: "#5B7285" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-t transition-colors hover:bg-slate-50/50" style={{ borderColor: "#E2EBF4" }}>
                  <td className="px-5 py-4"><p className="text-sm font-semibold" style={{ color: "#1e293b" }}>{user.full_name}</p></td>
                  <td className="px-5 py-4 text-sm" style={{ color: "#1e293b" }}>{user.email}</td>
                  <td className="px-5 py-4 text-sm" style={{ color: "#1e293b" }}>{user.mobile || "-"}</td>
                  <td className="px-5 py-4">{statusBadge(user.is_active)}</td>
                  <td className="px-5 py-4 text-sm whitespace-nowrap" style={{ color: "#5B7285" }}>{formatDate(user.created_at)}</td>
                  <td className="px-5 py-4">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button onClick={() => setModal({ type: "view", user })} className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors" style={{ background: "#E8F3FB", color: "#1E6091" }}>View</button>
                      <button onClick={() => setModal({ type: "edit", user })} className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors" style={{ background: "#E6F5EA", color: "#3D7A1F" }}>Edit</button>
                      <button onClick={() => handleResetPassword(user)} className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors" style={{ background: "#E8F3FB", color: "#1E6091" }}>Reset Password</button>
                      <button onClick={() => handleToggleStatus(user)} className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors" style={{ background: user.is_active ? "#E8F3FB" : "#E6F5EA", color: user.is_active ? "#1E6091" : "#3D7A1F" }}>
                        {user.is_active ? "Deactivate" : "Activate"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && users.length === 0 && (
                <tr>
                  <td colSpan="6" className="text-center py-16">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: "#E2EBF4" }}>
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
                      </div>
                      <p className="font-semibold" style={{ color: "#5B7285" }}>No users yet</p>
                      <button onClick={() => setModal({ type: "create" })} className="text-sm font-semibold px-4 py-2 rounded-xl text-white" style={{ background: "#1E6091" }}>Create the first user</button>
                    </div>
                  </td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td colSpan="6" className="text-center py-16 text-sm" style={{ color: "#5B7285" }}>Loading users...</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex justify-between items-center px-5 py-4 border-t" style={{ borderColor: "#E2EBF4" }}>
          <p className="text-sm" style={{ color: "#5B7285" }}>Showing <span className="font-semibold" style={{ color: "#1e293b" }}>{users.length}</span> users</p>
        </div>
      </div>

      {modal?.type === "create" && (
        <CreateUserModal
          organizationId={organizationId}
          roles={roles}
          onClose={closeModal}
          onCreated={(message) => {
            closeModal();
            loadUsers();
            setSuccessMessage(message);
          }}
        />
      )}
      {modal?.type === "view" && <ViewUserModal user={modal.user} onClose={closeModal} />}
      {modal?.type === "edit" && (
        <EditUserModal
          organizationId={organizationId}
          user={modal.user}
          roles={roles}
          onClose={closeModal}
          onSaved={() => {
            closeModal();
            loadUsers();
            setSuccessMessage("User updated successfully");
          }}
        />
      )}

      {successMessage && (
        <SuccessModal
          title="Saved Successfully"
          message={successMessage}
          onOk={() => navigate(`${base}/partners/${organizationId}/profile?tab=users`)}
        />
      )}
    </div>
  );
};

export default ManageUsers;

