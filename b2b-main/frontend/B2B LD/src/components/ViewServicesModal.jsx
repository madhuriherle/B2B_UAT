import { useEffect, useState } from "react";
import { apiRequest } from "../lib/api";
import { formatCurrency } from "../lib/format";
import Modal from "./Modal";

const Row = ({ enabled, label, price }) => (
  <div className="flex items-center justify-between px-3 py-2 rounded-lg" style={{ background: enabled ? "#E6F5EA" : "#F3F8FB" }}>
    <span className="flex items-center gap-2 text-sm font-medium" style={{ color: enabled ? "#3D7A1F" : "#94A3B8" }}>
      <span style={{ color: enabled ? "#16A34A" : "#CBD5E1" }}>{enabled ? "✓" : "✗"}</span>
      {label}
    </span>
    {enabled && price !== null && price !== undefined && (
      <span className="text-sm font-semibold" style={{ color: "#1e293b" }}>{formatCurrency(price)}</span>
    )}
  </div>
);

const ViewServicesModal = ({ partner, onClose }) => {
  const [services, setServices] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiRequest(`/api/organizations/${partner.id}/pricing`)
      .then((pricing) => {
        const activeServices = pricing.services || [];
        setServices(activeServices);
        const documentServiceEnabled = activeServices.some(
          (s) => s.service_name === "Document Service" && s.is_active
        );
        if (!documentServiceEnabled) {
          setDocuments([]);
          return null;
        }
        return apiRequest(`/api/document-service/config/summary?organization_id=${partner.id}`).then(setDocuments);
      })
      .catch(() => {
        setServices([]);
        setDocuments([]);
      })
      .finally(() => setLoading(false));
  }, [partner.id]);

  const documentServiceEnabled = services.some((s) => s.service_name === "Document Service" && s.is_active);

  return (
    <Modal title={`Partner: ${partner.organization_name}`} subtitle="Enabled services and configured documents" onClose={onClose}>
      {loading ? (
        <p className="text-sm py-6 text-center" style={{ color: "#5B7285" }}>Loading...</p>
      ) : (
        <div className="space-y-6">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#5B7285" }}>Enabled Services</h3>
            <div className="space-y-1.5">
              {services.length === 0 ? (
                <p className="text-sm" style={{ color: "#94A3B8" }}>No services configured.</p>
              ) : (
                services.map((s) => (
                  <Row key={s.service_name} enabled={s.is_active} label={s.service_name} price={s.price} />
                ))
              )}
            </div>
          </div>

          {documentServiceEnabled && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#5B7285" }}>Configured Documents</h3>
              <div className="space-y-1.5">
                {documents.length === 0 ? (
                  <p className="text-sm" style={{ color: "#94A3B8" }}>No documents configured yet.</p>
                ) : (
                  documents.map((d) => (
                    <Row key={`${d.doc_id}-${d.state_id}`} enabled label={`${d.doc_name}${d.state_name ? ` (${d.state_name})` : ""}`} price={d.base_price} />
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
};

export default ViewServicesModal;
