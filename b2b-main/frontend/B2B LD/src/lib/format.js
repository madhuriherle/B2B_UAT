export const formatCurrency = (amount = 0) =>
  `₹${Number(amount || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const formatFileSize = (bytes) => {
  if (bytes == null) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

// Compact whole-rupee format for the eSign "Charged / Total" display
// ("₹35 / ₹140") — shared by the Order List and Order Detail pages so the
// two can never format this differently.
export const formatWholeRupees = (amount = 0) => `₹${Math.round(amount || 0).toLocaleString("en-IN")}`;

// Same 18% GST rate the backend applies to every service/charge line (see
// DEFAULT_GST_PERCENTAGE in invoice_service.py) — used to power the
// "Including 18% GST: ₹X" hover tooltip on Manage Services' price fields
// (Base Price, Delivery/Documentation/Service Charge, etc). Returns
// undefined for an empty/invalid/negative value so no tooltip renders.
export const GST_PERCENTAGE = 18;

export const gstInclusiveTooltip = (value) => {
  const amount = Number(value);
  if (value === "" || value === null || value === undefined || Number.isNaN(amount) || amount < 0) return undefined;
  return `Including ${GST_PERCENTAGE}% GST: ₹${(amount * (1 + GST_PERCENTAGE / 100)).toFixed(2)}`;
};
