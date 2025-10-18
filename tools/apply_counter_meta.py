import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
BLOCK = (
    "  <!-- CounterAPI configuration (workspace slug from CounterAPI dashboard) -->\n"
    "  <meta name=\"counterapi-workspace\" content=\"fanwan\">\n"
    "  <meta name=\"counterapi-counter\" content=\"fanwan\">\n"
    "  <!-- Optional: <meta name=\"counterapi-token\" content=\"\"> -->\n"
)

paths = [
    pathlib.Path(p)
    for p in (
        "404.html",
        "blog/CIKMA.en.html",
        "blog/CIKMA.es.html",
        "blog/CIKMA.html",
        "blog/DTDA.en.html",
        "blog/DTDA.es.html",
        "blog/DTDA.html",
        "blog/future-of-rag-2025-kblam.en.html",
        "blog/future-of-rag-2025-kblam.es.html",
        "blog/future-of-rag-2025-kblam.html",
        "blog/kblam-project-summary.en.html",
        "blog/kblam-project-summary.es.html",
        "blog/kblam-project-summary.html",
        "blog.html",
        "contact.html",
        "data/secure/backups/CIKMA.en.main.html",
        "data/secure/backups/CIKMA.es.main.html",
        "data/secure/backups/CIKMA.zh.main.html",
        "data/secure/backups/DTDA.en.main.html",
        "data/secure/backups/DTDA.es.main.html",
        "data/secure/backups/DTDA.zh.main.html",
        "google-verification-template.html",
        "google7c8e2fda9782847b.html",
        "lab/ai-paperhub.html",
        "lab/ai-radar.html",
        "lab/modelswatch.html",
        "lab/paper-snapshot.html",
        "lab/scholarpush.html",
        "pdf-viewer.html",
        "publications.html",
        "subscribe.html",
        "tmp_modelswatch_snippet.html",
        "tools/generate_og.html",
    )
]

for rel_path in paths:
    path = ROOT / rel_path
    text = path.read_text(encoding="utf-8", errors="ignore")
    if "counterapi-workspace" in text:
        continue
    insert_at = text.find("<script")
    if insert_at == -1:
        insert_at = text.find("</head>")
    if insert_at == -1:
           # Skip fragments without a traditional <head> (e.g., backup partials)
           continue
    new_text = text[:insert_at] + BLOCK + text[insert_at:]
    path.write_text(new_text, encoding="utf-8")
