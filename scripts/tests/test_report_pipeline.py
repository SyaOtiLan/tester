"""Offline checks for public reports and Feishu links; no external calls."""

import base64
import csv
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import unquote
import zipfile
import xml.etree.ElementTree as ET


SCRIPTS = Path(__file__).resolve().parents[1]
STAMP = '2026-10-13_03-00-01+0800'
FINISHED = '2026-10-13T03:10:01+08:00'
REPORT_URL = 'https://tester.example.com/report/'
JUNIT = '''<testsuites><testsuite>
<testcase classname="products/chat/tests/a.spec.ts" name="first"/>
<testcase classname="products/chat/tests/a.spec.ts" name="second"><failure/></testcase>
<testcase classname="products/router/tests/b.spec.ts" name="third"><skipped/></testcase>
</testsuite></testsuites>'''


def load_module(name, filename):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


notifier = load_module('report_notifier', 'notify-feishu-report.py')
project_report = load_module('project_report', 'publish-project-report.py')
full_report = load_module('full_report', 'publish-bilingual-report.py')


def html_fixture(text=''):
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, 'w') as output:
        output.writestr('report.json', json.dumps({'text': text}))
    encoded = base64.b64encode(archive.getvalue()).decode()
    return f'<html><head></head><body>{text}<script>data:application/zip;base64,{encoded}</script></body></html>'


class NotificationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / STAMP).mkdir()
        (self.root / STAMP / 'junit.xml').write_text(JUNIT, encoding='utf-8')
        self.summary = self.root / 'latest.json'
        self.data = {
            'run': STAMP, 'tests': 3, 'passed': 1, 'failed': 1, 'skipped': 1,
            'full_report': f'runs/{STAMP}/full.html', 'finished_at': FINISHED,
        }
        self.write_summary()

    def write_summary(self):
        self.summary.write_text(json.dumps(self.data), encoding='utf-8')

    def card(self):
        return notifier.make_payload(STAMP, 'published: test runner exit code 1',
                                     REPORT_URL, self.summary, self.root)

    def test_project_counts_links_and_both_times(self):
        payload = self.card()
        self.assertEqual(payload['msg_type'], 'interactive')
        elements = payload['card']['body']['elements']
        self.assertIn('开始：2026-10-13 03:00:01', elements[0]['content'])
        self.assertIn('结束：2026-10-13 03:10:01', elements[0]['content'])
        rows = elements[1]['rows']
        self.assertEqual([row['project'] for row in rows], ['chat', 'router'])
        self.assertTrue(rows[0]['failed'].startswith('[1]('))
        self.assertIn(f'{REPORT_URL}runs/{STAMP}/full.html', rows[0]['failed'])
        self.assertIn('#?q=p:chat s:failed', unquote(rows[0]['failed']))
        self.assertIn('#?q=p:router s:skipped', unquote(rows[1]['skipped']))

    def test_wrong_run_or_counts_are_rejected(self):
        self.data['passed'] = 2
        self.write_summary()
        with self.assertRaisesRegex(ValueError, 'counts'):
            self.card()
        self.data['passed'] = 1
        self.data['run'] = 'another-run'
        self.write_summary()
        with self.assertRaisesRegex(ValueError, 'match this run'):
            self.card()

    def test_skipped_run_uses_status_text_and_no_old_counts(self):
        payload = notifier.make_payload(STAMP, 'skipped: low memory', '',
                                        finished_at=FINISHED)
        self.assertEqual(payload['msg_type'], 'text')
        self.assertIn('上一份报告保留', payload['content']['text'])
        self.assertNotIn('通过 1', payload['content']['text'])

    def test_environment_config_without_private_file(self):
        with patch.object(notifier, 'CONFIG', self.root / 'absent.env'):
            with patch.dict(os.environ, {'TESTER_REPORT_URL': REPORT_URL}):
                self.assertEqual(notifier.load_config()['TESTER_REPORT_URL'], REPORT_URL)

    def test_no_network_send_when_constructing_card(self):
        with patch.object(notifier, 'urlopen', side_effect=AssertionError('Unexpected network')):
            self.card()


class PublicationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.junit = self.root / 'junit.xml'
        self.junit.write_text(JUNIT, encoding='utf-8')

    def run_script(self, filename, *args, env=None):
        return subprocess.run([sys.executable, str(SCRIPTS / filename), *map(str, args)],
                              env=env, capture_output=True, text=True)

    def test_orchestrator_missing_url_skip_is_environment_category(self):
        case = ET.Element('testcase')
        ET.SubElement(case, 'skipped')
        properties = ET.SubElement(case, 'properties')
        ET.SubElement(properties, 'property', {
            'name': 'skip', 'value': 'ORCHESTRATOR_BASE_URL not configured',
        })
        self.assertEqual(
            project_report.skip_info(case),
            ('environment', 'ORCHESTRATOR_BASE_URL not configured'),
        )

    @unittest.skipUnless(hasattr(os, 'fchmod'), 'Linux publication permissions')
    def test_redacts_html_zip_and_retains_old_on_invalid_source(self):
        fake_key = 'sk-' + 'syntheticcredential123456789'
        fake_ak = 'yyak_' + 'syntheticaccesskey123456789'
        fake_sk = 'yysk_' + 'syntheticsecretkey123456789'
        secret_text = ' '.join((fake_key, fake_ak, fake_sk))
        source = self.root / 'input.html'
        target = self.root / 'public.html'
        source.write_text(html_fixture(secret_text), encoding='utf-8')
        env = {**os.environ, 'TESTER_REPORT_SOURCE': str(source),
               'TESTER_REPORT_TARGET': str(target)}
        result = self.run_script('publish-sanitized-report.py', env=env)
        self.assertEqual(result.returncode, 0, result.stderr)
        rendered = target.read_bytes()
        match = re.search(rb'data:application/zip;base64,([A-Za-z0-9+/=]+)', rendered)
        with zipfile.ZipFile(io.BytesIO(base64.b64decode(match.group(1)))) as archive:
            embedded = archive.read('report.json')
        for value in (fake_key, fake_ak, fake_sk):
            self.assertNotIn(value.encode(), rendered)
            self.assertNotIn(value.encode(), embedded)
        source.write_text('invalid report', encoding='utf-8')
        result = self.run_script('publish-sanitized-report.py', env=env)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(target.read_bytes(), rendered)

    def test_project_overview_escapes_titles_and_preserves_skips(self):
        self.junit.write_text(JUNIT.replace('first', '&lt;script&gt;bad&lt;/script&gt;'),
                              encoding='utf-8')
        rendered = project_report.render(self.junit, STAMP)
        self.assertIn('&lt;script&gt;bad&lt;/script&gt;', rendered)
        self.assertNotIn('<script>bad</script>', rendered)
        self.assertIn('id="project-chat"', rendered)
        self.assertIn('未标注跳过', rendered)
        self.assertIn('<span>跳过</span><b>1</b>', rendered)

    def test_project_downloads_are_isolated_bilingual_and_redacted(self):
        secret = 'sk-syntheticcredential123456789'
        root = ET.Element('testsuites')
        suite = ET.SubElement(root, 'testsuite')
        failed = ET.SubElement(suite, 'testcase', {
            'classname': 'products/router/tests/example.spec.ts',
            'name': 'router failure', 'time': '0.2',
        })
        ET.SubElement(failed, 'failure', {'message': '=HYPERLINK("bad")'}).text = secret
        ET.SubElement(suite, 'testcase', {
            'classname': 'products/chat/tests/example.spec.ts',
            'name': 'chat success', 'time': '0.1',
        })
        ET.ElementTree(root).write(self.junit, encoding='unicode')
        with patch.object(project_report, 'configured_secrets', return_value=[secret.encode()]):
            page = project_report.render(self.junit, STAMP)
            self.assertEqual(project_report.write_project_logs(
                self.junit, STAMP, self.root / 'logs'), {'router', 'chat'})
            self.assertEqual(project_report.write_error_exports(
                self.junit, self.root / 'errors'), {'router'})

        self.assertIn('id="log-language"', page)
        self.assertIn(f'runs/{STAMP}/logs/router.log', page)
        self.assertIn('data-log-en="logs/router.en.log"', page)
        self.assertIn(f'runs/{STAMP}/errors/router.csv', page)
        self.assertIn('data-export="errors/router.csv"', page)
        self.assertIn('const prefix = archived ?', page)
        for name in ('router.log', 'router.en.log'):
            content = (self.root / 'logs' / name).read_text(encoding='utf-8')
            self.assertIn('router failure', content)
            self.assertNotIn('chat success', content)
            self.assertNotIn(secret, content)
        self.assertIn('Tester project log',
                      (self.root / 'logs' / 'router.en.log').read_text(encoding='utf-8'))
        self.assertFalse((self.root / 'errors' / 'chat.csv').exists())
        with (self.root / 'errors' / 'router.csv').open(encoding='utf-8-sig', newline='') as file:
            rows = list(csv.reader(file))
        self.assertEqual(len(rows), 2)
        self.assertTrue(rows[1][3].startswith("'="))
        self.assertNotIn(secret, rows[1][4])

    def test_english_report_reuses_original_results_and_errors(self):
        location = {'file': 'products/router/tests/example.spec.ts', 'line': 12, 'column': 1}
        chinese = {'suites': [{**location, 'title': '', 'specs': [{
            **location, 'title': '中文用例', 'tests': [{'projectName': 'router'}],
        }]}]}
        english = {'suites': [{**location, 'title': '', 'specs': [{
            **location, 'title': 'English case', 'tests': [{'projectName': 'router'}],
        }]}]}
        title_map = full_report.paired_titles(chinese, english)
        test = {'testId': 'stable-id', 'title': '中文用例', 'path': [],
                'projectName': 'router', 'location': location,
                'errors': [{'message': 'original failure'}]}
        archive_bytes = io.BytesIO()
        with zipfile.ZipFile(archive_bytes, 'w') as archive:
            archive.writestr('report.json', json.dumps({'files': [{'tests': [test]}]}))
            archive.writestr('detail.json', json.dumps({'tests': [test]}))
        encoded = base64.b64encode(archive_bytes.getvalue()).decode()
        source = self.root / 'full.html'
        target = self.root / 'full.en.html'
        source.write_text('<html><script id="tester-report-language-script"></script>'
                          f'data:application/zip;base64,{encoded}</html>')
        count, _ = full_report.publish(source, target, title_map)
        self.assertEqual(count, 1)
        match = re.search(rb'data:application/zip;base64,([A-Za-z0-9+/=]+)', target.read_bytes())
        with zipfile.ZipFile(io.BytesIO(base64.b64decode(match.group(1)))) as archive:
            summary = json.loads(archive.read('report.json'))['files'][0]['tests'][0]
            detail = json.loads(archive.read('detail.json'))['tests'][0]
        for converted in (summary, detail):
            self.assertEqual(converted['title'], 'English case')
            self.assertEqual(converted['testId'], 'stable-id')
            self.assertEqual(converted['errors'][0]['message'], 'original failure')
        self.assertEqual(test['title'], '中文用例')

    @unittest.skipUnless(hasattr(os, 'fchmod'), 'Linux publication permissions')
    def test_project_menu_links_and_rejects_duplicate(self):
        report = self.root / 'full.html'
        report.write_text(html_fixture(), encoding='utf-8')
        result = self.run_script('add-project-menu.py', '--report', report, '--junit', self.junit)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('full.html?view=chat#?q=p%3Achat', report.read_text())
        saved = report.read_bytes()
        result = self.run_script('add-project-menu.py', '--report', report, '--junit', self.junit)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(report.read_bytes(), saved)


@unittest.skipUnless(sys.platform.startswith('linux'), 'Linux scheduled runner')
class RunnerTests(unittest.TestCase):
    def fixture(self, root, source_html=None):
        repo = root / 'repo'
        scripts = repo / 'scripts'
        scripts.mkdir(parents=True)
        for source in SCRIPTS.glob('*.py'):
            shutil.copyfile(source, scripts / source.name)
        shutil.copyfile(SCRIPTS / 'report-language.js', scripts / 'report-language.js')
        # The real translator is exercised above; this fixture checks the runner's
        # publication sequence without running Playwright test collection.
        (scripts / 'publish-bilingual-report.py').write_text('''
import argparse
from pathlib import Path
p = argparse.ArgumentParser()
for name in ('report', 'output', 'tester', 'node-bin'):
    p.add_argument('--' + name, required=True)
p.add_argument('--project', default='')
args = p.parse_args()
Path(args.output).write_bytes(Path(args.report).read_bytes())
''')
        shutil.copyfile(SCRIPTS / 'run-full-on-test-machine.sh',
                        scripts / 'run-full-on-test-machine.sh')
        (repo / '.env.local').write_text('# Synthetic fixture only\n')
        cli = repo / 'node_modules' / '@playwright' / 'test' / 'cli.js'
        cli.parent.mkdir(parents=True)
        cli.write_text('Synthetic runner marker')
        source = root / 'source.html'
        source.write_text(html_fixture() if source_html is None else source_html)
        junit = root / 'source.xml'
        junit.write_text(JUNIT)
        fake_bin = root / 'bin'
        fake_bin.mkdir()
        commands = {
            'free': "printf 'Mem: 17179869184 0 0 0 0 8589934592\\n'\n",
            'df': "printf 'Avail\\n10737418240\\n'\n",
            'ps': "printf 'STAT COMMAND\\n'\n",
            'xvfb-run': 'shift; shift 2; exec "$@"\n',
            'bwrap': '''while [ "$#" -gt 0 ]; do
case "$1" in
--die-with-parent) shift ;;
--bind) shift 3 ;;
--dev|--proc|--tmpfs|--chdir) shift 2 ;;
*) exec "$@" ;;
esac
done
''',
            'node': '''mkdir -p reports
cp "$FAKE_HTML" reports/index.html
cp "$FAKE_JUNIT" junit.xml
exit "${FAKE_EXIT:-1}"
''',
        }
        for name, content in commands.items():
            executable = fake_bin / name
            executable.write_text('#!/bin/sh\n' + content)
            executable.chmod(0o700)
        public = root / 'public'
        public.mkdir()
        (public / 'index.html').write_text('previous report')
        env = {**os.environ,
               'TESTER_NODE_BIN': str(fake_bin / 'node'),
               'TESTER_REPORT_DIR': str(public),
               'TESTER_PRIVATE_REPORT_DIR': str(root / 'private'),
               'TESTER_LOCK_FILE': str(root / 'run.lock'),
               'TESTER_FEISHU_CONFIG': str(root / 'absent.env'),
               'TESTER_FEISHU_WEBHOOK_URL': '',
               'TESTER_STUCK_CHROME_LIMIT': '0',
               'FAKE_HTML': str(source), 'FAKE_JUNIT': str(junit), 'FAKE_EXIT': '1'}
        return scripts, public, env

    def run_fixture(self, scripts, env):
        return subprocess.run(['bash', str(scripts / 'run-full-on-test-machine.sh')],
                              env=env, capture_output=True, text=True, timeout=15)

    def test_failed_suite_still_publishes_matching_archived_report(self):
        with tempfile.TemporaryDirectory() as temporary:
            scripts, public, env = self.fixture(Path(temporary))
            result = self.run_fixture(scripts, env)
            self.assertEqual(result.returncode, 1, result.stderr)
            summary = json.loads((public / 'latest.json').read_text())
            self.assertEqual((summary['passed'], summary['failed'], summary['skipped']),
                             (1, 1, 1))
            self.assertEqual(summary['status'], 'failed')
            self.assertTrue((public / summary['report']).is_file())
            self.assertTrue((public / summary['full_report']).is_file())
            self.assertTrue((public / 'full.en.html').is_file())
            self.assertTrue((public / 'runs' / summary['run'] / 'full.en.html').is_file())
            self.assertIn('project-chat', (public / 'index.html').read_text())
            self.assertIn('tester-project-menu', (public / 'full.html').read_text())
            self.assertLessEqual(summary['started_at'], summary['finished_at'])

    def test_failed_publication_retains_previous_report(self):
        with tempfile.TemporaryDirectory() as temporary:
            scripts, public, env = self.fixture(Path(temporary), 'not a report')
            result = self.run_fixture(scripts, env)
            self.assertEqual(result.returncode, 1)
            self.assertEqual((public / 'index.html').read_text(), 'previous report')
            self.assertFalse((public / 'latest.json').exists())
            self.assertIn('not published:', (public / 'last-attempt.txt').read_text())

    def test_missing_dependencies_retains_old_report(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            scripts = root / 'repo' / 'scripts'
            scripts.mkdir(parents=True)
            for name in ('run-full-on-test-machine.sh', 'notify-feishu-report.py'):
                shutil.copyfile(SCRIPTS / name, scripts / name)
            public = root / 'public'
            public.mkdir()
            report = public / 'index.html'
            report.write_text('previous report', encoding='utf-8')
            env = {**os.environ,
                   'TESTER_REPORT_DIR': str(public),
                   'TESTER_PRIVATE_REPORT_DIR': str(root / 'private'),
                   'TESTER_LOCK_FILE': str(root / 'run.lock'),
                   'TESTER_FEISHU_CONFIG': str(root / 'absent.env'),
                   'TESTER_FEISHU_WEBHOOK_URL': '',
                   'TESTER_NODE_BIN': '/not-an-installed-node'}
            result = subprocess.run(['bash', str(scripts / 'run-full-on-test-machine.sh')],
                                    env=env, capture_output=True, text=True, timeout=15)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(report.read_text(), 'previous report')
            self.assertIn('skipped:', (public / 'last-attempt.txt').read_text())


if __name__ == '__main__':
    unittest.main()
