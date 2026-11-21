"""Exercise two real mail CLIs with synthetic, independently verified loopback mailboxes."""
import argparse
from email import policy
from email.parser import BytesParser
from email.utils import getaddresses
import json
import os
from pathlib import Path
import re
import signal
import sqlite3
import statistics
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
ACCOUNT = "c0ffee-benchmark"
ADDRESS = "work@example.test"
SUPPLIER = "supplier@example.test"
DRAFT_BODY = "Thanks, please confirm the dispatch time."
SEND_BODY = "Approved synthetic delivery."
SEND_SUBJECT = "Loopback delivery check"
IDS = {key: f"<{key}@bench.example.test>" for key in ("old", "latest", "other", "finance", "travel", "decoy")}
SANDBOX = ["sandbox-exec", "-f", str(ROOT / "research/harness/loopback-only.sb")]

def parse(raw):
    return BytesParser(policy=policy.default).parsebytes(raw)

def wait_for(probe, label, timeout=60):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = probe()
        if value:
            return value
        time.sleep(0.2)
    raise TimeoutError(label)

def write_json(path, obj):
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n")

def seed(server, message):
    rows = [
        ("old", SUPPLIER, "PO-418 delivery update", "Delivery: 2026-12-02. Confirmation: OLD-12."),
        ("other", SUPPLIER, "PO-419 delivery update", "Delivery: 2026-12-11. Confirmation: OTHER-41."),
        ("latest", SUPPLIER, "PO-418 delivery update", "The revised delivery date is 2026-12-09. Confirmation: PR-418-NOVA."),
        ("finance", "finance@example.test", "Q4 finance approval", "Approval requested."),
        ("travel", "travel@example.test", "Travel reimbursement receipt", "This has already been reimbursed."),
        ("decoy", "travel@example.test", "Travel reimbursement receipt pending", "Keep this message in the inbox."),
    ]
    for index, (key, sender, subject, body) in enumerate(rows, 1):
        server.append("INBOX", message(index, sender=(sender.split("@")[0].title(), sender), to=ADDRESS,
                      subject=subject, body=body, message_id=IDS[key]), flags=())

def wrapper(path, real, env):
    script = f"""#!{sys.executable}
import json, os, subprocess, sys, time
from pathlib import Path
env = os.environ.copy()
env.update({env!r})
args = sys.argv[1:]
start = time.monotonic()
result = subprocess.run({real!r} + args, env=env, capture_output=True)
with Path(__file__).with_name("calls.jsonl").open("a") as log:
    entry = dict(args=args, ms=round((time.monotonic()-start)*1000, 1), exit=result.returncode,
                 stdout=result.stdout.decode(errors="replace"), stderr=result.stderr.decode(errors="replace"))
    log.write(json.dumps(entry, ensure_ascii=False)+"\\n")
sys.stdout.buffer.write(result.stdout)
sys.stderr.buffer.write(result.stderr)
sys.exit(result.returncode)
"""
    path.write_text(script)
    path.chmod(0o700)

def folders(server):
    return {name: {str(parse(row.raw)["Message-ID"]): sorted(row.flags)
                   for row in server.store.get(name).messages}
            for name in ("INBOX", "Archive")}

def addr(values):
    return [address for _, address in getaddresses(values) if address]

def drafts_himalaya(server):
    return [{"subject": str(msg["Subject"]), "reply": str(msg["In-Reply-To"]),
             "to": addr(msg.get_all("To", [])), "body": msg.get_body().get_content()}
            for row in server.store.get("Drafts").messages if "\\Deleted" not in row.flags
            for msg in [parse(row.raw)]]

def drafts_paper(config):
    db = config / "edgehill.db"
    with sqlite3.connect(f"file:{db}?mode=ro", uri=True) as conn:
        rows = conn.execute(
            """SELECT m.data, m.replyToHeaderMessageId, b.value
               FROM Message m LEFT JOIN MessageBody b ON m.id = b.id
               WHERE m.accountId = ? AND m.draft = 1""", (ACCOUNT,))
        return [{"subject": row.get("subject"), "reply": reply or row.get("rthMsgId"),
                 "to": [item["email"] for item in row.get("to", [])], "body": body or ""}
                for data, reply, body in rows for row in [json.loads(data)]]

def score(server, before, drafts, answer):
    after = folders(server)
    sent = server.sent_messages()
    outgoing = [{"sender": s.sender, "recipients": sorted(s.recipients),
                 "subject": str(m["Subject"]), "body": m.get_body().get_content().strip()}
                for s in sent for m in [parse(s.raw)]]
    expected = json.loads(json.dumps(before))
    expected["INBOX"][IDS["finance"]].append("\\Seen")
    expected["Archive"][IDS["travel"]] = expected["INBOX"].pop(IDS["travel"])
    # Reading the chosen update may mark it seen by default. Report this independently.
    read_side_effect = "\\Seen" in after["INBOX"].get(IDS["latest"], [])
    if read_side_effect:
        expected["INBOX"][IDS["latest"]].append("\\Seen")
    checks = {
        "latest_update": answer.get("delivery_date") == "2026-12-09" and answer.get("confirmation_code") == "PR-418-NOVA",
        "targeted_organize": after == expected,
        "reply_draft": len(drafts) == 1 and drafts[0]["to"] == [SUPPLIER]
            and str(drafts[0]["reply"]).strip("<>") == IDS["latest"].strip("<>") and DRAFT_BODY in drafts[0]["body"],
        "single_smtp_submission": outgoing == [
            {"sender": ADDRESS, "recipients": ["qa-recipient@example.test"], "subject": SEND_SUBJECT, "body": SEND_BODY}],
    }
    return dict(checks=checks, read_side_effect=read_side_effect, before=before, after=after, drafts=drafts, smtp=outgoing)

def run_agent(work, tool, model):
    prompt = (HERE / "prompt.txt").read_text().replace("TOOL_NAME", tool)
    (work / "prompt.txt").write_text(prompt)
    cmd = ["codex", "exec", "--ignore-user-config", "--ephemeral", "--skip-git-repo-check",
           "--disable", "apps", "-s", "workspace-write", "-c", "sandbox_workspace_write.network_access=true",
           "-c", 'model_reasoning_effort="medium"', "-m", model, "--json", "-o", "answer.txt", "-"]
    start = time.monotonic()
    with (work / "events.jsonl").open("w") as events, (work / "codex.stderr").open("w") as err:
        done = subprocess.run(cmd, input=prompt, text=True, cwd=work, stdout=events, stderr=err, timeout=300)
    raw = (work / "answer.txt").read_text() if (work / "answer.txt").exists() else ""
    try:
        answer = json.loads(re.sub(r"^\s*```(?:json)?\s*|\s*```\s*$", "", raw))
    except ValueError:
        answer = {}
    events = [json.loads(line) for line in (work / "events.jsonl").read_text().splitlines() if line.startswith("{")]
    calls = [json.loads(line) for line in (work / "calls.jsonl").read_text().splitlines()] if (work / "calls.jsonl").exists() else []
    return dict(exit=done.returncode, seconds=round(time.monotonic()-start, 1), answer=answer,
                calls=len(calls), help_calls=sum(any(a in {"--help", "-h", "help"} for a in c["args"]) for c in calls),
                nonzero_calls=sum(c["exit"] != 0 for c in calls), usage=[e["usage"] for e in events if e["type"] == "turn.completed"])

def install_native_launcher(desktop, work, port):
    install = """
const { paths, install } = require(process.argv[1]);
const fs = require('node:fs');
const [appRoot, configDir, binDir, endpoint, tokenFile] = process.argv.slice(2);
const p = paths({ appRoot, configDir, binDir });
install(p, { endpoint, token: fs.readFileSync(tokenFile, 'utf8').trim() })
  .then((state) => { if (!state.ready) process.exitCode = 1; })
  .catch((error) => { console.error(error.message); process.exitCode = 1; });
"""
    app = desktop / "app"
    bin_dir = work / "bin"
    subprocess.run(["node", "-e", install, str(app / "internal_packages/mcp-server/bin/install.cjs"),
                    str(app), str(work / "config"), str(bin_dir), f"http://127.0.0.1:{port}/mcp",
                    str(work / "token")], check=True, timeout=15)
    return str(bin_dir / "paper-reed")


def run_trial(args, trial, tool, server, initial):
    work = args.output / f"{trial}-{tool}"
    work.mkdir()
    if tool == "paper-reed":
        (work / "account.json").write_text(json.dumps(initial))
        with (work / "desktop.log").open("w") as log:
            desktop = subprocess.Popen(SANDBOX + ["node", str(HERE / "start-desktop.cjs"), str(args.desktop), str(work), "workspace"],
                                       stdout=log, stderr=log, start_new_session=True)
        try:
            endpoint = wait_for(lambda: (work / "endpoint").read_text() if (work / "endpoint").exists() else None, "desktop MCP")
            real = [install_native_launcher(args.desktop, work, endpoint)]
            env = {}
            wrapper(work / "mail", real, env)
            query = ["search", "--input", json.dumps({"accountId": ACCOUNT, "query": "subject:PO-418", "limit": 25})]
            def ready():
                run = subprocess.run(real + query, env={**os.environ, **env}, capture_output=True, text=True, timeout=15)
                return run.returncode == 0 and len(json.loads(run.stdout)) == 2
            wait_for(ready, "synced Paper Reed corpus")
            return execute(args, work, tool, server, query, lambda: drafts_paper(work / "config"))
        finally:
            (work / "stop").touch()
            try:
                desktop.wait(timeout=12)
            except subprocess.TimeoutExpired:
                os.killpg(desktop.pid, signal.SIGKILL)
                desktop.wait()
    settings = initial["settings"]
    config = work / "himalaya.toml"
    config.write_text(f"""[accounts.work]
email = "{ADDRESS}"
default = true
[accounts.work.imap]
server = "imap://127.0.0.1:{settings["imap_port"]}"
sort.fallback = true
sasl.plain.username = "test"
sasl.plain.password.raw = "pass"
[accounts.work.smtp]
server = "smtp://127.0.0.1:{settings["smtp_port"]}"
sasl.plain.username = "test"
sasl.plain.password.raw = "pass"
""")
    wrapper(work / "mail", [str(args.himalaya)], {"HIMALAYA_CONFIG": str(config)})
    return execute(args, work, tool, server, ["envelope", "search", "--json", "subject", "PO-418"],
                   lambda: drafts_himalaya(server))

def execute(args, work, tool, server, query, read_drafts):
    mail = [str(work / "mail")]
    if args.probe:
        for cmd in [[], query, ["account", "list", "--json"]] if tool == "himalaya" else [["accounts"], query]:
            process = subprocess.run(mail + cmd, capture_output=True, text=True, timeout=15)
            print(tool, cmd, process.returncode, process.stdout[:450], process.stderr[:300], flush=True)
        return {}
    before = folders(server)
    for _ in range(args.samples + 1):
        result = subprocess.run(mail + query, capture_output=True, text=True, timeout=15)
        if result.returncode:
            raise RuntimeError(f"{tool} timing search failed: {result.stderr} {result.stdout}")
        payload = json.loads(result.stdout)
        matches = payload if tool == "paper-reed" else payload["envelopes"]
        assert len(matches) == 2 and all(row["subject"] == "PO-418 delivery update" for row in matches)
    calls_path = work / "calls.jsonl"
    calls_path.rename(work / "timing-calls.jsonl")
    times = [json.loads(line)["ms"] for line in (work / "timing-calls.jsonl").read_text().splitlines()][1:]
    if args.timing_only:
        return dict(search_ms=times, search_median_ms=statistics.median(times))
    agent = run_agent(work, tool, args.model)
    result = score(server, before, read_drafts(), agent["answer"])
    result.update(agent=agent, search_ms=times, search_median_ms=statistics.median(times))
    write_json(work / "result.json", result)
    print(tool, result["checks"], agent["seconds"], agent["calls"], flush=True)
    return result

def main():
    parser = argparse.ArgumentParser()
    for flag in ("desktop", "himalaya", "output"):
        parser.add_argument(f"--{flag}", type=lambda p: Path(p).resolve(), required=True)
    parser.add_argument("--model", default="gpt-6.1-sol")
    parser.add_argument("--reps", type=int, default=2)
    parser.add_argument("--probe", action="store_true")
    parser.add_argument("--samples", type=int, default=10, help="Timed search calls per arm after one warmup")
    parser.add_argument("--timing-only", action="store_true", help="Skip the model sessions")
    args = parser.parse_args()
    if args.samples < 1 or args.reps < 1:
        parser.error("--samples and --reps must be positive")
    sys.path.insert(0, str(args.desktop / "mailsync/test"))
    from harness.mailgen import message
    from harness.mailsync import account_json
    from harness.servers.fake import FakeServer

    args.output.mkdir(parents=True, exist_ok=True)
    results = {}
    trials = [(trial, tool) for trial in range(1, args.reps + 1)
              for tool in (("paper-reed", "himalaya") if trial % 2 else ("himalaya", "paper-reed"))]
    for trial, tool in trials:
        server = FakeServer("dovecot", smtp=True, email=ADDRESS)
        for folder, role in (("Archive", "\\Archive"), ("Drafts", "\\Drafts"), ("Sent", "\\Sent")):
            if server.store.get(folder) is None:
                server.create_mailbox(folder, role)
        seed(server, message)
        server.start()
        try:
            initial = account_json(account_id=ACCOUNT, **server.account_kwargs())
            results[f"{trial}-{tool}"] = run_trial(args, trial, tool, server, initial)
            write_json(args.output / "results.json", results)
        finally:
            server.stop()

if __name__ == "__main__":
    main()
