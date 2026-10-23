#!/usr/bin/env python3
"""Clone one sanitized Playwright run with PR #11's English test titles.

The report's outcomes, timings, test IDs, errors, traces, and attachments remain
identical. Only the title/path metadata in the embedded report archive changes.
"""

import argparse
import base64
import io
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import zipfile


ARCHIVE = re.compile(rb'data:application/zip;base64,([A-Za-z0-9+/=]+)')
SECRET_SHAPES = [
    re.compile(rb'sk-[A-Za-z0-9_-]{12,}'),
    re.compile(rb'Bearer\s+[A-Za-z0-9._~-]{12,}'),
    re.compile(rb'0x[a-fA-F0-9]{64}'),
    re.compile(rb'eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}'),
]


def listed_tests(tester: Path, node: Path, language: str, project: str) -> dict:
    command = [str(node), 'node_modules/@playwright/test/cli.js', 'test',
               '--config=playwright.safe.config.ts', '--list', '--reporter=json']
    if project:
        command.append(f'--project={project}')
    env = os.environ.copy()
    env['TEST_TITLE_LANG'] = language
    result = subprocess.run(command, cwd=tester, env=env, capture_output=True,
                            text=True, timeout=120, check=True)
    catalog = json.loads(result.stdout)
    if catalog.get('errors'):
        raise ValueError(f'{language} Playwright test collection has errors')
    return catalog


def paired_titles(zh_catalog: dict, en_catalog: dict) -> dict:
    titles = {}

    def pair_suites(zh_suites, en_suites, zh_path=(), en_path=(), depth=0):
        if len(zh_suites) != len(en_suites):
            raise ValueError('Chinese and English suite counts differ')
        for zh_suite, en_suite in zip(zh_suites, en_suites):
            for field in ('file', 'line', 'column'):
                if zh_suite.get(field) != en_suite.get(field):
                    raise ValueError('Chinese and English suite locations differ')
            nested = depth > 0
            next_zh = zh_path + (zh_suite['title'],) if nested else zh_path
            next_en = en_path + (en_suite['title'],) if nested else en_path
            zh_specs, en_specs = zh_suite.get('specs', []), en_suite.get('specs', [])
            if len(zh_specs) != len(en_specs):
                raise ValueError('Chinese and English test counts differ')
            for zh_spec, en_spec in zip(zh_specs, en_specs):
                for field in ('file', 'line', 'column'):
                    if zh_spec.get(field) != en_spec.get(field):
                        raise ValueError('Chinese and English test locations differ')
                zh_tests, en_tests = zh_spec['tests'], en_spec['tests']
                if len(zh_tests) != len(en_tests):
                    raise ValueError('Chinese and English project counts differ')
                for zh_test, en_test in zip(zh_tests, en_tests):
                    project = zh_test['projectName']
                    if project != en_test['projectName']:
                        raise ValueError('Chinese and English projects differ')
                    key = (zh_spec['file'], zh_spec['line'], zh_spec['column'],
                           project, zh_spec['title'], next_zh)
                    value = (en_spec['title'], next_en)
                    if key in titles:
                        raise ValueError('Ambiguous test location/title mapping')
                    titles[key] = value
            pair_suites(zh_suite.get('suites', []), en_suite.get('suites', []), next_zh, next_en, depth + 1)

    pair_suites(zh_catalog['suites'], en_catalog['suites'])
    return titles


def translate_test(test: dict, titles: dict) -> None:
    place = test['location']
    key = (place['file'], place['line'], place['column'], test['projectName'],
           test['title'], tuple(test.get('path', [])))
    if key not in titles:
        raise ValueError(f'No PR #11 title mapping for {place["file"]}:{place["line"]}')
    english_title, english_path = titles[key]
    test['title'] = english_title
    test['path'] = list(english_path)


def publish(source: Path, target: Path, titles: dict) -> tuple[int, int]:
    html = source.read_bytes()
    match = ARCHIVE.search(html)
    if not match or html.count(b'id="tester-report-language-script"') != 1:
        raise ValueError('Expected sanitized Playwright report with language control')

    archive_bytes = io.BytesIO()
    summary_ids, detail_ids = set(), set()
    with zipfile.ZipFile(io.BytesIO(base64.b64decode(match.group(1)))) as original:
        with zipfile.ZipFile(archive_bytes, 'w') as translated:
            for info in original.infolist():
                raw = original.read(info.filename)
                if info.filename.endswith('.json'):
                    data = json.loads(raw)
                    if info.filename == 'report.json':
                        tests = [test for entry in data['files'] for test in entry['tests']]
                        summary_ids = {test['testId'] for test in tests}
                    else:
                        tests = data.get('tests', [])
                        detail_ids.update(test['testId'] for test in tests)
                    for test in tests:
                        translate_test(test, titles)
                    raw = json.dumps(data, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
                translated.writestr(info, raw)
    if not summary_ids or summary_ids != detail_ids:
        raise ValueError('Report summary and detail test IDs differ')
    english = html[:match.start(1)] + base64.b64encode(archive_bytes.getvalue()) + html[match.end(1):]
    if any(pattern.search(english) for pattern in SECRET_SHAPES):
        raise ValueError('A key-shaped value was found in the English report')

    target.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.full-en-', dir=target.parent)
    try:
        os.fchmod(fd, 0o644)
        with os.fdopen(fd, 'wb') as output:
            output.write(english)
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return len(summary_ids), len(english)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--report', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--tester', type=Path, required=True)
    parser.add_argument('--node-bin', type=Path, default=Path('/opt/node-v24/bin/node'))
    parser.add_argument('--project', default='')
    parser.add_argument('--catalog-zh', type=Path)
    parser.add_argument('--catalog-en', type=Path)
    args = parser.parse_args()
    if bool(args.catalog_zh) != bool(args.catalog_en):
        parser.error('Provide both title catalogs or neither')
    if args.catalog_zh:
        zh = json.loads(args.catalog_zh.read_text())
        en = json.loads(args.catalog_en.read_text())
    else:
        zh = listed_tests(args.tester, args.node_bin, 'zh', args.project)
        en = listed_tests(args.tester, args.node_bin, 'en', args.project)
    titles = paired_titles(zh, en)
    count, size = publish(args.report, args.output, titles)
    print(f'published English Playwright report: {count} tests; {size} bytes; {args.output}')


if __name__ == '__main__':
    main()
