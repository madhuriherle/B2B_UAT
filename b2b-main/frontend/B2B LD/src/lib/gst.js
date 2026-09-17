// GST is applicable to every state at a flat 18% (see backend
// app/invoice_service.py's DEFAULT_GST_PERCENTAGE) — the only thing that
// differs by state is how the invoice splits/displays it, CGST 9% + SGST 9%
// for Karnataka vs IGST 18% elsewhere, which is invoice presentation only
// and never changes this rate. Every Payment Summary computes GST the same
// way, on whatever the service's own pricing logic already decided is
// taxable (e.g. stamp duty/face value is excluded, same as on the invoice).
export const GST_RATE = 18;

// Rounds to 2 decimal places via integer math (amount * 18, then /100)
// instead of amount * 0.18 directly, so this can't accumulate the kind of
// floating-point drift that plain multiplication risks for currency values.
export const calculateGst = (taxableAmount) => {
  const amount = Number(taxableAmount) || 0;
  return amount > 0 ? Math.round(amount * GST_RATE) / 100 : 0;
};
