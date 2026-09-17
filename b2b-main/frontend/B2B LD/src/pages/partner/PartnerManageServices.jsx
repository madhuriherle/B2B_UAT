import { useEffect, useState } from "react";
import { apiRequest } from "../../lib/api";
import { formatCurrency } from "../../lib/format";

const card = { background: "#fff", border: "1px solid #D8E6F0", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" };

const DOCUMENT_SERVICE_NAME = "Document Service";

const statusBadge = (isActive) =>
  isActive ? (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold" style={{ background: "#E6F5EA", color: "#3D7A1F" }}>
      <span className="w-1.5 h-1.5 rounded-full bg-[#16A34A]"></span>Enabled
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold" style={{ background: "#E2EBF4", color: "#5B7285" }}>
      <span className="w-1.5 h-1.5 rounded-full bg-[#94A3B8]"></span>Disabled
    </span>
  );

const PartnerManageServices = () => {
  const [services, setServices] = useState([]);
  const [loadingServices, setLoadingServices] = useState(true);
  const [documents, setDocuments] = useState([]);
  const [loadingDocuments, setLoadingDocuments] = useState(false);

  useEffect(() => {
    apiRequest("/api/partner/services")
      .then(setServices)
      .catch(() => setServices([]))
      .finally(() => setLoadingServices(false));
  }, []);

  const hasAssignedServices = services.some((s) => s.is_active);
  const documentServiceEnabled = services.some((s) => s.service_name === DOCUMENT_SERVICE_NAME && s.is_active);

  useEffect(() => {
    if (!documentServiceEnabled) return;
    setLoadingDocuments(true);
    apiRequest("/api/partner/services/documents")
      .then(setDocuments)
      .catch(() => setDocuments([]))
      .finally(() => setLoadingDocuments(false));
  }, [documentServiceEnabled]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: "#0f172a" }}>Manage Services</h1>
        <p className="text-sm mt-1" style={{ color: "#5B7285" }}>Services and pricing configured for your organization by Super Admin — view only</p>
      </div>

      <div className="rounded-2xl overflow-hidden mb-6" style={card}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ background: "#F3F8FB", borderBottom: "1px solid #D8E6F0" }}>
                {["Service Name", "Service Type", "Configured Price", "Status"].map((h) => (
                  <th key={h} className="text-left px-5 py-3.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: "#5B7285" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!loadingServices && hasAssignedServices && services.filter((s) => s.is_active).map((s) => (
                <tr key={s.service_name} className="border-t transition-colors hover:bg-slate-50/50" style={{ borderColor: "#E2EBF4" }}>
                  <td className="px-5 py-4"><p className="text-sm font-semibold" style={{ color: "#1e293b" }}>{s.service_name}</p></td>
                  <td className="px-5 py-4 text-sm" style={{ color: "#5B7285" }}>{s.service_name === DOCUMENT_SERVICE_NAME ? "Document Service" : "eService"}</td>
                  <td className="px-5 py-4 text-sm font-semibold" style={{ color: "#0f172a" }}>{s.price != null ? formatCurrency(s.price) : "-"}</td>
                  <td className="px-5 py-4">{statusBadge(s.is_active)}</td>
                </tr>
              ))}
              {!loadingServices && !hasAssignedServices && (
                <tr>
                  <td colSpan="4" className="text-center py-16">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: "#E2EBF4" }}>
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h5"/></svg>
                      </div>
                      <p className="font-semibold" style={{ color: "#5B7285" }}>No services have been assigned by the Super Admin.</p>
                    </div>
                  </td>
                </tr>
              )}
              {loadingServices && (
                <tr>
                  <td colSpan="4" className="text-center py-16 text-sm" style={{ color: "#5B7285" }}>Loading services...</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {documentServiceEnabled && (
        <div className="rounded-2xl overflow-hidden" style={card}>
          <div className="px-6 py-4 border-b" style={{ borderColor: "#E2EBF4" }}>
            <h2 className="font-semibold" style={{ color: "#0f172a" }}>Configured Document Services</h2>
            <p className="text-xs mt-0.5" style={{ color: "#5B7285" }}>Documents made available to your organization, with per-state pricing</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr style={{ background: "#F3F8FB", borderBottom: "1px solid #D8E6F0" }}>
                  {["Document Name", "State", "Price"].map((h) => (
                    <th key={h} className="text-left px-5 py-3.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: "#5B7285" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {documents.map((d) => (
                  <tr key={`${d.doc_id}-${d.state_id}`} className="border-t transition-colors hover:bg-slate-50/50" style={{ borderColor: "#E2EBF4" }}>
                    <td className="px-5 py-4 text-sm font-medium" style={{ color: "#1e293b" }}>{d.doc_name}</td>
                    <td className="px-5 py-4 text-sm" style={{ color: "#5B7285" }}>{d.state_name || "-"}</td>
                    <td className="px-5 py-4 text-sm font-semibold" style={{ color: "#0f172a" }}>{d.base_price != null ? formatCurrency(d.base_price) : "-"}</td>
                  </tr>
                ))}
                {!loadingDocuments && documents.length === 0 && (
                  <tr>
                    <td colSpan="3" className="text-center py-14">
                      <p className="font-semibold" style={{ color: "#5B7285" }}>No documents configured yet</p>
                    </td>
                  </tr>
                )}
                {loadingDocuments && (
                  <tr>
                    <td colSpan="3" className="text-center py-14 text-sm" style={{ color: "#5B7285" }}>Loading documents...</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default PartnerManageServices;
