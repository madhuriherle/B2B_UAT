import re

with open('frontend/B2B LD/src/pages/partner-user/LoanDocumentFlow.jsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. RepeatingRowsSection
content = re.sub(
    r'<div className="pt-3 border-t" style=\{\{ borderColor: theme\.border \}\}>\s*<SectionHeading title=\{title\} />',
    '''<div className="bg-white p-4 rounded-xl border shadow-sm" style={{ borderColor: theme.border }}>
        <SectionHeading title={title} />''',
    content
)

# 2. PartyCard spacing wrapper
content = re.sub(
    r'<div className="p-4 space-y-4">\s*<div>\s*<SectionHeading title="Personal / KYC" />',
    '''<div className="p-4 space-y-4" style={{ background: "#F8FAFC" }}>
        <div className="bg-white p-4 rounded-xl border shadow-sm" style={{ borderColor: theme.border }}>
          <SectionHeading title="Personal / KYC" />''',
    content
)

# 3. PartyCard Address section
content = re.sub(
    r'<div className="pt-3 border-t" style=\{\{ borderColor: theme\.border \}\}>\s*<SectionHeading title="Address" />',
    '''<div className="bg-white p-4 rounded-xl border shadow-sm" style={{ borderColor: theme.border }}>
          <SectionHeading title="Address" />''',
    content
)

# 4. PartyCard Employment section
content = re.sub(
    r'<div className="pt-3 border-t" style=\{\{ borderColor: theme\.border \}\}>\s*<SectionHeading title="Employment / Business" />',
    '''<div className="bg-white p-4 rounded-xl border shadow-sm" style={{ borderColor: theme.border }}>
          <SectionHeading title="Employment / Business" />''',
    content
)

with open('frontend/B2B LD/src/pages/partner-user/LoanDocumentFlow.jsx', 'w', encoding='utf-8') as f:
    f.write(content)
