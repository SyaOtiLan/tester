#!/usr/bin/env python3
"""Send per-project Tester results to the configured Feishu group robot."""

import argparse
import base64
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import stat
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urljoin, urlsplit
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET


PRIVATE_RUNS = Path(os.environ.get('TESTER_PRIVATE_REPORT_DIR', '/data/test-results-private'))
CONFIG = Path(os.environ.get('TESTER_FEISHU_CONFIG', str(PRIVATE_RUNS / 'feishu.env')))
SUMMARY = Path(os.environ.get('TESTER_REPORT_DIR', '/data/test-results')) / 'latest.json'
PROJECT_FROM_CLASS = re.compile(r'(?:^|/)products/([a-z0-9_-]+)/')
RUN_STAMP = re.compile(r'\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}[+-]\d{4}')
STATUSES = ('passed', 'failed', 'skipped')
BEIJING = timezone(timedelta(hours=8))


def load_config() -> dict[str, str]:
    values = {}
    if CONFIG.exists():
        if stat.S_IMODE(CONFIG.stat().st_mode) & 0o077:
            raise ValueError('Feishu configuration permissions must be 600 or stricter')
        for raw in CONFIG.read_text(encoding='utf-8').splitlines():
            line = raw.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, value = line.split('=', 1)
            values[key.strip()] = value.strip().strip('"\'')
    for key in ('TESTER_FEISHU_WEBHOOK_URL', 'TESTER_FEISHU_SECRET', 'TESTER_REPORT_URL'):
        if key in os.environ:
            values[key] = os.environ[key]
    return values


def run_times(stamp: str, finished_at: str) -> tuple[str, str]:
    started = datetime.strptime(stamp, '%Y-%m-%d_%H-%M-%S%z').astimezone(BEIJING)
    finished = datetime.fromisoformat(finished_at).astimezone(BEIJING)
    if finished < started:
        raise ValueError('Run finish time precedes its start time')
    return (started.strftime('%Y-%m-%d %H:%M:%S'),
            finished.strftime('%Y-%m-%d %H:%M:%S'))


def format_message(stamp: str, result: str, finished_at: str) -> str:
    if result == 'published: test runner exit code 0':
        status = '测试通过（报告已生成）'
    elif result == 'published: test runner exit code 1':
        status = '测试未通过（报告已生成）'
    elif result.startswith('skipped:'):
        status = '本轮跳过；上一份报告保留'
    else:
        status = '本轮未生成新报告；上一份报告保留'
    started, finished = run_times(stamp, finished_at)
    return '\n'.join((
        '[Tester 测试环境报告]',
        '运行时间（北京时间）：',
        f'开始：{started}',
        f'结束：{finished}',
        f'结果：{status}',
    ))


def status_of(case: ET.Element) -> str:
    if case.find('failure') is not None or case.find('error') is not None:
        return 'failed'
    if case.find('skipped') is not None:
        return 'skipped'
    return 'passed'


def published_card(stamp: str, report_url: str,
                   summary_path: Path = SUMMARY,
                   private_runs: Path = PRIVATE_RUNS,
                   finished_at: str = '') -> dict:
    if not RUN_STAMP.fullmatch(stamp):
        raise ValueError('Invalid Tester run stamp')
    parsed = urlsplit(report_url)
    if parsed.scheme != 'https' or not parsed.netloc or parsed.query or parsed.fragment:
        raise ValueError('TESTER_REPORT_URL must be an HTTPS report directory')

    summary = json.loads(summary_path.read_text(encoding='utf-8'))
    if summary.get('run') != stamp:
        raise ValueError('Published summary does not match this run')
    full_path = f'runs/{stamp}/full.html'
    if summary.get('full_report') != full_path:
        raise ValueError('Published full report path does not match this run')
    end_time = (summary.get('finished_at') or finished_at
                or datetime.fromtimestamp(summary_path.stat().st_mtime, timezone.utc).isoformat())
    started, finished = run_times(stamp, end_time)
    full_url = urljoin(report_url.rstrip('/') + '/', full_path)
    groups: dict[str, dict[str, int]] = {}
    junit = private_runs / stamp / 'junit.xml'
    cases = list(ET.parse(junit).getroot().iter('testcase'))
    for case in cases:
        match = PROJECT_FROM_CLASS.search(case.attrib.get('classname', ''))
        project = match.group(1) if match else 'other'
        counts = groups.setdefault(project, dict.fromkeys(STATUSES, 0))
        counts[status_of(case)] += 1
    if not groups:
        raise ValueError('Published JUnit contains no test cases')
    if summary.get('tests') is not None and summary['tests'] != len(cases):
        raise ValueError('Published JUnit case count does not match the summary')

    totals = {status: sum(row[status] for row in groups.values()) for status in STATUSES}
    if any(totals[status] != summary.get(status) for status in STATUSES):
        raise ValueError('Published JUnit counts do not match the summary')

    def link(count: int, *filters: str) -> str:
        target = full_url + '#?q=' + quote(' '.join(filters), safe='')
        return f'[{count}]({target})'

    rows = []
    for project in sorted(groups, key=lambda name: (-groups[name]['failed'], name)):
        counts = groups[project]
        rows.append({
            'project': project,
            **{status: link(counts[status], f'p:{project}', f's:{status}')
               for status in STATUSES},
        })
    result = '通过' if totals['failed'] == 0 else '有失败'
    return {
        'schema': '2.0',
        'config': {'width_mode': 'fill'},
        'header': {
            'template': 'green' if totals['failed'] == 0 else 'red',
            'title': {'tag': 'plain_text', 'content': 'Tester 测试环境报告'},
        },
        'body': {'elements': [
            {'tag': 'markdown', 'content':
             f'运行时间（北京时间）：\n开始：{started}\n结束：{finished}\n结果：{result}\n'
             f'合计：通过 {link(totals["passed"], "s:passed")}　'
             f'失败 {link(totals["failed"], "s:failed")}　'
             f'跳过 {link(totals["skipped"], "s:skipped")}'},
            {
                'tag': 'table',
                'page_size': min(len(rows), 10),
                'row_height': 'low',
                'columns': [
                    {'name': 'project', 'display_name': '项目', 'data_type': 'text'},
                    {'name': 'passed', 'display_name': '通过', 'data_type': 'lark_md'},
                    {'name': 'failed', 'display_name': '失败', 'data_type': 'lark_md'},
                    {'name': 'skipped', 'display_name': '跳过', 'data_type': 'lark_md'},
                ],
                'rows': rows,
            },
            {'tag': 'markdown', 'content':
             f'[打开本次完整报告]({full_url}) · 点击表格中的数字查看对应项目和状态'},
        ]},
    }


def make_payload(stamp: str, result: str, report_url: str,
                 summary_path: Path = SUMMARY,
                 private_runs: Path = PRIVATE_RUNS,
                 finished_at: str = '') -> dict:
    if result.startswith('published:'):
        return {'msg_type': 'interactive',
                'card': published_card(stamp, report_url, summary_path,
                                       private_runs, finished_at)}
    if not finished_at:
        finished_at = datetime.now(timezone.utc).isoformat()
    return {'msg_type': 'text',
            'content': {'text': format_message(stamp, result, finished_at)}}


def send(webhook: str, secret: str, payload: dict) -> None:
    parsed = urlsplit(webhook)
    if (parsed.scheme != 'https' or parsed.hostname != 'open.feishu.cn'
            or not parsed.path.startswith('/open-apis/bot/v2/hook/')):
        raise ValueError('Feishu webhook address is invalid')
    if secret:
        timestamp = str(int(time.time()))
        digest = hmac.new(f'{timestamp}\n{secret}'.encode(), digestmod=hashlib.sha256).digest()
        payload.update(timestamp=timestamp, sign=base64.b64encode(digest).decode())
    request = Request(
        webhook,
        data=json.dumps(payload, ensure_ascii=False).encode('utf-8'),
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    try:
        with urlopen(request, timeout=15) as response:
            body = json.loads(response.read())
    except HTTPError as exc:
        raise RuntimeError(f'Feishu HTTP status {exc.code}') from None
    except URLError:
        raise RuntimeError('Feishu connection failed') from None
    if body.get('code', body.get('StatusCode', 0)) != 0:
        raise RuntimeError('Feishu rejected the message')


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--stamp', required=True)
    parser.add_argument('--result', required=True)
    parser.add_argument('--finished-at', default='')
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--report-url', default='')
    args = parser.parse_args()
    try:
        config = load_config()
        webhook = config.get('TESTER_FEISHU_WEBHOOK_URL', '')
        if not args.dry_run and not webhook:
            print('Feishu notification pending: dedicated webhook not configured.')
            return 0
        report_url = args.report_url or config.get('TESTER_REPORT_URL', '')
        payload = make_payload(args.stamp, args.result, report_url,
                               finished_at=args.finished_at)
        if args.dry_run:
            print(json.dumps(payload, ensure_ascii=False, indent=2))
            return 0
        send(webhook, config.get('TESTER_FEISHU_SECRET', ''), payload)
        print('Feishu notification sent.')
        return 0
    except (OSError, ValueError, KeyError, json.JSONDecodeError, ET.ParseError, RuntimeError) as exc:
        print(f'Feishu notification error: {exc}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
