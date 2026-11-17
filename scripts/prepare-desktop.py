#!/usr/bin/env python3
"""Prepare pinned source + ordered patches; optionally install types and typecheck.

This does not build a runnable Electron app or the native mail engine.
"""
import argparse
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent.parent
DESKTOP = '535f13dd463536f36728bce3efb4ae0d51ab3f19'
NATIVE = '8681eae1d217d993e4d4dc7de17ae8b91fc3da49'
NATIVE_PATCHES = {'0001-mail-core-guards.patch', '0008-recovery-provenance.patch', '0023-independent-engine-path.patch', '0024-gmail-https-send.patch'}


def run(*args, cwd=None):
    subprocess.run(args, cwd=cwd, check=True)


def checkout(destination, url, revision, source=None):
    if source:
        run('git', 'clone', '--quiet', '--shared', '--no-checkout', str(source), str(destination))
    else:
        run('git', 'init', '--quiet', str(destination))
        run('git', 'remote', 'add', 'origin', url, cwd=destination)
        run('git', 'fetch', '--depth=1', 'origin', revision, cwd=destination)
    run('git', 'checkout', '--quiet', '--detach', revision, cwd=destination)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('destination', type=Path, help='New directory; existing checkouts are never modified')
    parser.add_argument('--source', type=Path, help='Reuse local Git objects for an offline preparation')
    parser.add_argument('--compare', type=Path, help='Compare patched files with a tested checkout')
    parser.add_argument('--typecheck', action='store_true', help='npm ci --ignore-scripts in root/app, then full TypeScript check')
    args = parser.parse_args()
    dest = args.destination.resolve()
    if dest.exists():
        parser.error('destination must not already exist')
    source = args.source.resolve() if args.source else None
    checkout(dest, 'https://github.com/Foundry376/Mailspring.git', DESKTOP, source)
    checkout(dest / 'mailsync', 'https://github.com/Foundry376/Mailspring-Sync.git', NATIVE,
             source / 'mailsync' if source else None)
    touched = set()
    patches = sorted((ROOT / 'research/patches').glob('*.patch'))
    for patch in patches:
        native = patch.name in NATIVE_PATCHES
        run('git', 'apply', '--check', str(patch), cwd=dest / 'mailsync' if native else dest)
        run('git', 'apply', str(patch), cwd=dest / 'mailsync' if native else dest)
        for line in patch.read_text().splitlines():
            if line.startswith('+++ b/'):
                touched.add(('mailsync/' if native else '') + line[6:])
    if args.compare:
        for name in sorted(touched):
            if (dest / name).read_bytes() != (args.compare / name).read_bytes():
                raise RuntimeError(f'Patched source differs from tested checkout: {name}')
    for name in ('paper-reed.cjs', 'install.cjs'):
        if (ROOT / 'research/cli' / name).read_bytes() != (dest / 'app/internal_packages/mcp-server/bin' / name).read_bytes():
            raise RuntimeError(f'CLI source differs from bundled copy: {name}')
    print(f'PASS: {len(patches)} patches applied; {len(touched)} source files checked; CLI copies match.', flush=True)
    if args.typecheck:
        # Type checking needs declarations, not Electron native rebuilds or mail credentials.
        for folder in (dest, dest / 'app'):
            run('npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund', cwd=folder)
        run('npm', 'run', 'typecheck', cwd=dest)


if __name__ == '__main__':
    main()
