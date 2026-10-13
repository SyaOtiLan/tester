#!/usr/bin/env python3
"""Add a project navigator to an already sanitized Playwright HTML report."""

import argparse
from collections import Counter
import html
import os
from pathlib import Path
import re
import tempfile
from urllib.parse import quote
import xml.etree.ElementTree as ET


PROJECT = re.compile(r'(?:^|/)products/([a-z0-9_-]+)/')
MENU_ID = b'id="tester-project-menu"'


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--report', type=Path, required=True)
    parser.add_argument('--junit', type=Path, required=True)
    args = parser.parse_args()

    counts: Counter[str] = Counter()
    for case in ET.parse(args.junit).getroot().iter('testcase'):
        match = PROJECT.search(case.attrib.get('classname', ''))
        if not match:
            raise ValueError('A test case cannot be assigned to a project')
        counts[match.group(1)] += 1
    if not counts:
        raise ValueError('JUnit contains no test cases')

    style = b'''<style id="tester-project-menu-style">
#tester-project-menu{position:fixed;right:18px;bottom:18px;z-index:2147483647;font:14px system-ui,-apple-system,"Segoe UI",sans-serif;color:#17212f}
#tester-project-menu details{width:230px;max-width:calc(100vw - 36px);background:#fff;border:1px solid #b9c6d6;border-radius:10px;box-shadow:0 4px 18px #0003}
#tester-project-menu summary{padding:11px 14px;cursor:pointer;font-weight:700;list-style:none}
#tester-project-menu summary::-webkit-details-marker{display:none}
#tester-project-menu .links{max-height:60vh;overflow:auto;border-top:1px solid #e2e8ef;padding:5px}
#tester-project-menu a{display:flex;justify-content:space-between;gap:10px;padding:8px 9px;border-radius:6px;color:#135da8;text-decoration:none}
#tester-project-menu a:hover,#tester-project-menu a:focus{background:#ecf4fc;text-decoration:underline}
#tester-project-menu small{color:#657489}
</style>'''
    links = ['<a href="index.html">返回项目总览</a>',
             '<a href="full.html?view=all#?q=">全部详细用例</a>']
    for project in sorted(counts):
        safe = html.escape(project, quote=True)
        href = html.escape(f'full.html?view={quote(project)}#?q={quote("p:" + project)}', quote=True)
        links.append(f'<a href="{href}"><span>{safe}</span><small>{counts[project]} 条</small></a>')
    menu = ('<nav id="tester-project-menu" aria-label="项目目录"><details>'
            f'<summary>项目目录（{len(counts)}）</summary><div class="links">'
            + ''.join(links) + '</div></details></nav>').encode('utf-8')

    source = args.report.read_bytes()
    if MENU_ID in source:
        raise ValueError('Report already has a project menu')
    if source.count(b'</head>') != 1 or source.count(b'</body>') != 1:
        raise ValueError('Unexpected Playwright HTML structure')
    rendered = source.replace(b'</head>', style + b'</head>', 1)
    rendered = rendered.replace(b'</body>', menu + b'</body>', 1)

    fd, temporary = tempfile.mkstemp(prefix='.project-menu.', dir=args.report.parent)
    try:
        os.fchmod(fd, 0o644)
        with os.fdopen(fd, 'wb') as output:
            output.write(rendered)
        os.replace(temporary, args.report)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    print(f'added {len(counts)}-project menu to {args.report}')


if __name__ == '__main__':
    main()
