#!/usr/bin/env python3
"""Build a configured Paper Reed macOS preview using the prepared upstream checkout."""
import argparse
import os
import shutil
from pathlib import Path
import subprocess
import sys

from stage_native_cli import require_go, stage_native_cli

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--upstream', type=Path, default=ROOT / 'research/.local/Mailspring')
parser.add_argument('--google-client', type=Path, default=os.environ.get('PAPER_REED_GOOGLE_CLIENT_FILE'),
                    help='Project Google Desktop client JSON (or PAPER_REED_GOOGLE_CLIENT_FILE)')
parser.add_argument('--version', default='0.0.1')
parser.add_argument('--skip-archive', action='store_true', help='Build .app without the ZIP archive')
args = parser.parse_args()
if sys.platform != 'darwin':
    parser.error('This entry point builds the macOS preview.')
if not args.google_client or not args.google_client.is_file():
    parser.error('Provide the project Google Desktop client JSON with --google-client.')
try:
    require_go()
    app = args.upstream / 'app'
    cli_sources = ('install.cjs', 'paper-reed.cjs')
    installer_dir = app / 'internal_packages/mcp-server/bin'
    if ('await buildNativeCLI();' not in (app / 'build/build.js').read_text() or
            any((installer_dir / name).read_bytes() != (ROOT / 'research/cli' / name).read_bytes()
                for name in cli_sources)):
        parser.error('Prepare the upstream checkout with scripts/prepare-desktop.py before building.')
    stage_native_cli(args.upstream)
except FileNotFoundError:
    parser.error('Prepare the upstream checkout with scripts/prepare-desktop.py before building.')
except RuntimeError as error:
    parser.error(str(error))
for asset, target in [('paper-reed.icns', 'app/build/resources/mac/paper-reed.icns'),
                      ('app-icon.png', 'app/static/paper-reed-icon.png'),
                      ('mark.svg', 'app/static/paper-reed-mark.svg')]:
    shutil.copy2(ROOT / 'assets/brand' / asset, args.upstream / target)
revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
if subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT, text=True).strip():
    revision += '-dirty'
env = dict(os.environ, PAPER_REED_GOOGLE_CLIENT_FILE=str(args.google_client.resolve()),
           PAPER_REED_VERSION=args.version, PAPER_REED_SOURCE_COMMIT=revision)
command = ['node', 'app/build/build.js']
if args.skip_archive:
    command.append('--skip-installers')
subprocess.run(command, cwd=args.upstream.resolve(), env=env, check=True)
print(f'Built Paper Reed {args.version} from {revision}; signing/notarization depend on build configuration.')
