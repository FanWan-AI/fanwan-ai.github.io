from pathlib import Path
import re

ROOT = Path(r"d:\Code\Web\wanfan.github.io")

CONFIG = {
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

SECURE_SCRIPT_SNIPPET = '  <script defer src="../secure-post.js"></script>'

for lang, data in CONFIG.items():
    path = data["file"]
    html = path.read_text(encoding="utf-8")

    if "../secure-post.js" not in html:
        html = html.replace(
            '<script defer src="../script.js"></script>',
            '<script defer src="../script.js"></script>\n' + SECURE_SCRIPT_SNIPPET,
        )

    meta_items = "\n".join(f"        <li>{item}</li>" for item in data["meta"])
    noscript_lines = "\n".join(f"          <p>{line}</p>" for line in data["noscript"])

    main_block = f"""  <main id=\"main\" class=\"blog-post secure-post\" data-secure-source=\"{data['source']}\" data-secure-slug=\"DTDA\" data-secure-lang=\"{lang}\" data-secure-home=\"../blog.html\">\n    <section class=\"section secure-post-guard\" data-secure-guard>\n      <div class=\"container secure-post-guard__inner\">\n        <span class=\"secure-post-guard__badge\">{data['badge']}</span>\n        <h1 class=\"secure-post-guard__title\">{data['title']}</h1>\n        <p class=\"secure-post-guard__summary\">{data['summary']}</p>\n        <ul class=\"secure-post-guard__meta\">\n{meta_items}\n        </ul>\n        <p class=\"secure-post-guard__hint\">{data['hint']}</p>\n      </div>\n    </section>\n    <div class=\"secure-post-content\" data-secure-content hidden></div>\n    <noscript>\n      <section class=\"section secure-post-noscript\">\n        <div class=\"container\">\n{noscript_lines}\n        </div>\n      </section>\n    </noscript>\n  </main>"""

    html_new = re.sub(r'<main id="main" class="blog-post[\s\S]*?</main>', main_block, html, count=1)
    if html_new == html:
        raise SystemExit(f"Failed to replace main for {lang}")

    path.write_text(html_new, encoding="utf-8")from pathlib import Pathfrom pathlib import Path

import reimport re



ROOT = Path(r"d:\Code\Web\wanfan.github.io")ROOT = Path(r"d:\Code\Web\wanfan.github.io")



CONFIG = {CONFIG = {

    "zh": {    "zh": {

        "file": ROOT / "blog/DTDA.html",        "file": ROOT / "blog/DTDA.html",

        "source": "../data/secure/DTDA.zh.json",        "source": "../data/secure/DTDA.zh.json",

        "title": "双轨解耦式大模型行业适配框架",        "title": "双轨解耦式大模型行业适配框架",

        "badge": "Protected · 内部",        "badge": "Protected · 内部",

        "summary": "本文用于战略沟通，全文已加密，仅向持有访问密码的成员开放。",        "summary": "本文用于战略沟通，全文已加密，仅向持有访问密码的成员开放。",

        "meta": ["发布日期：2025-10-13", "阅读需密码验证"],        "meta": ["发布日期：2025-10-13", "阅读需密码验证"],

        "hint": "系统将弹出密码输入窗；提交后内容会在浏览器本地解密并呈现。",        "hint": "系统将弹出密码输入窗；提交后内容会在浏览器本地解密并呈现。",

        "noscript": [        "noscript": [

            "本页内容已加密，需要启用 JavaScript 与 WebCrypto 才能解锁。",            "本页内容已加密，需要启用 JavaScript 与 WebCrypto 才能解锁。",

            "This post is encrypted client-side. Please enable JavaScript to decrypt it locally.",            "This post is encrypted client-side. Please enable JavaScript to decrypt it locally.",

        ],        ],

    },    },

    "en": {    "en": {

        "file": ROOT / "blog/DTDA.en.html",        "file": ROOT / "blog/DTDA.en.html",

        "source": "../data/secure/DTDA.en.json",        "source": "../data/secure/DTDA.en.json",

        "title": "Dual-Track Decoupled Large Model Industry Adaptation Framework",        "title": "Dual-Track Decoupled Large Model Industry Adaptation Framework",

        "badge": "Protected · Internal",        "badge": "Protected · Internal",

        "summary": "This strategic briefing is password-gated. The full article decrypts locally after you enter the shared passphrase.",        "summary": "This strategic briefing is password-gated. The full article decrypts locally after you enter the shared passphrase.",

        "meta": ["Published: 2025-10-13", "Password required"],        "meta": ["Published: 2025-10-13", "Password required"],

        "hint": "Enter the passphrase in the popup; the content will decrypt in your browser after verification.",        "hint": "Enter the passphrase in the popup; the content will decrypt in your browser after verification.",

        "noscript": [        "noscript": [

            "This post is encrypted client-side. Enable JavaScript and WebCrypto support to view it.",            "This post is encrypted client-side. Enable JavaScript and WebCrypto support to view it.",

            "Este artículo está cifrado en el navegador. Activa JavaScript para poder verlo.",            "Este artículo está cifrado en el navegador. Activa JavaScript para poder verlo.",

        ],        ],

    },    },

    "es": {    "es": {

        "file": ROOT / "blog/DTDA.es.html",        "file": ROOT / "blog/DTDA.es.html",

        "source": "../data/secure/DTDA.es.json",        "source": "../data/secure/DTDA.es.json",

        "title": "Marco de Adaptación Industrial para Modelos Grandes con Doble Vía Desacoplada",        "title": "Marco de Adaptación Industrial para Modelos Grandes con Doble Vía Desacoplada",

        "badge": "Protegido · Interno",        "badge": "Protegido · Interno",

        "summary": "Informe estratégico protegido con contraseña. El artículo completo se descifra localmente tras introducir la clave compartida.",        "summary": "Informe estratégico protegido con contraseña. El artículo completo se descifra localmente tras introducir la clave compartida.",

        "meta": ["Publicado: 2025-10-13", "Requiere contraseña"],        "meta": ["Publicado: 2025-10-13", "Requiere contraseña"],

        "hint": "Introduce la contraseña en la ventana emergente; el contenido se descifrará en tu navegador tras la verificación.",        "hint": "Introduce la contraseña en la ventana emergente; el contenido se descifrará en tu navegador tras la verificación.",

        "noscript": [        "noscript": [

            "Este artículo está cifrado en el navegador. Activa JavaScript para poder verlo.",            "Este artículo está cifrado en el navegador. Activa JavaScript para poder verlo.",

            "This post is encrypted client-side. Enable JavaScript and WebCrypto support to unlock it.",            "This post is encrypted client-side. Enable JavaScript and WebCrypto support to unlock it.",

        ],        ],

    },    },

}}



SECURE_SCRIPT_SNIPPET = '  <script defer src="../secure-post.js"></script>'SECURE_SCRIPT_SNIPPET = '  <script defer src="../secure-post.js"></script>'



for lang, data in CONFIG.items():for lang, data in CONFIG.items():

    path = data["file"]    path = data["file"]

    html = path.read_text(encoding="utf-8")    html = path.read_text(encoding="utf-8")



    if "../secure-post.js" not in html:    if "../secure-post.js" not in html:

        html = html.replace(        html = html.replace(

            '<script defer src="../script.js"></script>',            '<script defer src="../script.js"></script>',

            '<script defer src="../script.js"></script>\n' + SECURE_SCRIPT_SNIPPET,            '<script defer src="../script.js"></script>\n' + SECURE_SCRIPT_SNIPPET,

        )        )



    meta_items = "\n".join(f"        <li>{item}</li>" for item in data["meta"])    meta_items = "\n".join(f"        <li>{item}</li>" for item in data["meta"])

    noscript_lines = "\n".join(f"          <p>{line}</p>" for line in data["noscript"])    noscript_lines = "\n".join(f"          <p>{line}</p>" for line in data["noscript"])



    main_block = f"""  <main id=\"main\" class=\"blog-post secure-post\" data-secure-source=\"{data['source']}\" data-secure-slug=\"DTDA\" data-secure-lang=\"{lang}\" data-secure-home=\"../blog.html\">\n    <section class=\"section secure-post-guard\" data-secure-guard>\n      <div class=\"container secure-post-guard__inner\">\n        <span class=\"secure-post-guard__badge\">{data['badge']}</span>\n        <h1 class=\"secure-post-guard__title\">{data['title']}</h1>\n        <p class=\"secure-post-guard__summary\">{data['summary']}</p>\n        <ul class=\"secure-post-guard__meta\">\n{meta_items}\n        </ul>\n        <p class=\"secure-post-guard__hint\">{data['hint']}</p>\n      </div>\n    </section>\n    <div class=\"secure-post-content\" data-secure-content hidden></div>\n    <noscript>\n      <section class=\"section secure-post-noscript\">\n        <div class=\"container\">\n{noscript_lines}\n        </div>\n      </section>\n    </noscript>\n  </main>"""    main_block = f"""  <main id=\"main\" class=\"blog-post secure-post\" data-secure-source=\"{data['source']}\" data-secure-slug=\"DTDA\" data-secure-lang=\"{lang}\" data-secure-home=\"../blog.html\">\n    <section class=\"section secure-post-guard\" data-secure-guard>\n      <div class=\"container secure-post-guard__inner\">\n        <span class=\"secure-post-guard__badge\">{data['badge']}</span>\n        <h1 class=\"secure-post-guard__title\">{data['title']}</h1>\n        <p class=\"secure-post-guard__summary\">{data['summary']}</p>\n        <ul class=\"secure-post-guard__meta\">\n{meta_items}\n        </ul>\n        <p class=\"secure-post-guard__hint\">{data['hint']}</p>\n      </div>\n    </section>\n    <div class=\"secure-post-content\" data-secure-content hidden></div>\n    <noscript>\n      <section class=\"section secure-post-noscript\">\n        <div class=\"container\">\n{noscript_lines}\n        </div>\n      </section>\n    </noscript>\n  </main>"""



    html_new = re.sub(r'<main id="main" class="blog-post[\s\S]*?</main>', main_block, html, count=1)    html_new = re.sub(r'<main id="main" class="blog-post[\s\S]*?</main>', main_block, html, count=1)

    if html_new == html:    if html_new == html:

        raise SystemExit(f"Failed to replace main for {lang}")        raise SystemExit(f"Failed to replace main for {lang}")



    path.write_text(html_new, encoding="utf-8")    path.write_text(html_new, encoding="utf-8")from pathlib import Pathfrom pathlib import Path


import reimport re



ROOT = Path(r"d:\Code\Web\wanfan.github.io")root = Path(r"d:/Code/Web/wanfan.github.io")

config = {

CONFIG = {    'zh': {

    "zh": {        'file': root / 'blog/DTDA.html',

        "file": ROOT / "blog/DTDA.html",        'source': '../data/secure/DTDA.zh.json',

        "source": "../data/secure/DTDA.zh.json",        'title': '双轨解耦式大模型行业适配框架',

        "title": "双轨解耦式大模型行业适配框架",    'badge': 'Protected · 内部',

        "badge": "Protected · 内部",        'summary': '本文用于战略沟通，全文已加密，仅向持有访问密码的成员开放。',

        "summary": "本文用于战略沟通，全文已加密，仅向持有访问密码的成员开放。",        'meta': ['发布日期：2025-10-13', '阅读需密码验证'],

        "meta": ["发布日期：2025-10-13", "阅读需密码验证"],        'hint': '系统将弹出密码输入窗；提交后内容会在浏览器本地解密并呈现。',

        "hint": "系统将弹出密码输入窗；提交后内容会在浏览器本地解密并呈现。",        'noscript': ['本页内容已加密，需要启用 JavaScript 与 WebCrypto 才能解锁。',

        "noscript": [                     'This post is encrypted client-side. Please enable JavaScript to decrypt it locally.'],

            "本页内容已加密，需要启用 JavaScript 与 WebCrypto 才能解锁。",    },

            "This post is encrypted client-side. Please enable JavaScript to decrypt it locally.",    'en': {

        ],        'file': root / 'blog/DTDA.en.html',

    },        'source': '../data/secure/DTDA.en.json',

    "en": {        'title': 'Dual-Track Decoupled Large Model Industry Adaptation Framework',

        "file": ROOT / "blog/DTDA.en.html",        'badge': 'Protected · Internal',

        "source": "../data/secure/DTDA.en.json",        'summary': 'This strategic briefing is password-gated. The full article decrypts locally after you enter the shared passphrase.',

        "title": "Dual-Track Decoupled Large Model Industry Adaptation Framework",        'meta': ['Published: 2025-10-13', 'Password required'],

        "badge": "Protected · Internal",        'hint': 'Enter the passphrase in the popup; the content will decrypt in your browser after verification.',

        "summary": "This strategic briefing is password-gated. The full article decrypts locally after you enter the shared passphrase.",        'noscript': ['This post is encrypted client-side. Enable JavaScript and WebCrypto support to view it.',

        "meta": ["Published: 2025-10-13", "Password required"],                     'Este artículo está cifrado en el navegador. Activa JavaScript para poder verlo.'],

        "hint": "Enter the passphrase in the popup; the content will decrypt in your browser after verification.",    },

        "noscript": [    'es': {

            "This post is encrypted client-side. Enable JavaScript and WebCrypto support to view it.",        'file': root / 'blog/DTDA.es.html',

            "Este artículo está cifrado en el navegador. Activa JavaScript para poder verlo.",        'source': '../data/secure/DTDA.es.json',

        ],        'title': 'Marco de Adaptación Industrial para Modelos Grandes con Doble Vía Desacoplada',

    },        'badge': 'Protegido · Interno',

    "es": {        'summary': 'Informe estratégico protegido con contraseña. El artículo completo se descifra localmente tras introducir la clave compartida.',

        "file": ROOT / "blog/DTDA.es.html",        'meta': ['Publicado: 2025-10-13', 'Requiere contraseña'],

        "source": "../data/secure/DTDA.es.json",        'hint': 'Introduce la contraseña en la ventana emergente; el contenido se descifrará en tu navegador tras la verificación.',

        "title": "Marco de Adaptación Industrial para Modelos Grandes con Doble Vía Desacoplada",        'noscript': ['Este artículo está cifrado en el navegador. Activa JavaScript para poder verlo.',

        "badge": "Protegido · Interno",                     'This post is encrypted client-side. Enable JavaScript and WebCrypto support to unlock it.'],

        "summary": "Informe estratégico protegido con contraseña. El artículo completo se descifra localmente tras introducir la clave compartida.",    },

        "meta": ["Publicado: 2025-10-13", "Requiere contraseña"],}

        "hint": "Introduce la contraseña en la ventana emergente; el contenido se descifrará en tu navegador tras la verificación.",

        "noscript": [secure_script_snippet = '  <script defer src="../secure-post.js"></script>'

            "Este artículo está cifrado en el navegador. Activa JavaScript para poder verlo.",

            "This post is encrypted client-side. Enable JavaScript and WebCrypto support to unlock it.",for lang, data in config.items():

        ],    path = data['file']

    },    html = path.read_text(encoding='utf-8')

}    if '../secure-post.js' not in html:

        html = html.replace('<script defer src="../script.js"></script>', '<script defer src="../script.js"></script>\n' + secure_script_snippet)

SECURE_SCRIPT_SNIPPET = '  <script defer src="../secure-post.js"></script>'    badge = data['badge']

    meta_items = '\n'.join(f'        <li>{item}</li>' for item in data['meta'])

for lang, data in CONFIG.items():    noscript_lines = '\n'.join(f'          <p>{line}</p>' for line in data['noscript'])

    path = data["file"]    main_block = f'''  <main id="main" class="blog-post secure-post" data-secure-source="{data['source']}" data-secure-slug="DTDA" data-secure-lang="{lang}" data-secure-home="../blog.html">\n    <section class="section secure-post-guard" data-secure-guard>\n      <div class="container secure-post-guard__inner">\n        <span class="secure-post-guard__badge">{badge}</span>\n        <h1 class="secure-post-guard__title">{data['title']}</h1>\n        <p class="secure-post-guard__summary">{data['summary']}</p>\n        <ul class="secure-post-guard__meta">\n{meta_items}\n        </ul>\n        <p class="secure-post-guard__hint">{data['hint']}</p>\n      </div>\n    </section>\n    <div class="secure-post-content" data-secure-content hidden></div>\n    <noscript>\n      <section class="section secure-post-noscript">\n        <div class="container">\n{noscript_lines}\n        </div>\n      </section>\n    </noscript>\n  </main>'''

    html = path.read_text(encoding="utf-8")    html_new = re.sub(r'<main id="main" class="blog-post[\s\S]*?</main>', main_block, html, count=1)

    if html_new == html:

    if "../secure-post.js" not in html:        raise SystemExit(f'Failed to replace main for {lang}')

        html = html.replace(    path.write_text(html_new, encoding='utf-8')

            '<script defer src="../script.js"></script>',
            '<script defer src="../script.js"></script>\n' + SECURE_SCRIPT_SNIPPET,
        )

    meta_items = "\n".join(f"        <li>{item}</li>" for item in data["meta"])
    noscript_lines = "\n".join(f"          <p>{line}</p>" for line in data["noscript"])

    main_block = f"""  <main id="main" class="blog-post secure-post" data-secure-source="{data['source']}" data-secure-slug="DTDA" data-secure-lang="{lang}" data-secure-home="../blog.html">\n    <section class="section secure-post-guard" data-secure-guard>\n      <div class="container secure-post-guard__inner">\n        <span class="secure-post-guard__badge">{data['badge']}</span>\n        <h1 class="secure-post-guard__title">{data['title']}</h1>\n        <p class="secure-post-guard__summary">{data['summary']}</p>\n        <ul class="secure-post-guard__meta">\n{meta_items}\n        </ul>\n        <p class="secure-post-guard__hint">{data['hint']}</p>\n      </div>\n    </section>\n    <div class="secure-post-content" data-secure-content hidden></div>\n    <noscript>\n      <section class="section secure-post-noscript">\n        <div class="container">\n{noscript_lines}\n        </div>\n      </section>\n    </noscript>\n  </main>"""

    html_new = re.sub(r'<main id="main" class="blog-post[\s\S]*?</main>', main_block, html, count=1)
    if html_new == html:
        raise SystemExit(f"Failed to replace main for {lang}")

    path.write_text(html_new, encoding="utf-8")
