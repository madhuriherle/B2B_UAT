import { Fragment, useEffect, useState } from "react";
import { apiRequest } from "../../lib/api";
import { formatCurrency } from "../../lib/format";
import { theme, serif, card } from "../../lib/userPortalTheme";

const statusBadge = (assigned) =>
  assigned ? (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold" style={{ background: theme.successSoft, color: theme.success, border: `1px solid ${theme.success}33` }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: theme.success }}></span>Assigned
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold" style={{ background: theme.bg, color: theme.slate, border: `1px solid ${theme.border}` }}>
      <span className="w-1.5 h-1.5 rounded-full bg-[#94A3B8]"></span>Not Assigned
    </span>
  );

// Same charge_type/rate formatting as Super Admin's own read-only display
// (see BulkEstampPricingPanel.jsx's formatRate) so a Partner sees the exact
// same numbers, never a re-derived approximation.
const formatRate = (rule) => (rule.charge_type === "percentage" ? `${rule.charge}%` : formatCurrency(rule.charge));

// Same "Any" (open-ended from an admin-entered start) vs bounded-range
// display as Super Admin's own panel (see
// BulkEstampPricingPanel.jsx's formatDenomination).
const formatDenomination = (rule) => (rule.denomination_type === "any" ? `₹${rule.denomination_from} – Unlimited` : `₹${rule.denomination_from}–₹${rule.denomination_to}`);

const PartnerUserServices = () => {
  const [services, setServices] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  // eStamp Bulk has no single flat price (see organization_service_pricing) —
  // it's priced per denomination/quantity tier instead (see
  // organization_estamp_bulk_pricing_rule), which is why its Price cell used
  // to just show "-" with no way for the Partner to see what's actually
  // configured. Read-only, same as the create-order form's own preview
  // fetch (/api/partner-user/estamp-bulk-pricing-rules only ever returns
  // this org's own active rules — never another org's).
  const [bulkPricingRules, setBulkPricingRules] = useState([]);
  const [showBulkPricing, setShowBulkPricing] = useState(false);

  useEffect(() => {
    apiRequest("/api/partner-user/services")
      .then((data) => {
        setServices(data.services || []);
        setDocuments(data.documents || []);
      })
      .catch(() => {
        setServices([]);
        setDocuments([]);
      })
      .finally(() => setLoading(false));
    apiRequest("/api/partner-user/estamp-bulk-pricing-rules")
      .then(setBulkPricingRules)
      .catch(() => setBulkPricingRules([]));
  }, []);

  const assignedCount = services.filter((s) => s.assigned).length;

  return (
    <div>
      <div className="mb-6 pb-4 border-b" style={{ borderColor: theme.border }}>
        <h1 className="text-2xl font-bold" style={{ color: theme.ink, fontFamily: serif }}>Services</h1>
        <p className="text-sm mt-1" style={{ color: theme.slate }}>Services you can use to create orders — view only</p>
      </div>

      <div className="rounded-lg overflow-hidden mb-6" style={card}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ background: theme.bg, borderBottom: `1px solid ${theme.border}` }}>
                {["Service Name", "Price", "Status"].map((h) => (
                  <th key={h} className="text-left px-5 py-3.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: theme.slate }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!loading && services.map((s) => {
                const isBulkEstamp = s.service_name === "eStamp Bulk";
                return (
                <Fragment key={s.service_name}>
                  <tr className="border-t transition-colors hover:bg-slate-50/50" style={{ borderColor: theme.border }}>
                    <td className="px-5 py-4"><p className="text-sm font-semibold" style={{ color: theme.ink }}>{s.service_name}</p></td>
                    <td className="px-5 py-4 text-sm font-semibold" style={{ color: theme.ink }}>
                      {isBulkEstamp ? (
                        bulkPricingRules.length > 0 ? (
                          <button
                            type="button"
                            onClick={() => setShowBulkPricing((v) => !v)}
                            className="text-sm font-semibold underline-offset-2 hover:underline"
                            style={{ color: theme.navy }}
                          >
                            {showBulkPricing ? "Hide" : "View"} Bulk eStamp Pricing Tiers ({bulkPricingRules.length})
                          </button>
                        ) : (
                          <span style={{ color: theme.slate, fontWeight: 400 }}>Not configured yet</span>
                        )
                      ) : (
                        s.price != null ? formatCurrency(s.price) : "-"
                      )}
                    </td>
                    <td className="px-5 py-4">{statusBadge(s.assigned)}</td>
                  </tr>
                  {isBulkEstamp && showBulkPricing && bulkPricingRules.length > 0 && (
                    <tr className="border-t" style={{ borderColor: theme.border, background: theme.bg }}>
                      <td colSpan={3} className="px-5 py-4">
                        <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: theme.slate }}>
                          Bulk eStamp Pricing (Denomination x Quantity tiers)
                        </p>
                        <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${theme.border}` }}>
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr style={{ background: "#fff" }}>
                                  <th className="text-left px-3 py-2 font-semibold uppercase" style={{ color: theme.slate }}>Denomination</th>
                                  <th className="text-left px-3 py-2 font-semibold uppercase" style={{ color: theme.slate }}>Quantity</th>
                                  <th className="text-left px-3 py-2 font-semibold uppercase" style={{ color: theme.slate }}>Charge Type</th>
                                  <th className="text-left px-3 py-2 font-semibold uppercase" style={{ color: theme.slate }}>Rate</th>
                                </tr>
                              </thead>
                              <tbody>
                                {bulkPricingRules.map((r) => (
                                  <tr key={r.id} className="border-t" style={{ borderColor: theme.border, background: "#fff" }}>
                                    <td className="px-3 py-2" style={{ color: theme.ink }}>{formatDenomination(r)}</td>
                                    <td className="px-3 py-2" style={{ color: theme.ink }}>{r.quantity_from}–{r.quantity_to ?? "Unlimited"}</td>
                                    <td className="px-3 py-2" style={{ color: theme.ink }}>{r.charge_type === "percentage" ? "Percentage" : "Fixed Amount"}</td>
                                    <td className="px-3 py-2 font-semibold" style={{ color: theme.ink }}>{formatRate(r)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
                );
              })}
              {!loading && services.length === 0 && (
                <tr>
                  <td colSpan="3" className="text-center py-16">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: theme.bg }}>
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h5"/></svg>
                      </div>
                      <p className="font-semibold" style={{ color: theme.slate }}>No services available yet. Contact your Partner admin.</p>
                    </div>
                  </td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td colSpan="3" className="text-center py-16 text-sm" style={{ color: theme.slate }}>Loading services...</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {!loading && services.length > 0 && (
          <div className="flex justify-between items-center px-5 py-4 border-t" style={{ borderColor: theme.border }}>
            <p className="text-sm" style={{ color: theme.slate }}><span className="font-semibold" style={{ color: theme.ink }}>{assignedCount}</span> of {services.length} services assigned to you</p>
          </div>
        )}
      </div>

      {documents.length > 0 && (
        <div className="rounded-lg overflow-hidden" style={card}>
          <div className="px-6 py-4 border-b" style={{ borderColor: theme.border }}>
            <h2 className="font-semibold" style={{ color: theme.ink, fontFamily: serif }}>Configured Document Services</h2>
            <p className="text-xs mt-0.5" style={{ color: theme.slate }}>Documents made available to you, with per-state pricing</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr style={{ background: theme.bg, borderBottom: `1px solid ${theme.border}` }}>
                  {["Document Name", "State", "Price", "Status"].map((h) => (
                    <th key={h} className="text-left px-5 py-3.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: theme.slate }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {documents.map((d) => (
                  <tr key={`${d.document_config_id}`} className="border-t transition-colors hover:bg-slate-50/50" style={{ borderColor: theme.border }}>
                    <td className="px-5 py-4 text-sm font-medium" style={{ color: theme.ink }}>{d.doc_name}</td>
                    <td className="px-5 py-4 text-sm" style={{ color: theme.slate }}>{d.state_name || "-"}</td>
                    <td className="px-5 py-4 text-sm font-semibold" style={{ color: theme.ink }}>{d.base_price != null ? formatCurrency(d.base_price) : "-"}</td>
                    <td className="px-5 py-4">{statusBadge(d.assigned)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default PartnerUserServices;
