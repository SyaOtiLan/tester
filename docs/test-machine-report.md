# Scheduled test-machine reports

The report pipeline runs enabled Playwright projects, publishes a redacted
HTML snapshot grouped by product, and sends a Feishu card with linked counts.
Original logs and JUnit data remain outside the public report directory.

## Requirements

Use a Linux host with the repository's Node.js and pnpm dependencies installed,
Python 3.10+, GNU `timeout`, `flock`, Xvfb, and Bubblewrap (`bwrap`). Configure
`.env.local` as described in the main README. The runner uses
`playwright.safe.config.ts`, one worker, and a browser environment that hides
GPU device information; this configuration excludes the retired Knowledge
project. Other product assertions are unchanged by this report pipeline.

The runner checks available memory, disk space and stuck Chromium processes.
A nonblocking lock prevents overlap, and execution is limited to 2.5 hours.

## Configuration

| Variable                    | Default                               | Purpose                                          |
| --------------------------- | ------------------------------------- | ------------------------------------------------ |
| `TESTER_NODE_BIN`           | `node` on `PATH`                      | Node.js executable                               |
| `TESTER_REPORT_DIR`         | `/data/test-results`                  | Public report directory                          |
| `TESTER_PRIVATE_REPORT_DIR` | `/data/test-results-private`          | Raw results and private configuration            |
| `TESTER_LOCK_FILE`          | `/run/lock/yeying-tester-full.lock`   | Run lock; parent must exist and be writable      |
| `TESTER_STUCK_CHROME_LIMIT` | `0`                                   | Maximum existing D-state Chromium processes      |
| `TESTER_FEISHU_CONFIG`      | `feishu.env` in the private directory | Optional private notification settings           |
| `TESTER_FEISHU_WEBHOOK_URL` | unset                                 | Intended report group's robot webhook            |
| `TESTER_FEISHU_SECRET`      | unset                                 | Optional robot signing secret                    |
| `TESTER_REPORT_URL`         | unset                                 | Public HTTPS report directory, including subpath |

Notification settings can be environment variables or entries in the private
file. Environment variables take precedence. Start with the example:

```bash
sudo install -d -m 700 /data/test-results-private
sudo install -m 600 scripts/feishu.env.example /data/test-results-private/feishu.env
```

Fill in the real webhook and report URL in that private file. Never commit
credentials or the filled file. An unset webhook disables notification.
Notification failure preserves the report and the test runner's exit code.

## Daily schedule

Review the repository path, Node.js location, directories and host timezone
before installing `scripts/yeying-tester-full.cron`. The example runs daily at
**03:00** on a host configured for **Asia/Shanghai**; it does not set the timezone.

```bash
sudo install -m 644 scripts/yeying-tester-full.cron /etc/cron.d/yeying-tester-full
# Manual run:
bash scripts/run-full-on-test-machine.sh
```

Exit `0` means a passed suite or a preflight skip; `last-attempt.txt` distinguishes
them. Exit `1` can publish a report containing failed tests. Timeout, stale or
invalid results, and a run with no executed tests retain the previous report.

## Published files and links

Serve only `TESTER_REPORT_DIR`. Do not expose the repository `reports/` directory,
JUnit XML or the private directory.

```text
index.html                 Latest overview grouped by product
full.html                  Latest redacted Playwright report
latest.json                Start/end times, counts and archived report paths
last-attempt.txt           Most recent attempt status
runs/<run>/index.html      Archived overview
runs/<run>/full.html       Archived redacted Playwright report
runs/<run>/summary.json    Archived summary
```

The publisher redacts configured sensitive values and credential shapes from
HTML and its embedded ZIP. The Playwright configuration omits the complete
environment object from report metadata. Public HTML titles are escaped.
The pipeline does not publish raw trace or screenshot attachment directories.
Failed or incomplete publication does not replace the previous overview.

Skipped cases remain skips. Their displayed reason categories are review hints,
not proof that the environment or product is correct; unknown reasons stay visible.

A completed run's Feishu card shows its start and finish time in Beijing time,
with one row per product and linked pass/fail/skip counts. Links open that run's
archived `full.html` using Playwright `p:<project>` and `s:<status>` filters.
They keep pointing to the same run after a later report is published.
Summary and JUnit counts must agree before a card is generated.

## Validate the report pipeline

These checks use synthetic fixtures without product tests or group messages:

```bash
python3 -m unittest discover -s scripts/tests -v
bash -n scripts/run-full-on-test-machine.sh
```
