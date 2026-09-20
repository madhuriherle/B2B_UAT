with open('frontend/B2B LD/src/pages/partner-user/LoanDocumentFlow.jsx', 'r', encoding='utf-8') as f:
    content = f.read()

ORDER_SUMMARY = """
        {requireEsign && document?.esign_price != null && (() => {
          const signingCount = generatedParties.filter((p) => isValidMobile(p.address?.present?.mobile)).length || 1;
          const basePrice = Number(document.esign_price) * signingCount;
          const gst = Math.round(basePrice * 0.18 * 100) / 100;
          const total = Math.round((basePrice + gst) * 100) / 100;
          return (
            <div className="mt-4 rounded-xl border overflow-hidden" style={{ borderColor: theme.border }}>
              <div className="px-4 py-3 border-b" style={{ background: "#F8FAFC", borderColor: theme.border }}>
                <h3 className="text-xs font-bold uppercase tracking-wide" style={{ color: theme.navy }}>Order Summary</h3>
              </div>
              <div className="px-4 py-3 space-y-2">
                <div className="flex justify-between text-sm">
                  <span style={{ color: theme.slate }}>Number of Signers</span>
                  <span className="font-semibold" style={{ color: theme.ink }}>{signingCount}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span style={{ color: theme.slate }}>eSign Price</span>
                  <span className="font-semibold" style={{ color: theme.ink }}>&#8377;{document.esign_price} &times; {signingCount} = &#8377;{basePrice.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span style={{ color: theme.slate }}>GST (18%)</span>
                  <span className="font-semibold" style={{ color: theme.ink }}>&#8377;{gst.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm pt-2 border-t font-bold" style={{ borderColor: theme.border }}>
                  <span style={{ color: theme.ink }}>Total</span>
                  <span style={{ color: theme.navy }}>&#8377;{total.toFixed(2)}</span>
                </div>
              </div>
              <div className="px-4 pb-3 pt-1 space-y-1">
                {generatedParties.filter((p) => isValidMobile(p.address?.present?.mobile)).map((p, i) => (
                  <div key={i} className="flex items-center justify-between text-xs py-1 border-t" style={{ borderColor: theme.border }}>
                    <span className="font-semibold" style={{ color: theme.ink }}>{p.personal?.full_name || ROLE_LABELS[p.role]}</span>
                    <span style={{ color: theme.slate }}>{p.address?.present?.mobile}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

"""

TARGET = "        <ErrorBanner message={formError} />\n\n        <div className=\"sticky bottom-0 flex gap-2 mt-4 pt-4 pb-1 border-t\""

REPLACEMENT = ORDER_SUMMARY + "        <ErrorBanner message={formError} />\n\n        <div className=\"sticky bottom-0 flex gap-2 mt-4 pt-4 pb-1 border-t\""

if TARGET in content:
    content = content.replace(TARGET, REPLACEMENT, 1)
    print("SUCCESS: Order Summary injected")
else:
    print("ERROR: Target not found")

with open('frontend/B2B LD/src/pages/partner-user/LoanDocumentFlow.jsx', 'w', encoding='utf-8') as f:
    f.write(content)
