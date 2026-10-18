#!/usr/bin/env python3
"""Build a project-first public index for a sanitized Playwright report."""

import argparse
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
import html
import os
from pathlib import Path
import re
from string import Template
import tempfile
import xml.etree.ElementTree as ET


REPO = Path(__file__).resolve().parents[1]
DEPLOY_ROOT = REPO.parent
ENV_FILES = [
    REPO / '.env.local',
    DEPLOY_ROOT / 'chat/.env',
    DEPLOY_ROOT / 'warehouse/.env',
    DEPLOY_ROOT / 'project/.env',
    DEPLOY_ROOT / 'node/web/.env.local',
    DEPLOY_ROOT / 'social/config/runtime.env',
]
SECRET_NAME = re.compile(r'(KEY|PASS|TOKEN|PRIVATE|SECRET|AUTH)', re.I)
SECRET_SHAPES = [
    re.compile(rb'sk-[A-Za-z0-9_-]{12,}'),
    re.compile(rb'(?:yyak_|yysk_)[A-Za-z0-9_-]{12,}'),
    re.compile(rb'https://open\.feishu\.cn/open-apis/bot/v2/hook/[A-Za-z0-9_-]+'),
    re.compile(rb'Bearer\s+[A-Za-z0-9._~-]{12,}'),
    re.compile(rb'0x[a-fA-F0-9]{64}'),
    re.compile(rb'eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}'),
]
PROJECT_FROM_CLASS = re.compile(r'(?:^|/)products/([a-z0-9_-]+)/')
STATUS_LABELS = {'passed': '通过', 'failed': '失败', 'skipped': '跳过'}
SKIP_LABELS = {
    'environment': '环境或测试前提不足',
    'test_todo': '测试待补或待修订',
    'product_issue': '产品或用例已知问题',
    'planned': '计划内暂不执行',
    'unmarked': '未标注跳过',
    'unknown': '待归因',
}
SKIP_DESCRIPTIONS = {
    'environment': '缺少账号、模型、服务、配置或测试数据等前提；补齐后应重新执行。',
    'test_todo': '测试尚未实现，或用例与现有产品流程不符，需要补写或修订测试。',
    'product_issue': '已记录的产品缺陷或功能缺口；不能当作环境已就绪。',
    'planned': '当前测试计划刻意不在这轮运行，如单独执行的限流用例或破坏性场景。',
    'unmarked': 'JUnit 没有 skip/fixme 标记；可能是前置步骤失败导致后续用例未执行，需要查看详细报告。',
    'unknown': '现有 skip 理由不足以可靠判断，需人工确认后再归类。',
}

PLANNED_PREFIXES = (
    'Router negative-auth cases run separately',
    'cannot induce a DB outage non-destructively',
    'Cannot mint a validly-signed expired JWT',
    'The test machine intentionally does not deploy the Social upload storage backend',
    'QR-login completion needs an external passport device',
    'Voice send needs a real microphone',
    'Call panel needs real getUserMedia',
    'A call signal needs a WS-connected callee',
    'central UCAN login redirects to an external passport authorize page',
    'ShareGPT export posts to the external',
    'no icon.type=url skills',
    'all instructions are inline',
    'no supported build config present',
)
TEST_TODO_PREFIXES = (
    'not yet implemented as an executable E2E check',
    'cannot deterministically force Router llm.models() to fail',
    'Current Chat wallet login uses the connected extension account directly',
    'no local session-import UI in this build',
    'access-code / custom-model config is not surfaced on the settings page',
    'Inject-System-Prompts / Input-Template live in the per-session model-config panel',
)
PRODUCT_ISSUE_PREFIXES = (
    'backend stores share expires_at in a TIMESTAMP',
    'BalanceStatusPage',
    'RedeemCodePage is only mounted by unrouted pages',
    'no session-level pin feature exists in this build',
)
ENVIRONMENT_FRAGMENTS = (
    'configured admin identity', 'requires an admin approver', 'requires an online',
    'channel_alert_states table is not migrated', 'AutoRegisterEnabled=true',
    'DISABLE_OPENAI_COMPAT is not set', 'account has no', 'account cannot mint',
    'no top-up plan', 'no order created', 'ENABLE_TOOLS is off', 'Cloudflare KV',
    'STABILITY_API_KEY', 'empty model catalog', 'no funded Router token',
    'catalog is empty', 'needs multiple available models', 'requires a ready text model',
    'needs a deletable custom skill', 'ANTHROPIC_API_KEY', 'server CODE not configured',
    'needCode=false', 'OPENAI_API_KEY is configured', 'no selectable public tokens',
    'no public tokens', 'requires a usable model', 'model-gated chat view',
    'needs AutoGenerateTitle', 'ChatAtBox needs the group member roster',
    'configured site-admin login', 'registration mode is a server-side DB setting',
    'admin-configured department', 'users/department/* requires auth',
    'PROJECT_USER and PROJECT_PASS', 'token/admin/audits requires identity',
    'MARKETPLACE_BASE_URL', 'BOOKS_BASE_URL', 'AGENT_PRIVATE_KEY',
    'SOCIAL_USER and SOCIAL_PASS', 'Sepolia balance for',
)


@dataclass(frozen=True)
class CaseResult:
    status: str
    name: str
    skip_kind: str = ''
    skip_reason: str = ''


def configured_secrets() -> list[bytes]:
    values = set()
    for path in ENV_FILES:
        if not path.exists():
            continue
        for line in path.read_text(encoding='utf-8').splitlines():
            if '=' not in line or line.lstrip().startswith('#'):
                continue
            name, value = line.split('=', 1)
            if SECRET_NAME.search(name):
                value = value.strip().strip("\"'")
                if len(value) >= 8:
                    values.add(value.encode())
    return sorted(values, key=len, reverse=True)


def public_text(value: str, secrets: list[bytes]) -> str:
    data = value.encode('utf-8')
    for secret in secrets:
        data = data.replace(secret, b'[REDACTED]')
    for pattern in SECRET_SHAPES:
        data = pattern.sub(b'[REDACTED]', data)
    return html.escape(data.decode('utf-8', errors='replace'), quote=True)


def status_of(case: ET.Element) -> str:
    if case.find('failure') is not None or case.find('error') is not None:
        return 'failed'
    if case.find('skipped') is not None:
        return 'skipped'
    return 'passed'


def skip_info(case: ET.Element) -> tuple[str, str]:
    if case.find('skipped') is None:
        return '', ''
    properties = {
        prop.attrib.get('name'): prop.attrib.get('value', '')
        for prop in case.findall('./properties/property')
    }
    if 'fixme' in properties:
        return 'product_issue', properties['fixme']
    if 'skip' in properties:
        reason = properties['skip']
        if reason.startswith(PLANNED_PREFIXES):
            return 'planned', reason
        if reason.startswith(TEST_TODO_PREFIXES):
            return 'test_todo', reason
        if reason.startswith(PRODUCT_ISSUE_PREFIXES):
            return 'product_issue', reason
        if any(fragment.casefold() in reason.casefold() for fragment in ENVIRONMENT_FRAGMENTS):
            return 'environment', reason
        return 'unknown', reason
    return 'unmarked', ''


def render(junit: Path, stamp: str) -> str:
    secrets = configured_secrets()
    groups: dict[str, list[CaseResult]] = defaultdict(list)
    skipped: dict[str, list[tuple[str, CaseResult]]] = defaultdict(list)
    for case in ET.parse(junit).getroot().iter('testcase'):
        match = PROJECT_FROM_CLASS.search(case.attrib.get('classname', ''))
        project = match.group(1) if match else 'other'
        kind, reason = skip_info(case)
        result = CaseResult(status_of(case), case.attrib.get('name', 'Unnamed test'), kind, reason)
        groups[project].append(result)
        if kind:
            skipped[kind].append((project, result))

    if not groups:
        raise ValueError('JUnit contains no test cases')
    totals = {status: 0 for status in STATUS_LABELS}
    for cases in groups.values():
        for case in cases:
            totals[case.status] += 1
    if sum(map(len, skipped.values())) != totals['skipped']:
        raise ValueError('Skip classification does not match JUnit skipped count')
    try:
        run_time = datetime.strptime(stamp, '%Y-%m-%d_%H-%M-%S%z').strftime('%Y-%m-%d %H:%M')
    except ValueError:
        run_time = stamp

    version_line = ''
    project = os.environ.get('TESTER_PROJECT', '')
    target_sha = os.environ.get('TESTER_TARGET_SHA', '')
    if project and re.fullmatch(r'[0-9a-f]{40}', target_sha):
        trigger = {'main': 'main 更新', 'manual': '手动'}.get(
            os.environ.get('TESTER_TRIGGER', ''), '单项目'
        )
        version_line = f' · 提交 {target_sha[:12]} · {trigger}触发'

    blocks = []
    for project in sorted(groups, key=lambda name: (-sum(c.status == 'failed' for c in groups[name]), name)):
        cases = groups[project]
        counts = {status: sum(c.status == status for c in cases) for status in STATUS_LABELS}
        rows = []
        for case in sorted(cases, key=lambda item: ('failed', 'passed', 'skipped').index(item.status)):
            detail = (
                f'<small class="skip-detail">{public_text(SKIP_LABELS[case.skip_kind], secrets)}'
                + (f'：{public_text(case.skip_reason, secrets)}' if case.skip_reason else '')
                + '</small>'
                if case.skip_kind else ''
            )
            rows.append(
                f'<li><span class="case-status {case.status}">{STATUS_LABELS[case.status]}</span>'
                f'<span>{public_text(case.name, secrets)}{detail}</span></li>'
            )
        project_name = public_text(project, secrets)
        blocks.append(
            f'<details class="project" id="project-{project}">'
            '<summary>'
            f'<span class="project-name">{project_name}</span>'
            f'<span class="project-total">共 {len(cases)} 条</span>'
            f'<span class="count passed">{counts["passed"]} 通过</span>'
            f'<span class="count failed">{counts["failed"]} 失败</span>'
            f'<span class="count skipped">{counts["skipped"]} 跳过</span>'
            '</summary><ul class="cases">'
            + ''.join(rows)
            + '</ul></details>'
        )

    skip_blocks = []
    for kind, label in SKIP_LABELS.items():
        if not skipped[kind]:
            continue
        rows = []
        for project, case in sorted(skipped[kind], key=lambda item: (item[0], item[1].name)):
            reason = (
                f'<small class="skip-detail">{public_text(case.skip_reason, secrets)}</small>'
                if case.skip_reason else ''
            )
            rows.append(
                '<li>'
                f'<span class="case-project">{public_text(project, secrets)}</span>'
                f'<span>{public_text(case.name, secrets)}{reason}</span>'
                '</li>'
            )
        skip_blocks.append(
            f'<details class="skip-group"><summary>{public_text(label, secrets)}'
            f'<strong>{len(skipped[kind])} 项</strong></summary>'
            f'<p>{public_text(SKIP_DESCRIPTIONS[kind], secrets)}</p>'
            '<ul class="cases">' + ''.join(rows) + '</ul></details>'
        )

    page = Template('''<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tester 测试环境报告</title>
<style>
:root{color-scheme:light;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#17212f;background:#f5f7fa}
*{box-sizing:border-box}body{margin:0}main{max-width:1100px;margin:auto;padding:32px 20px 64px}
.top{display:flex;align-items:start;justify-content:space-between;gap:16px;flex-wrap:wrap}h1{margin:0;font-size:28px}
.subtitle{color:#5f6b7a;margin:8px 0 0}.detail{color:#1768bf;text-decoration:none;padding:9px 14px;border:1px solid #bed4e9;border-radius:10px;background:#fff}.actions{display:flex;gap:8px;flex-wrap:wrap}
.totals{display:flex;gap:12px;flex-wrap:wrap;margin:26px 0 18px}.total{background:#fff;border:1px solid #dde4ec;border-radius:12px;padding:15px 20px;min-width:130px}
.total b{display:block;font-size:25px;margin-top:4px}.total span{color:#647386;font-size:14px}.hint{color:#5f6b7a;font-size:14px;margin:0 0 18px}
.project{background:#fff;border:1px solid #dde4ec;border-radius:12px;margin:10px 0;overflow:hidden}.project summary{display:flex;align-items:center;gap:12px;flex-wrap:wrap;cursor:pointer;padding:17px 20px;list-style:none}
.project summary::-webkit-details-marker{display:none}.project summary:after{content:"展开";margin-left:auto;color:#69778a;font-size:13px}.project[open] summary:after{content:"收起"}
.project-name{font-weight:700;font-size:18px;text-transform:capitalize;min-width:125px}.project-total{color:#647386;font-size:13px}.count{padding:4px 8px;border-radius:7px;font-size:13px}
.passed{color:#14764b;background:#e8f7ef}.failed{color:#b42318;background:#fef0ee}.skipped{color:#8a6211;background:#fff7df}
.cases{list-style:none;padding:0 20px 12px;margin:0}.cases li{display:flex;gap:12px;align-items:start;border-top:1px solid #edf0f4;padding:10px 0;font-size:14px;overflow-wrap:anywhere}
.case-status{display:inline-block;flex:0 0 auto;border-radius:5px;padding:2px 6px;font-size:12px}
.skip-breakdown{margin:24px 0}.skip-breakdown h2{font-size:20px;margin:0 0 8px}.skip-breakdown .hint{margin-bottom:12px}
.skip-group{background:#fff;border:1px solid #dde4ec;border-radius:10px;margin:8px 0;overflow:hidden}
.skip-group summary{display:flex;justify-content:space-between;gap:12px;cursor:pointer;padding:13px 18px;font-weight:600}
.skip-group p{margin:0;padding:0 18px 12px;color:#5f6b7a;font-size:13px}
.skip-group .cases{padding:0 18px 12px}.case-project{flex:0 0 105px;color:#5f6b7a;text-transform:capitalize}
.skip-detail{display:block;color:#69778a;font-size:12px;margin-top:3px;overflow-wrap:anywhere}
@media(max-width:650px){main{padding:22px 12px}.project summary{padding:14px}.project-name{min-width:90px}.cases{padding:0 14px 10px}.total{min-width:calc(50% - 6px);flex:1}}
</style></head><body><main>
<div class="top"><div><h1>Tester 测试环境报告</h1><p class="subtitle">运行时间：$run_time（北京时间） · $project_count 个项目$version_line</p></div><div class="actions"><a class="detail" href="/report/control/">手动测试</a><a class="detail" href="full.html">查看 Playwright 详细报告 →</a></div></div>
<div class="totals"><div class="total"><span>用例总数</span><b>$total</b></div><div class="total"><span>通过</span><b>$passed</b></div><div class="total"><span>失败</span><b>$failed</b></div><div class="total"><span>跳过</span><b>$skipped</b></div></div>
<section class="skip-breakdown"><h2>跳过分类</h2><p class="hint">按跳过原因归类；即使代码调用了 skip，也可能是环境或测试前提不足。这些用例均不计入通过。</p>
${skip_groups}</section>
<p class="hint">按项目查看结果，点击项目名称展开用例；错误步骤和附件请打开详细报告。</p>
${projects}
</main></body></html>
''').substitute(
        run_time=public_text(run_time, secrets),
        version_line=public_text(version_line, secrets),
        project_count=len(groups),
        total=sum(totals.values()),
        passed=totals['passed'],
        failed=totals['failed'],
        skipped=totals['skipped'],
        skip_groups='\n'.join(skip_blocks),
        projects='\n'.join(blocks),
    )
    encoded = page.encode('utf-8')
    if any(secret in encoded for secret in secrets):
        raise ValueError('Configured secret remains in project report')
    if any(pattern.search(encoded) for pattern in SECRET_SHAPES):
        raise ValueError('Key-shaped value remains in project report')
    return page


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--junit', type=Path, required=True)
    parser.add_argument('--stamp', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    page = render(args.junit, args.stamp)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.project-index.', dir=args.output.parent)
    try:
        os.fchmod(fd, 0o644)
        with os.fdopen(fd, 'w', encoding='utf-8') as output:
            output.write(page)
        os.replace(temporary, args.output)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    print(f'published project index: {args.output}')


if __name__ == '__main__':
    main()
