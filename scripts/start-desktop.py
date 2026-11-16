#!/usr/bin/env python3
"""Start the prepared development checkout with normal Paper Reed onboarding."""
import argparse
import os
from pathlib import Path

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--upstream', type=Path, default=root / 'research/.local/Mailspring')
parser.add_argument('--config-dir', type=Path, help='Optional separate profile; defaults to Paper Reed-dev')
args = parser.parse_args()
upstream = args.upstream.resolve()
electron_dir = upstream / 'node_modules/electron'
try:
    executable = electron_dir / 'dist' / (electron_dir / 'path.txt').read_text().strip()
except FileNotFoundError:
    parser.error('Electron is not installed in this checkout. See research/first-run-validation-2026-11-16/README.md.')
command = [str(executable), str(upstream / 'app'), '--dev']
if args.config_dir:
    command += ['--config-dir-path', str(args.config_dir.resolve())]
env = dict(os.environ)
env.pop('ELECTRON_RUN_AS_NODE', None)
os.execve(executable, command, env)
