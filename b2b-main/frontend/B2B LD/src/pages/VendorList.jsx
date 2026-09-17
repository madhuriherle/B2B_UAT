import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest } from "../lib/api";
import { formatCurrency } from "../lib/format";
import { isValidMobile, sanitizeMobileInput } from "../lib/validation";
import { useAuth } from "../lib/AuthContext";
import { portalBase } from "../lib/roleHome";
import Modal from "../components/Modal";
import SuccessModal from "../components/SuccessModal";
import AssignOrderModal from "../components/AssignOrderModal";
import StatusBadge from "../components/StatusBadge";

const inputClass = "w-full px-4 py-2.5 text-sm rounded-xl outline-none transition-all disabled:cursor-not-allowed";
const inputStyle = { background: "#F3F8FB", border: "1px solid #D8E6F0", color: "#1e293b" };

const VENDOR_TYPES = ["Internal Team", "Third-Party Vendor"];
const PAYMENT_MODES = [
  { value: "Wallet", label: "Wallet" },
  { value: "PPS", label: "Self PPS (Pay Per Service)" },
];
const PAGE_SIZE = 20;

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

const EditVendorModal = ({ vendor, states, onClose, onSaved }) => {
  const [form, setForm] = useState({
    vendor_name: vendor.vendor_name || "",
    vendor_type: vendor.vendor_type || "",
    contact_person: vendor.contact_person || "",
    email: vendor.email || "",
    mobile: vendor.mobile || "",
    gst_number: vendor.gst_number || "",
    city: vendor.city || "",
    state_id: vendor.state_id || "",
    payment_mode: vendor.payment_mode || "Wallet",
    address: vendor.address || "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm({ ...form, [name]: name === "mobile" ? sanitizeMobileInput(value) : value });
  };

  const handleSubmit = async () => {
    if (!form.vendor_name || !form.email) {
      setError("Vendor name and email are required");
      return;
    }
    if (form.mobile && !isValidMobile(form.mobile)) {
      setError("Mobile number must be exactly 10 digits");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await apiRequest(`/api/vendors/${vendor.id}`, {
        method: "PATCH",
        body: JSON.stringify({ ...form, state_id: form.state_id || null }),
      });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal title="Edit Vendor" subtitle={vendor.vendor_name} onClose={onClose}>
      {error && <p className="text-xs font-medium mb-3 px-3 py-2 rounded-lg" style={{ background: "#E8F3FB", color: "#1E6091" }}>{error}</p>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Vendor Name *">
          <input name="vendor_name" value={form.vendor_name} onChange={handleChange} className={inputClass} style={inputStyle} />
        </Field>
        <Field label="Vendor Type *">
          <select name="vendor_type" value={form.vendor_type} onChange={handleChange} className={inputClass} style={inputStyle}>
            <option value="">Select type</option>
            {VENDOR_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Contact Person">
          <input name="contact_person" value={form.contact_person} onChange={handleChange} className={inputClass} style={inputStyle} />
        </Field>
        <Field label="Email *">
          <input type="email" name="email" value={form.email} onChange={handleChange} className={inputClass} style={inputStyle} />
        </Field>
        <Field label="Mobile">
          <input type="text" inputMode="numeric" maxLength={10} name="mobile" value={form.mobile} onChange={handleChange} className={inputClass} style={inputStyle} />
        </Field>
        <Field label="GST Number">
          <input name="gst_number" value={form.gst_number} onChange={handleChange} className={inputClass} style={inputStyle} />
        </Field>
        <Field label="City">
          <input name="city" value={form.city} onChange={handleChange} className={inputClass} style={inputStyle} />
        </Field>
        <Field label="State">
          <select name="state_id" value={form.state_id} onChange={handleChange} className={inputClass} style={inputStyle}>
            <option value="">Select state</option>
            {states.map((s) => <option key={s.id} value={s.id}>{s.state_name}</option>)}
          </select>
        </Field>
        <div className="md:col-span-2">
          <Field label="Payment Configuration *">
            <div className="flex items-center gap-6 py-2">
              {PAYMENT_MODES.map((opt) => (
                <label key={opt.value} className="flex items-center gap-2 cursor-pointer text-sm font-medium" style={{ color: form.payment_mode === opt.value ? "#1E6091" : "#5B7285" }}>
                  <input type="radio" name="payment_mode" value={opt.value} checked={form.payment_mode === opt.value} onChange={handleChange} className="accent-[#1E6091]" />
                  {opt.label}
                </label>
              ))}
            </div>
          </Field>
        </div>
        <div className="md:col-span-2">
          <Field label="Address">
            <textarea name="address" value={form.address} onChange={handleChange} rows={2} className={inputClass} style={{ ...inputStyle, resize: "none" }} />
          </Field>
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="px-5 py-2.5 rounded-xl text-sm font-semibold" style={{ background: "#E2EBF4", color: "#334155" }}>Cancel</button>
        <button onClick={handleSubmit} disabled={loading} className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>
          {loading ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </Modal>
  );
};

const SORT_ACCESSORS = {
  vendor_name: (v) => v.vendor_name?.toLowerCase() || "",
  wallet_balance: (v) => Number(v.wallet_balance) || 0,
  active_orders: (v) => Number(v.active_orders) || 0,
};

const VendorList = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const base = portalBase(user);
  const [vendors, setVendors] = useState([]);
  const [states, setStates] = useState([]);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [sort, setSort] = useState({ key: "vendor_name", dir: "asc" });
  const [page, setPage] = useState(1);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4500);
  };

  const loadVendors = () => {
    apiRequest("/api/vendors").then(setVendors).catch(() => setVendors([]));
  };

  useEffect(() => {
    loadVendors();
    apiRequest("/api/catalog/states").then(setStates).catch(() => setStates([]));
  }, []);

  const handleToggleStatus = async (id, currentStatus) => {
    try {
      await apiRequest(`/api/vendors/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: !currentStatus }),
      });
      setVendors(vendors.map((v) => (v.id === id ? { ...v, is_active: !currentStatus } : v)));
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const toggleSort = (key) => {
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
    setPage(1);
  };

  const filtered = vendors.filter((v) => {
    const query = search.trim().toLowerCase();
    const matchSearch =
      query === "" ||
      v.vendor_name?.toLowerCase().startsWith(query) ||
      [v.contact_person, v.email, v.mobile, v.vendor_type, v.state_name].some((field) => field?.toLowerCase().includes(query));
    const matchStatus = filterStatus === "all" || (filterStatus === "active" ? v.is_active : !v.is_active);
    return matchSearch && matchStatus;
  });

  const sorted = [...filtered].sort((a, b) => {
    const accessor = SORT_ACCESSORS[sort.key];
    const av = accessor(a);
    const bv = accessor(b);
    const cmp = typeof av === "string" ? av.localeCompare(bv) : av - bv;
    return sort.dir === "asc" ? cmp : -cmp;
  });

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const paged = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const closeModal = () => setModal(null);

  const sortIcon = (key) => (sort.key !== key ? "" : sort.dir === "asc" ? " ↑" : " ↓");

  return (
    <div>
      {toast && (
        <div className="fixed top-5 right-5 z-50 px-5 py-3 rounded-xl text-sm font-semibold shadow-lg text-white transition-all max-w-xl" style={{ background: toast.type === "error" ? "#176B87" : "#16A34A" }}>
          {toast.msg}
        </div>
      )}

      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "#0f172a" }}>Vendor List</h1>
          <p className="text-sm mt-1" style={{ color: "#5B7285" }}>View and manage all onboarded vendors</p>
        </div>
      </div>

      <div className="rounded-2xl p-4 mb-5 flex flex-wrap gap-3 items-center" style={{ background: "#fff", border: "1px solid #D8E6F0" }}>
        <div className="relative flex-1 min-w-48">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5B7285" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" placeholder="Search by name, contact, email, mobile, type or state..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-9 pr-4 py-2.5 text-sm rounded-xl outline-none" style={{ background: "#F3F8FB", border: "1px solid #D8E6F0", color: "#1e293b" }} />
        </div>
        <div className="flex gap-2">
          {["all", "active", "disabled"].map((s) => (
            <button key={s} onClick={() => { setFilterStatus(s); setPage(1); }}
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
                <th onClick={() => toggleSort("vendor_name")} className="text-left px-5 py-3.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap cursor-pointer select-none" style={{ color: "#1E6091" }}>Vendor Name{sortIcon("vendor_name")}</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: "#1E6091" }}>Contact Person</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: "#1E6091" }}>State(s)</th>
                <th onClick={() => toggleSort("wallet_balance")} className="text-left px-5 py-3.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap cursor-pointer select-none" style={{ color: "#1E6091" }}>Wallet Balance{sortIcon("wallet_balance")}</th>
                <th onClick={() => toggleSort("active_orders")} className="text-left px-5 py-3.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap cursor-pointer select-none" style={{ color: "#1E6091" }}>Active Orders{sortIcon("active_orders")}</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: "#1E6091" }}>Status</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: "#1E6091" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((vendor, i) => (
                <tr key={vendor.id} className="border-t transition-colors hover:bg-[#E8F3FB]/60" style={{ borderColor: "#E2EBF4", background: i % 2 === 1 ? "#F8FBFD" : "#fff" }}>
                  <td className="px-5 py-4">
                    <p className="text-sm font-semibold" style={{ color: "#1e293b" }}>{vendor.vendor_name}</p>
                    <p className="text-xs" style={{ color: "#94A3B8" }}>{vendor.vendor_type}</p>
                  </td>
                  <td className="px-5 py-4 text-sm" style={{ color: "#1e293b" }}>{vendor.contact_person || "-"}</td>
                  <td className="px-5 py-4"><BadgeList items={vendor.assigned_state_names} /></td>
                  <td className="px-5 py-4 text-sm font-semibold" style={{ color: "#0f172a" }}>{vendor.payment_mode === "PPS" ? "—" : formatCurrency(vendor.wallet_balance)}</td>
                  <td className="px-5 py-4 text-sm" style={{ color: "#1e293b" }}>{vendor.active_orders}</td>
                  <td className="px-5 py-4"><StatusBadge status={vendor.is_active} /></td>
                  <td className="px-5 py-4">
                    <div className="flex flex-wrap items-center gap-1.5" style={{ maxWidth: "300px" }}>
                      <button onClick={() => navigate(`${base}/vendors/${vendor.id}/profile`)} className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors" style={{ background: "#E8F3FB", color: "#1E6091" }}>View</button>
                      <button onClick={() => setModal({ type: "edit", vendor })} className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors" style={{ background: "#E6F5EA", color: "#3D7A1F" }}>Edit</button>
                      {vendor.payment_mode !== "PPS" && (
                        <button onClick={() => navigate(`${base}/vendors/${vendor.id}/wallet`)} className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors" style={{ background: "#D8E6F0", color: "#334155" }}>Wallet</button>
                      )}
                      <button onClick={() => setModal({ type: "assign", vendor })} className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors" style={{ background: "#EFE8FB", color: "#6B21A8" }}>Assign Orders</button>
                      <button onClick={() => handleToggleStatus(vendor.id, vendor.is_active)} className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors" style={{ background: vendor.is_active ? "#E8F3FB" : "#E6F5EA", color: vendor.is_active ? "#1E6091" : "#3D7A1F" }}>
                        {vendor.is_active ? "Disable" : "Activate"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {paged.length === 0 && (
                <tr>
                  <td colSpan="7" className="text-center py-16">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: "#E2EBF4" }}>
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                      </div>
                      <p className="font-semibold" style={{ color: "#5B7285" }}>No vendors found</p>
                      <p className="text-sm" style={{ color: "#cbd5e1" }}>Try adjusting your search or filters</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex justify-between items-center px-5 py-4 border-t flex-wrap gap-3" style={{ borderColor: "#E2EBF4" }}>
          <p className="text-sm" style={{ color: "#5B7285" }}>Showing <span className="font-semibold" style={{ color: "#1e293b" }}>{paged.length}</span> of {sorted.length} vendors</p>
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50" style={{ background: "#E2EBF4", color: "#334155" }}>Prev</button>
              <span className="text-xs font-semibold" style={{ color: "#5B7285" }}>Page {page} of {totalPages}</span>
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50" style={{ background: "#E2EBF4", color: "#334155" }}>Next</button>
            </div>
          )}
        </div>
      </div>

      {modal?.type === "edit" && (
        <EditVendorModal
          vendor={modal.vendor}
          states={states}
          onClose={closeModal}
          onSaved={() => {
            loadVendors();
            closeModal();
            setShowSuccess(true);
          }}
        />
      )}
      {modal?.type === "assign" && (
        <AssignOrderModal
          vendor={modal.vendor}
          onClose={closeModal}
          onAssigned={() => {
            loadVendors();
            closeModal();
            showToast(`Order assigned to ${modal.vendor.vendor_name}.`);
          }}
        />
      )}

      {showSuccess && <SuccessModal title="Saved Successfully" message="Vendor details updated successfully" onOk={() => setShowSuccess(false)} />}
    </div>
  );
};

export default VendorList;
