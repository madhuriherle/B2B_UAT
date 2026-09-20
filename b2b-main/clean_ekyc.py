import re

with open('frontend/B2B LD/src/pages/partner-user/LoanDocumentFlow.jsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Remove the explanatory text in Card 2
content = re.sub(
    r'<p className="text-sm text-slate-500 mb-6">.*?</p>',
    '',
    content,
    flags=re.DOTALL
)

with open('frontend/B2B LD/src/pages/partner-user/LoanDocumentFlow.jsx', 'w', encoding='utf-8') as f:
    f.write(content)
