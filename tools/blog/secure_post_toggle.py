"""Utility to enable or disable secure-post placeholders for blog articles.

Run with, for example:

    python tools/blog/secure_post_toggle.py --slug DTDA --mode enable

When enabling, the script replaces the <main> block with a secure-post placeholder
bound to the encrypted JSON payload, and stores the original block under
`data/secure/backups/` so it can be restored later with `--mode disable`.
"""

from __future__ import annotations

import argparse
import re
from pathlib import Path
from typing import Dict, Iterable, List


ROOT = Path(__file__).resolve().parents[2]
BACKUP_DIR = ROOT / "data" / "secure" / "backups"
SECURE_SCRIPT_SNIPPET = '  <script defer src="../secure-post.js"></script>'


SECURE_CONFIG: Dict[str, Dict[str, Dict[str, object]]] = {
    "DTDA": {
        "zh": {
            "file": ROOT / "blog/DTDA.html",
            "source": "../data/secure/DTDA.zh.json",
            "title": "双轨解耦式大模型行业适配框架",
            "badge": "Protected · 内部",
            "summary": "本文用于战略沟通，全文已加密，仅向持有访问密码的成员开放。",
            "meta": ["发布日期：2025-10-13", "阅读需密码验证"],
            "hint": "系统将弹出密码输入窗；提交后内容会在浏览器本地解密并呈现。",
            "noscript": [
                "本页内容已加密，需要启用 JavaScript 与 WebCrypto 才能解锁。",
                "This post is encrypted client-side. Please enable JavaScript to decrypt it locally.",
            ],
        },
        "en": {
            "file": ROOT / "blog/DTDA.en.html",
            "source": "../data/secure/DTDA.en.json",
            "title": "Dual-Track Decoupled Large Model Industry Adaptation Framework",
            "badge": "Protected · Internal",
            "summary": "This strategic briefing is password-gated. The full article decrypts locally after you enter the shared passphrase.",
            "meta": ["Published: 2025-10-13", "Password required"],
            "hint": "Enter the passphrase in the popup; the content will decrypt in your browser after verification.",
            "noscript": [
                "This post is encrypted client-side. Enable JavaScript and WebCrypto support to view it.",
                "Este artículo está cifrado en el navegador. Activa JavaScript para poder verlo.",
            ],
        },
        "es": {
            "file": ROOT / "blog/DTDA.es.html",
            "source": "../data/secure/DTDA.es.json",
            "title": "Marco de Adaptación Industrial para Modelos Grandes con Doble Vía Desacoplada",
            "badge": "Protegido · Interno",
            "summary": "Informe estratégico protegido con contraseña. El artículo completo se descifra localmente tras introducir la clave compartida.",
            "meta": ["Publicado: 2025-10-13", "Requiere contraseña"],
            "hint": "Introduce la contraseña en la ventana emergente; el contenido se descifrará en tu navegador tras la verificación.",
            "noscript": [
                "Este artículo está cifrado en el navegador. Activa JavaScript para poder verlo.",
                "This post is encrypted client-side. Enable JavaScript and WebCrypto support to unlock it.",
            ],
        },
    }
    ,
    "CIKMA": {
        "zh": {
            "file": ROOT / "blog/CIKMA.html",
            "source": "../data/secure/CIKMA.zh.json",
            "title": "认知启发的知识记忆架构",
            "badge": "Protected · 内部",
            "summary": "本文属于内部研究档案，全文需输入访问口令方可解锁。",
            "meta": ["发布日期：2025-10-16", "阅读需密码验证"],
            "hint": "系统将提示输入口令；验证通过后内容会在本地解密并恢复全部交互。",
            "noscript": [
                "本页内容已加密，需要启用 JavaScript 与 WebCrypto 才能解锁。",
                "This post is encrypted client-side. Please enable JavaScript to decrypt it locally.",
            ],
        },
        "en": {
            "file": ROOT / "blog/CIKMA.en.html",
            "source": "../data/secure/CIKMA.en.json",
            "title": "Cognitively-Inspired Knowledge Memory Architecture",
            "badge": "Protected · Internal",
            "summary": "This internal research note is gated. Enter the shared passphrase to unlock the full article.",
            "meta": ["Published: 2025-10-16", "Password required"],
            "hint": "Enter the passphrase when prompted; the page decrypts locally after validation.",
            "noscript": [
                "This post is encrypted client-side. Enable JavaScript and WebCrypto support to view it.",
                "Este artículo está cifrado en el navegador. Activa JavaScript para poder verlo.",
            ],
        },
        "es": {
            "file": ROOT / "blog/CIKMA.es.html",
            "source": "../data/secure/CIKMA.es.json",
            "title": "Arquitectura de Memoria de Conocimiento con Inspiración Cognitiva",
            "badge": "Protegido · Interno",
            "summary": "Este informe interno está protegido por contraseña. Introduce la clave compartida para desbloquearlo.",
            "meta": ["Publicado: 2025-10-16", "Requiere contraseña"],
            "hint": "Introduce la contraseña cuando se solicite; el contenido se descifrará localmente tras la validación.",
            "noscript": [
                "Este artículo está cifrado en el navegador. Activa JavaScript para poder verlo.",
                "This post is encrypted client-side. Enable JavaScript and WebCrypto support to unlock it.",
            ],
        },
    }
}


MAIN_BLOCK_PATTERN = re.compile(r'<main id="main" class="blog-post[\s\S]*?</main>', re.IGNORECASE)


def ensure_secure_script(html: str) -> str:
    """Ensure `secure-post.js` is included after `script.js`."""

    marker = '<script defer src="../script.js"></script>'
    if "../secure-post.js" in html:
        return html
    if marker not in html:
        raise SystemExit("Could not find script.js hook to inject secure-post.js")
    return html.replace(marker, marker + "\n" + SECURE_SCRIPT_SNIPPET)


def render_main_block(struct: Dict[str, object], slug: str, lang: str) -> str:
    meta_items = "\n".join(f"        <li>{item}</li>" for item in struct["meta"])  # type: ignore[arg-type]
    noscript_lines = "\n".join(
        f"          <p>{line}</p>" for line in struct["noscript"]  # type: ignore[arg-type]
    )
    return (
        f"  <main id=\"main\" class=\"blog-post secure-post\" "
        f"data-secure-source=\"{struct['source']}\" data-secure-slug=\"{slug}\" "
        f"data-secure-lang=\"{lang}\" data-secure-home=\"../blog.html\">\n"
        "    <section class=\"section secure-post-guard\" data-secure-guard>\n"
        "      <div class=\"container secure-post-guard__inner\">\n"
        f"        <span class=\"secure-post-guard__badge\">{struct['badge']}</span>\n"
        f"        <h1 class=\"secure-post-guard__title\">{struct['title']}</h1>\n"
        f"        <p class=\"secure-post-guard__summary\">{struct['summary']}</p>\n"
        "        <ul class=\"secure-post-guard__meta\">\n"
        f"{meta_items}\n"
        "        </ul>\n"
        f"        <p class=\"secure-post-guard__hint\">{struct['hint']}</p>\n"
        "      </div>\n"
        "    </section>\n"
        "    <div class=\"secure-post-content\" data-secure-content hidden></div>\n"
        "    <noscript>\n"
        "      <section class=\"section secure-post-noscript\">\n"
        "        <div class=\"container\">\n"
        f"{noscript_lines}\n"
        "        </div>\n"
        "      </section>\n"
        "    </noscript>\n"
        "  </main>"
    )


def enable_secure(slug: str, langs: Iterable[str]) -> None:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    for lang in langs:
        struct = SECURE_CONFIG[slug][lang]
        path: Path = struct["file"]  # type: ignore[assignment]
        html = path.read_text(encoding="utf-8")
        html = ensure_secure_script(html)
        match = MAIN_BLOCK_PATTERN.search(html)
        if not match:
            raise SystemExit(f"Could not locate <main> block in {path}")
        backup_path = BACKUP_DIR / f"{slug}.{lang}.main.html"
        if not backup_path.exists():
            backup_path.write_text(match.group(0), encoding="utf-8")
        placeholder = render_main_block(struct, slug, lang)
        html_new = MAIN_BLOCK_PATTERN.sub(placeholder, html, count=1)
        path.write_text(html_new, encoding="utf-8")
        print(f"Secured {path}")


def disable_secure(slug: str, langs: Iterable[str]) -> None:
    for lang in langs:
        struct = SECURE_CONFIG[slug][lang]
        path: Path = struct["file"]  # type: ignore[assignment]
        html = path.read_text(encoding="utf-8")
        match = MAIN_BLOCK_PATTERN.search(html)
        if not match or "secure-post" not in match.group(0):
            print(f"{path} does not appear to be secured; skipping")
            continue
        backup_path = BACKUP_DIR / f"{slug}.{lang}.main.html"
        if not backup_path.exists():
            raise SystemExit(f"Missing backup for {slug} {lang}: {backup_path}")
        original_main = backup_path.read_text(encoding="utf-8")
        html_new = MAIN_BLOCK_PATTERN.sub(original_main, html, count=1)
        path.write_text(html_new, encoding="utf-8")
        print(f"Restored {path}")


def parse_langs(slug: str, lang_arg: str | None) -> List[str]:
    available = set(SECURE_CONFIG[slug].keys())
    if lang_arg is None:
        return sorted(available)
    langs = [token.strip() for token in lang_arg.split(",") if token.strip()]
    missing = [lang for lang in langs if lang not in available]
    if missing:
        raise SystemExit(f"Unsupported languages for {slug}: {', '.join(missing)}")
    return langs


def main() -> None:
    parser = argparse.ArgumentParser(description="Toggle secure-post overlay for a blog entry.")
    parser.add_argument("--slug", required=True, choices=sorted(SECURE_CONFIG.keys()))
    parser.add_argument("--mode", required=True, choices=["enable", "disable"])
    parser.add_argument("--lang", help="Comma-separated languages to process (default: all)")
    args = parser.parse_args()

    langs = parse_langs(args.slug, args.lang)
    if args.mode == "enable":
        enable_secure(args.slug, langs)
    else:
        disable_secure(args.slug, langs)


if __name__ == "__main__":
    main()