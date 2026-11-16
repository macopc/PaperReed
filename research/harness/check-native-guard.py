"""Compile the actual patched guard with upstream SQLiteCpp and bundled SQLite."""
import argparse
from pathlib import Path
import subprocess
import tempfile

p = argparse.ArgumentParser()
p.add_argument('--sync', type=Path, required=True)
args = p.parse_args()
sync = args.sync.resolve()
root = Path(__file__).resolve().parent
with tempfile.TemporaryDirectory(prefix='paper-reed-guard-') as tmp:
    tmp = Path(tmp)
    vendor = sync / 'Vendor'
    sqlite = vendor / 'SQLiteCpp'
    subprocess.run(['clang', '-c', '-DSQLITE_OMIT_LOAD_EXTENSION',
                    str(sqlite / 'sqlite3/sqlite3.c'), '-o', str(tmp / 'sqlite.o')], check=True)
    sources = ['Column', 'Database', 'Exception', 'Statement', 'Transaction', 'Backup', 'Savepoint']
    subprocess.run(['clang++', '-std=c++17', '-Wall', '-Wextra',
                    '-DSQLITE_OMIT_LOAD_EXTENSION', '-DSQLITECPP_COMPILE_ASSERT',
                    '-I' + str(sync / 'MailSync'), '-I' + str(vendor / 'nlohmann'),
                    '-I' + str(sqlite / 'include'), '-I' + str(sqlite / 'sqlite3'),
                    str(root / 'native/mail-mutation-guard-test.cpp'),
                    *[str(sqlite / 'src' / (s + '.cpp')) for s in sources],
                    str(tmp / 'sqlite.o'), '-o', str(tmp / 'guard-test')], check=True)
    subprocess.run([str(tmp / 'guard-test'), str(tmp / 'test.db')], check=True)
