export const STATUS_STYLES = {
  Draft: { background: "#E2EBF4", color: "#334155" },
  Submitted: { background: "#E8F3FB", color: "#1E6091" },
  "In Progress": { background: "#FEF3C7", color: "#92400E" },
  Completed: { background: "#E6F5EA", color: "#3D7A1F" },
  Failed: { background: "#FEE2E2", color: "#B91C1C" },
  Cancelled: { background: "#FEE2E2", color: "#B91C1C" },
  // eSign-specific derived statuses (order.status stays Draft/Submitted/etc
  // underneath — these only ever appear in place of it for eSign orders,
  // see partner.py's _esign_status_label).
  "Sent for Signature": { background: "#E8F3FB", color: "#1E6091" },
  "Partially Signed": { background: "#FEF3C7", color: "#92400E" },
  Rejected: { background: "#FEE2E2", color: "#B91C1C" },
  Expired: { background: "#E2EBF4", color: "#334155" },
  // eStamp Bulk status flow (order.status holds these directly — see
  // partner.py's BULK_ESTAMP_STATUS_FLOW).
  Pending: { background: "#E2EBF4", color: "#334155" },
  Processed: { background: "#FEF3C7", color: "#92400E" },
  // Order Reports' invoicing-progress status (see reports.py's
  // list_order_reports) — Pending/Completed above are shared/reused as-is.
  Processing: { background: "#FEF3C7", color: "#92400E" },
  // Manual eStamp's own richer status flow (order.status holds these
  // directly — see partner.py's MANUAL_ESTAMP_STATUS_*). Submitted and
  // Completed above are shared/reused as-is.
  "Stamp Processing": { background: "#FEF3C7", color: "#92400E" },
  "Stamp Completed": { background: "#E0F2FE", color: "#075985" },
  "eSign Pending": { background: "#FEF3C7", color: "#92400E" },
  "eSign Completed": { background: "#E0F2FE", color: "#075985" },
  // An eStamp order with eSign attached afterwards (see
  // stamp_service.initiate_stamp / esign_service.initiate_esign) sits here
  // between its stamp finishing and its eSign finishing.
  "Partially Completed": { background: "#FEF3C7", color: "#92400E" },
  // eKYC's own status flow (order.status holds these directly — see
  // ekyc_service._sync_ekyc_order_status). Failed above is shared/reused.
  "Verification Pending": { background: "#FEF3C7", color: "#92400E" },
  "Document Extracted": { background: "#E8F3FB", color: "#1E6091" },
  Verified: { background: "#E6F5EA", color: "#3D7A1F" },
};

export const formatDate = (value) =>
  value ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "-";

export const formatDateTime = (value) =>
  value
    ? new Date(value).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })
    : "—";

export const canSubmitOrder = (order) => order.status === "Draft";
export const canCancelOrder = (order) => order.status === "Draft" || order.status === "Submitted";

