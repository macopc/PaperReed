"""Syntax-check patched integration without loading Xcode build plugins.

Uses source headers, not a generated framework or linked MailCore. The committed
libetpan config/version headers have portable non-Windows branches; this check
cannot validate the real macOS configure output, ABI, linking, or packaging.
"""
import argparse
from pathlib import Path
import subprocess
import tempfile

p = argparse.ArgumentParser()
p.add_argument('--sync', type=Path, required=True)
sync = p.parse_args().sync.resolve()
with tempfile.TemporaryDirectory(prefix='paper-reed-syntax-') as tmp:
    headers = Path(tmp)
    for name, source in [('MailCore', sync / 'Vendor/mailcore2/src'),
                         ('libetpan', sync / 'Vendor/libetpan/src')]:
        out = headers / name
        out.mkdir()
        for header in source.rglob('*.h'):
            target = out / header.name
            if not target.exists():
                target.symlink_to(header)
    for name in ['libetpan-config.h', 'libetpan_version.h']:
        (headers / 'libetpan' / name).symlink_to(sync / 'Vendor/libetpan/build-windows' / name)
    include = ['MailSync', 'MailSync/Models', 'Vendor', 'Vendor/nlohmann',
               'Vendor/SQLiteCpp/include', 'Vendor/icalendarlib', 'Vendor/StanfordCPPLib']
    subprocess.run(['clang++', '-std=c++17', '-fsyntax-only', '-Wno-deprecated-declarations',
                    '-I' + str(headers), *['-I' + str(sync / directory) for directory in include],
                    str(sync / 'MailSync/TaskProcessor.cpp'), str(sync / 'MailSync/MailStore.cpp')], check=True)
    print('PASS TaskProcessor.cpp and MailStore.cpp syntax (not linked or executed)')
