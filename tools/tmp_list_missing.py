import pathlib

root = pathlib.Path(__file__).resolve().parents[1]
missing = []
for path in root.rglob('*.html'):
    if 'node_modules' in path.parts:
        continue
    text = path.read_text(encoding='utf-8', errors='ignore')
    if 'counterapi-workspace' not in text:
        missing.append(path.relative_to(root))

for path in sorted(missing):
    print(path.as_posix())
