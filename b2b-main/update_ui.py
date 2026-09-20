import sys
import re

with open('frontend/B2B LD/src/pages/partner-user/LoanDocumentFlow.jsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Step 1: Replace top nav and wrap in cards
content = re.sub(
    r'<div className="space-y-4">\s*<h2[^>]*>\s*\{document\.doc_name\} Application\s*</h2>\s*<div className="sticky top-0.*?<div>\s*<label.*?Language</label>',
    '''<div className="space-y-8 max-w-4xl mx-auto py-2">
        <div className="mb-2">
          <h1 className="text-2xl font-bold text-slate-800" style={{ fontFamily: serif }}>
            {document.doc_name} Application
          </h1>
          <p className="text-slate-500 mt-1 text-sm">Please complete the steps below to submit your application.</p>
        </div>

        {/* Card 1: Loan Details & Settings */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden" ref={loanDetailsSectionRef}>
          <div className="bg-slate-50 border-b border-slate-200 px-6 py-4 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-sm">1</div>
            <h2 className="text-base font-bold text-slate-800 uppercase tracking-wide">Loan Details & Settings</h2>
          </div>
          <div className="p-6 space-y-6">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Language</label>''',
    content,
    flags=re.DOTALL
)

# Step 2: Close Card 1 and open Card 2
content = re.sub(
    r'\s*</div>\s*\)\}\s*<div ref=\{applicantsSectionRef\} className="pt-4 border-t scroll-mt-16" style=\{\{ borderColor: theme\.border \}\}>\s*<div className="flex items-center justify-between mb-3 flex-wrap gap-2">\s*<h3 className="text-xs font-bold uppercase tracking-wide" style=\{\{ color: theme\.navy \}\}>Applicant Management</h3>',
    '''
          </div>
        )}
          </div>
        </div>

        {/* Card 2: Parties & KYC */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden" ref={applicantsSectionRef}>
          <div className="bg-slate-50 border-b border-slate-200 px-6 py-4 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-sm">2</div>
            <h2 className="text-base font-bold text-slate-800 uppercase tracking-wide">Parties & KYC</h2>
          </div>
          <div className="p-6">
            <p className="text-sm text-slate-500 mb-6">
              {useEkyc ? `${partyRows[ekycTargetIndex]?.label || "Applicant"}'s name/DOB/PAN/Aadhaar are filled from eKYC – edit if needed, or switch "Verifying identity for" above to run it for a different party.` : "Fill in the Applicant, then add Co-Applicants or Guarantors as needed."} Parties without a valid mobile number won't receive an eSign invite.
            </p>
            <div className="flex items-center justify-end mb-4 flex-wrap gap-3">''',
    content
)

# Step 2a: Remove duplicate p tag
content = re.sub(
    r'<p className="text-xs mb-3" style=\{\{ color: theme\.slate \}\}>\s*\{useEkyc \? .*? won\'t receive an eSign invite\.\s*</p>',
    '',
    content,
    flags=re.DOTALL
)

# Step 3: Close Card 2 and open Card 3
content = re.sub(
    r'</div>\s*<div ref=\{loanDetailsSectionRef\} className="scroll-mt-16">\s*<h3 className="text-xs font-bold uppercase tracking-wide mb-3" style=\{\{ color: theme\.navy \}\}>Loan Details</h3>',
    '''</div>
        </div>

        {/* Card 3: Loan Details */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden" ref={loanDetailsSectionRef}>
          <div className="bg-slate-50 border-b border-slate-200 px-6 py-4 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-sm">3</div>
            <h2 className="text-base font-bold text-slate-800 uppercase tracking-wide">Loan Details</h2>
          </div>
          <div className="p-6 space-y-6">''',
    content
)

# Remove the closing divs before loanType.sections.map
content = re.sub(
    r'</div>\s*</div>\s*\{loanType\.sections\.map',
    '''</div>\n\n        {loanType.sections.map''',
    content
)


# Step 4: Close Card 3 and open Card 4
content = re.sub(
    r'/>\s*<div ref=\{documentsSectionRef\} className="pt-4 border-t scroll-mt-16" style=\{\{ borderColor: theme\.border \}\}>\s*<h3 className="text-xs font-bold uppercase tracking-wide mb-3" style=\{\{ color: theme\.navy \}\}>Documents Checklist</h3>',
    '''/>
          </div>
        </div>

        {/* Card 4: Required Documents */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden" ref={documentsSectionRef}>
          <div className="bg-slate-50 border-b border-slate-200 px-6 py-4 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-sm">4</div>
            <h2 className="text-base font-bold text-slate-800 uppercase tracking-wide">Required Documents</h2>
          </div>
          <div className="p-6">''',
    content
)

# Step 5: Close Card 4
content = re.sub(
    r'</div>\s*</div>\s*</div>\s*\)\}\s*</div>\s*\{useEkyc && ekycStage === "verifying"',
    '''</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        
        {useEkyc && ekycStage === "verifying"''',
    content
)

with open('frontend/B2B LD/src/pages/partner-user/LoanDocumentFlow.jsx', 'w', encoding='utf-8') as f:
    f.write(content)
