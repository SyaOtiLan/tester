"""Publish a redacted snapshot of the existing Playwright HTML report."""

import base64
import io
import os
from pathlib import Path
import re
import tempfile
import zipfile


REPO = Path(__file__).resolve().parents[1]
DEPLOY_ROOT = REPO.parent
SOURCE = Path(os.environ.get('TESTER_REPORT_SOURCE', str(REPO / 'reports/index.html')))
TARGET = Path(os.environ.get('TESTER_REPORT_TARGET', '/data/test-results/index.html'))
ENV_FILES = [
    REPO / '.env.local',
    DEPLOY_ROOT / 'chat/.env',
    DEPLOY_ROOT / 'warehouse/.env',
    DEPLOY_ROOT / 'project/.env',
    DEPLOY_ROOT / 'node/web/.env.local',
    DEPLOY_ROOT / 'social/config/runtime.env',
]
EMBEDDED_ZIP = re.compile(rb'data:application/zip;base64,([A-Za-z0-9+/=]+)')
SECRET_NAME = re.compile(r'(KEY|PASS|TOKEN|PRIVATE|SECRET|AUTH)', re.I)
SECRET_SHAPES = [
    re.compile(rb'sk-[A-Za-z0-9_-]{12,}'),
    re.compile(rb'(?:yyak_|yysk_)[A-Za-z0-9_-]{12,}'),
    re.compile(rb'https://open\.feishu\.cn/open-apis/bot/v2/hook/[A-Za-z0-9_-]+'),
    re.compile(rb'Bearer\s+[A-Za-z0-9._~-]{12,}'),
    re.compile(rb'0x[a-fA-F0-9]{64}'),
    re.compile(rb'eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}'),
]


def configured_secrets() -> list[bytes]:
    secrets = set()
    for path in ENV_FILES:
        if not path.exists():
            continue
        for line in path.read_text(encoding='utf-8').splitlines():
            if '=' not in line or line.lstrip().startswith('#'):
                continue
            name, value = line.split('=', 1)
            if not SECRET_NAME.search(name):
                continue
            value = value.strip().strip("\"'")
            if len(value) >= 8:
                secrets.add(value.encode())
    return sorted(secrets, key=len, reverse=True)


def redact(data: bytes, secrets: list[bytes]) -> bytes:
    for secret in secrets:
        data = data.replace(secret, b'[REDACTED]')
    for pattern in SECRET_SHAPES:
        data = pattern.sub(b'[REDACTED]', data)
    return data


def assert_clean(data: bytes, secrets: list[bytes]) -> None:
    if any(secret in data for secret in secrets):
        raise RuntimeError('A configured secret remains in the report')
    if any(pattern.search(data) for pattern in SECRET_SHAPES):
        raise RuntimeError('A key-shaped value remains in the report')


source = SOURCE.read_bytes()
match = EMBEDDED_ZIP.search(source)
if not match:
    raise SystemExit('Expected embedded Playwright report archive not found')
secrets = configured_secrets()

archive_buffer = io.BytesIO()
clean_entries = []
with zipfile.ZipFile(io.BytesIO(base64.b64decode(match.group(1)))) as original:
    with zipfile.ZipFile(archive_buffer, 'w') as sanitized:
        for info in original.infolist():
            data = redact(original.read(info.filename), secrets)
            assert_clean(data, secrets)
            clean_entries.append(data)
            sanitized.writestr(info, data)

clean_html = redact(source[:match.start(1)], secrets)
clean_html += base64.b64encode(archive_buffer.getvalue())
clean_html += redact(source[match.end(1):], secrets)
assert_clean(clean_html, secrets)

TARGET.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
fd, temporary = tempfile.mkstemp(prefix='.index.', dir=TARGET.parent)
try:
    os.fchmod(fd, 0o644)
    with os.fdopen(fd, 'wb') as output:
        output.write(clean_html)
    os.replace(temporary, TARGET)
finally:
    if os.path.exists(temporary):
        os.unlink(temporary)

print(f'published sanitized report: {TARGET}; embedded entries={len(clean_entries)}')
