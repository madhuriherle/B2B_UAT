import re

with open('frontend/B2B LD/src/pages/partner-user/LoanDocumentFlow.jsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Update SectionFieldGrid to be an inner card
content = re.sub(
    r'<div className="pt-3 mt-3 border-t" style=\{\{ borderColor: theme\.border \}\}>\s*<h3 className="text-xs font-bold uppercase tracking-wide mb-3" style=\{\{ color: theme\.navy \}\}>\{title\}</h3>',
    '''<div className="bg-white p-4 rounded-xl border shadow-sm" style={{ borderColor: theme.border }}>
      <h3 className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: theme.navy }}>{title}</h3>''',
    content
)

# 2. Update Card 3 first grid (Base Loan Details) to be an inner card
# Card 3 wrapper has: <div className="p-6 space-y-6"> followed by <div className="grid grid-cols-2...
# Wait, I also need to change the Card 3 container background to "#F8FAFC" like PartyCard!
content = re.sub(
    r'<div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden" ref=\{loanDetailsSectionRef\}>\s*<div className="bg-slate-50 border-b border-slate-200 px-6 py-4 flex items-center gap-3">\s*<div className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-sm">3</div>\s*<h2 className="text-base font-bold text-slate-800 uppercase tracking-wide">Loan Details</h2>\s*</div>\s*<div className="p-6 space-y-6">',
    '''<div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden" ref={loanDetailsSectionRef}>
          <div className="bg-slate-50 border-b border-slate-200 px-6 py-4 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-sm">3</div>
            <h2 className="text-base font-bold text-slate-800 uppercase tracking-wide">Loan Details</h2>
          </div>
          <div className="p-6 space-y-6" style={{ background: "#F8FAFC" }}>
            <div className="bg-white p-4 rounded-xl border shadow-sm" style={{ borderColor: theme.border }}>
              <h3 className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: theme.navy }}>Base Configuration</h3>''',
    content
)

# Need to close the new div around the first grid.
# The first grid ends right before {loanType.sections.map
content = re.sub(
    r'</select>\s*</div>\s*</div>\s*\{loanType\.sections\.map',
    '''</select>
              </div>
            </div>
            </div>

        {loanType.sections.map''',
    content
)


with open('frontend/B2B LD/src/pages/partner-user/LoanDocumentFlow.jsx', 'w', encoding='utf-8') as f:
    f.write(content)
