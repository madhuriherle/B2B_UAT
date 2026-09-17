import os
import re

# List of files to process
files_to_process = [
    "src/pages/CustomerOnboard.jsx",
    "src/pages/AccountsInvoiceSettings.jsx",
    "src/pages/AccountsB2BInvoices.jsx",
    "src/pages/ArticleCodeMaster.jsx",
    "src/components/EditPartnerModal.jsx",
    "src/pages/ManageUsers.jsx",
    "src/pages/partner/orders/OrderListView.jsx",
    "src/pages/partner/orders/PartnerOrderDetails.jsx"
]

def process_file(filepath):
    print(f"Processing {filepath}")
    if not os.path.exists(filepath):
        print(f"  File not found: {filepath}")
        return

    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    original = content

    # 1. Add import
    # Determine the relative path to components
    # src/pages/ -> ../components/ConfirmProvider
    # src/components/ -> ./ConfirmProvider
    # src/pages/partner/orders/ -> ../../../components/ConfirmProvider
    
    depth = filepath.count('/') - 1
    if "components" in filepath:
        import_path = "./ConfirmProvider"
    else:
        import_path = "../" * depth + "components/ConfirmProvider"
    
    import_stmt = f'import {{ useConfirm }} from "{import_path}";\n'
    
    if "useConfirm" not in content:
        # Insert import after the last import statement
        lines = content.split('\n')
        last_import_idx = -1
        for i, line in enumerate(lines):
            if line.startswith('import '):
                last_import_idx = i
        
        if last_import_idx != -1:
            lines.insert(last_import_idx + 1, import_stmt)
            content = '\n'.join(lines)
        else:
            content = import_stmt + content

    # 2. Add hook `const { confirm, alert } = useConfirm();` inside the component
    # Find the main component declaration
    component_name = filepath.split('/')[-1].replace('.jsx', '')
    
    # We'll look for `const ComponentName = (` or `const ComponentName = ({` or `const ComponentName = ()` 
    # Or just find the first `const [`, or whatever is typical in React components
    
    # A robust way is to just find the component definition
    pattern = r'(const ' + component_name + r'\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{)'
    match = re.search(pattern, content)
    if match:
        hook_stmt = '\n  const { confirm, alert } = useConfirm();'
        if hook_stmt not in content and 'useConfirm()' not in content:
            content = content[:match.end()] + hook_stmt + content[match.end():]
    else:
        # fallback: find `export default function ComponentName`
        pattern2 = r'(export default function ' + component_name + r'\s*\([^)]*\)\s*\{)'
        match2 = re.search(pattern2, content)
        if match2:
            hook_stmt = '\n  const { confirm, alert } = useConfirm();'
            if 'useConfirm()' not in content:
                content = content[:match2.end()] + hook_stmt + content[match2.end():]
        else:
            print(f"  Could not find component body for {component_name}")

    # 3. Replace window.confirm and window.alert
    content = content.replace('window.confirm(', 'await confirm(')
    content = content.replace('window.alert(', 'await alert(')

    if content != original:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"  Updated {filepath}")
    else:
        print(f"  No changes needed for {filepath}")


for f in files_to_process:
    process_file(f)

print("Done.")
