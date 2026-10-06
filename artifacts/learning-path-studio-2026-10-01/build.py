from pathlib import Path
root = Path(__file__).resolve().parent
styles = '\n'.join((root / name).read_text() for name in ['reference-main.css', 'reference-app-shell.css', 'studio.css'])
page = (root / 'template.html').read_text().replace('<!-- STYLES -->', '<style>\n' + styles + '\n</style>').replace('<!-- SCRIPT -->', '<script>\n' + (root / 'studio.js').read_text() + '\n</script>')
(root / 'index.html').write_text(page)
if (root / 'plan-template.html').exists():
    (root / 'plan.html').write_text((root / 'plan-template.html').read_text().replace('<!-- STYLES -->', '<style>\n' + styles + '\n</style>'))
print('Built prototype HTML from unmodified product CSS and additive learning-path components.')
