#!/usr/bin/env python3
"""Write the Electron update feed for a finalized Paper Reed release ZIP."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import plistlib
import re
from zipfile import BadZipFile, ZipFile


def make_feed(archive):
    match = re.fullmatch(
        r'Paper-Reed-((?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*))-macOS-arm64\.zip',
        archive.name,
    )
    if not match:
        raise ValueError('Expected a stable Paper-Reed-<version>-macOS-arm64.zip.')
    version = match[1]
    with ZipFile(archive) as bundle:
        info = plistlib.loads(bundle.read('Paper Reed.app/Contents/Info.plist'))
        if (info.get('CFBundleIdentifier') != 'io.github.macopc.paperreed'
                or info.get('CFBundleShortVersionString') != version):
            raise ValueError('The ZIP must contain Paper Reed.app with the named release version.')
        with bundle.open('Paper Reed.app/Contents/MacOS/Paper Reed') as executable:
            # 64-bit, little-endian Mach-O, CPU_TYPE_ARM64.
            if executable.read(8) != bytes.fromhex('cffaedfe0c000001'):
                raise ValueError('The release app executable must be macOS arm64.')

    digest = hashlib.sha256()
    size = 0
    with archive.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
            size += len(chunk)

    update = {
        'version': version,
        'name': version,
        'pub_date': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'url': f'https://github.com/macopc/PaperReed/releases/download/v{version}/{archive.name}',
        'sha256': digest.hexdigest(),
        'size': size,
    }
    return {'currentRelease': version, 'releases': [{'version': version, 'updateTo': update}]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path, help='Final signed and notarized release ZIP')
    args = parser.parse_args()
    try:
        feed = make_feed(args.archive)
        output = args.archive.with_name('Paper-Reed-update-stable-macos-arm64.json')
        output.write_text(json.dumps(feed, indent=2) + '\n', encoding='utf8')
    except (OSError, BadZipFile, ValueError, KeyError, plistlib.InvalidFileException) as error:
        parser.error(str(error))
    print(output)


if __name__ == '__main__':
    main()
