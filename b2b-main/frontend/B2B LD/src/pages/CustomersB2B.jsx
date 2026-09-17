import { useEffect, useState } from "react";
import { apiRequest } from "../lib/api";
import Modal from "../components/Modal";
import SuccessModal from "../components/SuccessModal";
import { useConfirm } from "../components/ConfirmProvider";

const inputClass = "w-full px-4 py-2.5 text-sm rounded-xl outline-none transition-all";
const inputStyle = { background: "#F3F8FB", border: "1px solid #D8E6F0", color: "#1e293b" };

const Field = ({ label, children }) => (
  <div>
    <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#5B7285" }}>{label}</label>
    {children}
  </div>
);

const EMPTY_FORM = { company_name: "", address: "", city: "", state: "", postal_code: "", gstin: "" };

const formatDate = (value) =>
  value ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "-";

const CustomerFormModal = ({ title, initial, onClose, onSaved }) => {
  const [form, setForm] = useState(initial || EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async () => {
    if (!form.company_name || !form.address || !form.city || !form.state || !form.postal_code) {
      setError("Company name, address, city, state and postal code are required");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await onSaved(form);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal title={title} onClose={onClose}>
      {error && <p className="text-xs font-medium mb-3 px-3 py-2 rounded-lg" style={{ background: "#E8F3FB", color: "#1E6091" }}>{error}</p>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="md:col-span-2">
          <Field label="Company Name *">
            <input name="company_name" value={form.company_name} onChange={handleChange} className={inputClass} style={inputStyle} />
          </Field>
        </div>
        <div className="md:col-span-2">
          <Field label="Address *">
            <textarea name="address" value={form.address} onChange={handleChange} rows={2} className={inputClass} style={{ ...inputStyle, resize: "none" }} />
          </Field>
        </div>
        <Field label="City *">
          <input name="city" value={form.city} onChange={handleChange} className={inputClass} style={inputStyle} />
        </Field>
        <Field label="State *">
          <input name="state" value={form.state} onChange={handleChange} className={inputClass} style={inputStyle} />
        </Field>
        <Field label="Postal Code *">
          <input name="postal_code" value={form.postal_code} onChange={handleChange} className={inputClass} style={inputStyle} />
        </Field>
        <Field label="GSTIN">
          <input name="gstin" value={form.gstin} onChange={handleChange} className={inputClass} style={inputStyle} />
        </Field>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="px-5 py-2.5 rounded-xl text-sm font-semibold" style={{ background: "#E2EBF4", color: "#334155" }}>Cancel</button>
        <button onClick={handleSubmit} disabled={loading} className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>
          {loading ? "Saving..." : "Save"}
        </button>
      </div>
    </Modal>
  );
};

const ViewCustomerModal = ({ customer, onClose }) => (
  <Modal title={customer.company_name} subtitle="B2B customer details" onClose={onClose}>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Field label="City"><p className="text-sm" style={{ color: "#1e293b" }}>{customer.city}</p></Field>
      <Field label="State"><p className="text-sm" style={{ color: "#1e293b" }}>{customer.state}</p></Field>
      <Field label="Postal Code"><p className="text-sm" style={{ color: "#1e293b" }}>{customer.postal_code}</p></Field>
      <Field label="GSTIN"><p className="text-sm" style={{ color: "#1e293b" }}>{customer.gstin || "-"}</p></Field>
      <Field label="Created"><p className="text-sm" style={{ color: "#1e293b" }}>{formatDate(customer.created_at)}</p></Field>
      <div className="md:col-span-2">
        <Field label="Address"><p className="text-sm" style={{ color: "#1e293b" }}>{customer.address}</p></Field>
      </div>
    </div>
  </Modal>
);

const CustomersB2B = () => {
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const { confirm } = useConfirm();

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4500);
  };

  const loadCustomers = () => {
    apiRequest("/api/customers").then(setCustomers).catch(() => setCustomers([]));
  };

  useEffect(() => { loadCustomers(); }, []);

  const filtered = customers.filter((c) => {
    const query = search.trim().toLowerCase();
    if (!query) return true;
    return [c.company_name, c.city, c.state, c.gstin].some((f) => f?.toLowerCase().includes(query));
  });

  const closeModal = () => setModal(null);

  const handleDelete = async (customer) => {
    if (!(await confirm(`Delete customer "${customer.company_name}"?`))) return;
    try {
      await apiRequest(`/api/customers/${customer.id}`, { method: "DELETE" });
      loadCustomers();
      showToast("Customer deleted");
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
          <h1 className="text-2xl font-bold" style={{ color: "#0f172a" }}>B2B Customers</h1>
          <p className="text-sm mt-1" style={{ color: "#5B7285" }}>Billing customers used for B2B invoicing</p>
        </div>
        <button onClick={() => setModal({ type: "create" })} className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>
          + Add Customer
        </button>
      </div>

      <div className="rounded-2xl p-4 mb-5" style={{ background: "#fff", border: "1px solid #D8E6F0" }}>
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5B7285" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" placeholder="Search by company, city, state or GSTIN..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 text-sm rounded-xl outline-none" style={{ background: "#F3F8FB", border: "1px solid #D8E6F0", color: "#1e293b" }} />
        </div>
      </div>

      <div className="rounded-2xl overflow-hidden" style={{ background: "#fff", border: "1px solid #D8E6F0", boxShadow: "0 8px 24px rgba(30,96,145,0.1)" }}>
        <div className="h-1.5" style={{ background: "linear-gradient(90deg, #1E6091, #176B87, #16A34A)" }}></div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ background: "linear-gradient(180deg, #EAF3FA, #F3F8FB)", borderBottom: "1px solid #D8E6F0" }}>
                {["Company Name", "City", "State", "Postal Code", "GSTIN", "Created", "Actions"].map((h) => (
                  <th key={h} className="text-left px-5 py-3.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: "#1E6091" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((c, i) => (
                <tr key={c.id} className="border-t transition-colors hover:bg-[#E8F3FB]/60" style={{ borderColor: "#E2EBF4", background: i % 2 === 1 ? "#F8FBFD" : "#fff" }}>
                  <td className="px-5 py-4"><p className="text-sm font-semibold" style={{ color: "#1e293b" }}>{c.company_name}</p></td>
                  <td className="px-5 py-4 text-sm" style={{ color: "#1e293b" }}>{c.city}</td>
                  <td className="px-5 py-4 text-sm" style={{ color: "#1e293b" }}>{c.state}</td>
                  <td className="px-5 py-4 text-sm" style={{ color: "#1e293b" }}>{c.postal_code}</td>
                  <td className="px-5 py-4 text-sm" style={{ color: "#1e293b" }}>{c.gstin || "-"}</td>
                  <td className="px-5 py-4 text-sm whitespace-nowrap" style={{ color: "#5B7285" }}>{formatDate(c.created_at)}</td>
                  <td className="px-5 py-4">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button onClick={() => setModal({ type: "view", customer: c })} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: "#E8F3FB", color: "#1E6091" }}>View</button>
                      <button onClick={() => setModal({ type: "edit", customer: c })} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: "#E6F5EA", color: "#3D7A1F" }}>Edit</button>
                      <button onClick={() => handleDelete(c)} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: "#FCE8E8", color: "#B91C1C" }}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan="7" className="text-center py-16">
                    <p className="font-semibold" style={{ color: "#5B7285" }}>No customers found</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex justify-between items-center px-5 py-4 border-t" style={{ borderColor: "#E2EBF4" }}>
          <p className="text-sm" style={{ color: "#5B7285" }}>Showing <span className="font-semibold" style={{ color: "#1e293b" }}>{filtered.length}</span> of {customers.length} customers</p>
        </div>
      </div>

      {modal?.type === "view" && <ViewCustomerModal customer={modal.customer} onClose={closeModal} />}
      {modal?.type === "create" && (
        <CustomerFormModal
          title="Add B2B Customer"
          onClose={closeModal}
          onSaved={async (form) => {
            await apiRequest("/api/customers", { method: "POST", body: JSON.stringify(form) });
            loadCustomers();
            closeModal();
            setShowSuccess(true);
          }}
        />
      )}
      {modal?.type === "edit" && (
        <CustomerFormModal
          title="Edit B2B Customer"
          initial={modal.customer}
          onClose={closeModal}
          onSaved={async (form) => {
            await apiRequest(`/api/customers/${modal.customer.id}`, { method: "PATCH", body: JSON.stringify(form) });
            loadCustomers();
            closeModal();
            setShowSuccess(true);
          }}
        />
      )}

      {showSuccess && <SuccessModal title="Saved Successfully" message="Customer details saved successfully" onOk={() => setShowSuccess(false)} />}
    </div>
  );
};

export default CustomersB2B;
