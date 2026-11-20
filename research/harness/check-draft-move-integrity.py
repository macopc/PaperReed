"""Exercise draft moves through two isolated native workers with networking disabled."""
import argparse
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import time

SANDBOX = ['/usr/bin/sandbox-exec', '-p', '(version 1) (allow default) (deny network*)']
A, B, C = 'c-move-a', 'c-move-b', 'c-move-c'


def migrate(binary, env):
    subprocess.run([*SANDBOX, str(binary), '--mode', 'migrate'], check=True, env=env,
                   stdout=subprocess.DEVNULL)


def draft(account, header, body, receipt=None):
    value = {
        'aid': account, 'hMsgId': header, 'v': 0, 'subject': 'Draft move fixture',
        'body': body, 'from': [{'email': f'{account}@example.test'}], 'draft': True,
    }
    if receipt:
        value.update(id=receipt['savedDraftId'], v=receipt['savedDraftRevision'])
    return value


class NativeDrafts:
    def __init__(self, binary, output, legacy_engine, accounts=(A, B)):
        self.binary = binary
        self.accounts = accounts
        self.config = Path(tempfile.mkdtemp(prefix='native-', dir=output))
        self.env = dict(os.environ, CONFIG_DIR_PATH=str(self.config), IDENTITY_SERVER='http://127.0.0.1:1')
        self.workers = {}
        self.logs = []
        self.sequence = 0
        if legacy_engine:
            migrate(legacy_engine, self.env)
            with sqlite3.connect(self.config / 'edgehill.db') as legacy:
                legacy.execute('INSERT INTO PaperReedDraftRecovery '
                               '(accountId,copyDraftId,sourceDraftId,sourceRevision,createdAt,copyNumber) '
                               'VALUES (?,?,?,?,?,?)',
                               (A, 'legacy-copy@example.test', 'legacy-source@example.test', 4, 123, 2))
        migrate(binary, self.env)
        self.db = sqlite3.connect(self.config / 'edgehill.db')
        if legacy_engine:
            assert self.db.execute('SELECT sourceAccountId,sourceRevision,createdAt,copyNumber '
                                   'FROM PaperReedDraftRecovery WHERE copyDraftId=?',
                                   ('legacy-copy@example.test',)).fetchone() == (A, 4, 123, 2)
            print('PASS existing recovery provenance backfilled', flush=True)
        for account in self.accounts:
            identifier = account + '-drafts'
            data = {'id': identifier, 'aid': account, 'v': 1, '__cls': 'Folder', 'path': 'Drafts', 'role': 'drafts'}
            self.db.execute("INSERT INTO Folder (id,data,accountId,version,path,role) VALUES (?,?,?,1,'Drafts','drafts')",
                            (identifier, json.dumps(data), account))
            self.db.execute("INSERT OR IGNORE INTO ThreadCounts(categoryId,unread,total) VALUES (?,0,0)", (identifier,))
        self.db.commit()

    def upgrade(self, binary):
        migrate(binary, self.env)
        self.binary = binary
        self.workers, self.logs = {}, []
        self.db = sqlite3.connect(self.config / 'edgehill.db')

    def __enter__(self):
        try:
            for account in self.accounts:
                self.start(account)
        except BaseException:
            self.__exit__()
            raise
        return self

    def __exit__(self, *_):
        for process in self.workers.values():
            if process.poll() is None:
                process.terminate()
        for process in self.workers.values():
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        for log in self.logs:
            log.close()
        self.db.close()

    def start(self, account):
        settings = {}
        for protocol in ('imap', 'smtp'):
            settings.update({
                f'{protocol}_host': '127.0.0.1', f'{protocol}_port': 1,
                f'{protocol}_username': account, f'{protocol}_password': 'synthetic',
                f'{protocol}_security': 'none', f'{protocol}_allow_insecure_ssl': False,
            })
        data = {'id': account, '__cls': 'Account', 'provider': 'imap',
                'emailAddress': f'{account}@example.test', 'name': 'Move fixture', 'settings': settings, 'aliases': []}
        log = (self.config / f'{account}.out').open('a')
        self.logs.append(log)
        self.workers[account] = subprocess.Popen(
            [*SANDBOX, str(self.binary), '--mode', 'sync', '--account', json.dumps(data), '--identity', 'null'],
            env=self.env, stdin=subprocess.PIPE, text=True, stdout=log, stderr=subprocess.STDOUT,
        )

    def restart(self, account):
        process = self.workers[account]
        process.terminate()
        process.wait(timeout=5)
        self.start(account)

    def check_receipt_cleanup(self, account, evicted_id):
        self.restart(account)
        deadline = time.monotonic() + 8
        while self.db.execute('SELECT 1 FROM Task WHERE id=?', (evicted_id,)).fetchone():
            assert time.monotonic() < deadline, 'worker did not prune its oldest completed receipt'
            time.sleep(.025)
        assert self.db.execute("SELECT count(*) FROM Task WHERE accountId=? AND status='complete'",
                               (account,)).fetchone() == (100,)

    def queue_completed_failures(self, account):
        for _ in range(111):
            failed = self.queue(account, 'DestroyDraftRevisionTask', messageIds=['absent'],
                                expectedDraft={'aid': account, 'hMsgId': 'absent@example.test', 'id': 'absent', 'v': 1})
            assert failed.get('error') and failed['status'] == 'complete', failed

    def queue(self, account, cls, **payload):
        self.sequence += 1
        task_id = f'fixture-{self.sequence}-{cls}'
        task = {'id': task_id, 'aid': account, '__cls': cls, 'status': 'local', **payload}
        worker = self.workers[account]
        worker.stdin.write(json.dumps({'type': 'queue-task', 'task': task}) + '\n')
        worker.stdin.flush()
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline and worker.poll() is None:
            row = self.db.execute('SELECT data,status FROM Task WHERE id=?', (task_id,)).fetchone()
            if row and row[1] != 'local':
                return json.loads(row[0])
            time.sleep(.025)
        raise AssertionError(f'Missing receipt for {task_id}; worker exit={worker.poll()}; config={self.config}')

    def save(self, account, value, **extra):
        return self.queue(account, 'SyncbackDraftTask', draft=value, **extra)

    def move(self, source, target, header, receipt, body):
        result = self.queue(target, 'MoveDraftTask', draft=draft(target, header, body),
                            moveSource={'accountId': source, 'headerMessageId': header,
                                        'messageId': receipt['savedDraftId'], 'revision': receipt['savedDraftRevision']})
        assert result['status'] == 'complete' and not result.get('error'), result
        return result

    def rows(self, header):
        return self.db.execute(
            'SELECT m.accountId,m.id,m.version,b.value FROM Message m JOIN MessageBody b ON m.id=b.id '
            'WHERE m.draft=1 AND m.headerMessageId=? ORDER BY m.accountId', (header,),
        ).fetchall()

    def recovery_info(self, copy_header):
        return self.db.execute('SELECT accountId,sourceAccountId,sourceRevision,createdAt,copyNumber '
                               'FROM PaperReedDraftRecovery WHERE copyDraftId=?', (copy_header,)).fetchone()

    def recovery_links(self):
        # Uses the same source availability predicate as desktopDraftRecoveryInfo.
        return dict(self.db.execute('''
            SELECT r.copyDraftId, EXISTS (
                SELECT 1 FROM Message origin
                WHERE origin.accountId = r.sourceAccountId AND origin.headerMessageId = r.sourceDraftId AND origin.draft = 1
                AND r.sourceLineageId = (SELECT lineageId FROM PaperReedDraftLineage
                    WHERE accountId = origin.accountId AND headerMessageId = origin.headerMessageId AND firstRevision <= origin.version
                    ORDER BY firstRevision DESC LIMIT 1)
            ) FROM PaperReedDraftRecovery r
        '''))


def roundtrip(box):
    header = 'roundtrip@example.test'
    original = box.save(A, draft(A, header, 'Original text in A.'))
    obsolete = draft(A, header, 'Old independent window must not overwrite.', original)
    moved = box.move(A, B, header, original, 'Original text in A.')
    edited = box.save(B, draft(B, header, 'Newer text saved in B.', moved))
    box.restart(A)
    box.restart(B)
    returned = box.move(B, A, header, edited, 'Newer text saved in B.')
    stale = box.save(A, obsolete)
    assert stale.get('error', {}).get('key') == 'draft-conflict', (stale, box.rows(header))
    assert returned['savedDraftId'] == original['savedDraftId']
    assert returned['savedDraftRevision'] > max(original['savedDraftRevision'], edited['savedDraftRevision'])
    assert box.rows(header) == [(A, returned['savedDraftId'], returned['savedDraftRevision'], 'Newer text saved in B.')]
    print('PASS round trip and worker restart preserve newer text against the original receipt', flush=True)

    # A destination can have a higher retired revision from an independent earlier draft.
    header = 'retired-destination@example.test'
    retired = box.save(B, draft(B, header, 'Earlier destination draft.'))
    for _ in range(4):
        retired = box.save(B, draft(B, header, 'Earlier updated destination draft.', retired))
    box.queue(B, 'DestroyDraftTask', messageIds=[retired['savedDraftId']])
    origin = box.save(A, draft(A, header, 'Independent source draft.'))
    destination = box.move(A, B, header, origin, 'Independent source draft.')
    assert destination['savedDraftRevision'] > retired['savedDraftRevision'] > origin['savedDraftRevision']
    stale = box.save(B, draft(B, header, 'Obsolete previous destination text.', retired))
    assert stale.get('error', {}).get('key') == 'draft-conflict', stale
    print('PASS destination reuses its identity above its own retired revision', flush=True)


def roundtrip_delete(box, legacy_delete=False):
    header = 'roundtrip-delete@example.test'
    original = box.save(A, draft(A, header, 'Old revision.'))
    moved = box.move(A, B, header, original, 'Old revision.')
    edited = box.save(B, draft(B, header, 'New body must survive old delete.', moved))
    returned = box.move(B, A, header, edited, 'New body must survive old delete.')

    stale_identity = dict(aid=A, hMsgId=header, id=original['savedDraftId'], v=original['savedDraftRevision'])
    result = box.queue(A, 'DestroyDraftTask' if legacy_delete else 'DestroyDraftRevisionTask',
                       messageIds=[original['savedDraftId']], expectedDraft=stale_identity)
    assert result.get('error', {}).get('key') == 'draft-conflict', (result, box.rows(header))
    assert box.rows(header) == [(A, returned['savedDraftId'], returned['savedDraftRevision'],
                                 'New body must survive old delete.')]

    current_identity = dict(stale_identity, id=returned['savedDraftId'], v=returned['savedDraftRevision'])
    rejected = box.queue(A, 'DestroyDraftRevisionTask', messageIds=[current_identity['id']],
                         expectedDraft=dict(current_identity, aid=B))
    assert rejected.get('error', {}).get('key') == 'invalid-draft', rejected
    assert len(box.rows(header)) == 1
    result = box.queue(A, 'DestroyDraftRevisionTask', messageIds=[current_identity['id']],
                       expectedDraft=current_identity)
    assert result.get('destroyedDraftRevision') == returned['savedDraftRevision'], result
    assert box.rows(header) == []
    print('PASS an old window cannot delete the returned revision, and current deletion is acknowledged', flush=True)


def provenance(box):
    copy_header, source_header = 'recovery-copy@example.test', 'recovery-source@example.test'
    source = box.save(A, draft(A, source_header, 'The original stays in A.'))
    recovery = {'sourceDraftId': source_header, 'sourceRevision': source['savedDraftRevision']}
    saved = box.save(A, draft(A, copy_header, 'Unsaved text preserved in a recovery copy.'), recoverySource=recovery)
    before = box.db.execute('SELECT sourceDraftId,sourceRevision,createdAt,copyNumber '
                            'FROM PaperReedDraftRecovery WHERE accountId=? AND copyDraftId=?', (A, copy_header)).fetchone()
    box.move(A, B, copy_header, saved, 'Unsaved text preserved in a recovery copy.')
    mirrored = box.db.execute('SELECT r.accountId,r.sourceDraftId,r.sourceRevision,r.createdAt,r.copyNumber '
                              'FROM PaperReedDraftRecovery r JOIN Message m ON m.accountId=r.accountId '
                              'AND m.headerMessageId=r.copyDraftId AND m.draft=1 WHERE r.copyDraftId=?',
                              (copy_header,)).fetchone()
    assert mirrored == (B, *before), (mirrored, before)
    assert box.db.execute('SELECT sourceAccountId FROM PaperReedDraftRecovery WHERE accountId=? AND copyDraftId=?',
                          (B, copy_header)).fetchone() == (A,)
    assert box.rows(source_header)[0][3] == 'The original stays in A.'
    second = 'second-recovery@example.test'
    box.save(A, draft(A, second, 'A second recovery copy.'), recoverySource=recovery)
    assert box.db.execute('SELECT copyNumber FROM PaperReedDraftRecovery WHERE copyDraftId=?', (second,)).fetchone() == (2,)
    print('PASS recovery ownership moves while the source account, timestamp and numbering survive', flush=True)


def source_move(box):
    header = 'moving-original@example.test'
    original = box.save(A, draft(A, header, 'The source with two windows.'))
    unrelated = box.save(B, draft(B, header, 'A separate source with the same mail header.'))

    def save_copy(owner, copy_header, receipt):
        box.save(owner, draft(owner, copy_header, copy_header), recoverySource={
            'sourceDraftId': header, 'sourceRevision': receipt['savedDraftRevision'],
        })

    def copy_link(copy_header):
        return box.db.execute('SELECT accountId,sourceAccountId,sourceRevision,copyNumber '
                              'FROM PaperReedDraftRecovery WHERE copyDraftId=?', (copy_header,)).fetchone()

    first, unrelated_copy = 'moved-source-first@example.test', 'other-lineage-copy@example.test'
    save_copy(A, first, original)
    save_copy(B, unrelated_copy, unrelated)
    box.queue(B, 'DestroyDraftTask', messageIds=[unrelated['savedDraftId']])
    moved = box.move(A, B, header, original, 'The source with two windows.')
    assert copy_link(first) == (A, B, original['savedDraftRevision'], 1), copy_link(first)
    second, late = 'moved-source-second@example.test', 'old-window-copy@example.test'
    save_copy(B, second, moved)
    save_copy(A, late, original)
    assert copy_link(second) == (B, B, moved['savedDraftRevision'], 2)
    assert copy_link(late) == (A, B, original['savedDraftRevision'], 3)
    lineages = dict(box.db.execute('SELECT copyDraftId,sourceLineageId FROM PaperReedDraftRecovery').fetchall())
    assert lineages[first] == lineages[second] == lineages[late] != lineages[unrelated_copy]
    box.move(B, A, header, moved, 'The source with two windows.')
    assert all(copy_link(copy)[1] == A for copy in (first, second, late))
    assert copy_link(unrelated_copy)[1:] == (B, unrelated['savedDraftRevision'], 1)
    print('PASS original and late recovery copies follow the same lineage across accounts, with independent numbering', flush=True)


def receipt_upgrade(binary, older, output, via=None):
    box = NativeDrafts(older, output, None, accounts=(A, B, C))
    header = 'pre-upgrade-original@example.test'
    roundtrip_header = 'pre-upgrade-roundtrip@example.test'
    missing_header = 'pre-upgrade-receipt-removed@example.test'
    wrong_id_header = 'pre-upgrade-wrong-receipt-id@example.test'
    wrong_source_header = 'pre-upgrade-contradictory-source@example.test'
    wrong_source_copy = 'pre-upgrade-contradictory-source-copy@example.test'
    update_only_header = 'pre-upgrade-contradictory-source-after-save@example.test'
    update_only_copy = 'pre-upgrade-contradictory-source-after-save-copy@example.test'
    proof_removed_header = 'pre-upgrade-unconfirmed-source@example.test'
    proof_removed_copy = 'pre-upgrade-unconfirmed-source-copy@example.test'
    duplicate_header = 'pre-upgrade-duplicate-original@example.test'
    first_duplicate = 'pre-upgrade-duplicate-copy@example.test'
    second_duplicate = 'mid-upgrade-duplicate-copy@example.test'

    def save_copy(account, copy_header, source_header, source):
        box.save(account, draft(account, copy_header, copy_header), recoverySource={
            'sourceDraftId': source_header, 'sourceRevision': source['savedDraftRevision'],
        })

    copy_info = box.recovery_info

    def move_saved(account, target, h, source, text):
        saved = box.save(account, draft(account, h, text, source))
        assert not saved.get('error'), saved
        return box.move(account, target, h, saved, text)

    with box:
        first = box.save(A, draft(A, header, 'The original to move.'))
        independent = box.save(B, draft(B, header, 'A separate original with the same header.'))
        save_copy(A, 'pre-upgrade-copy@example.test', header, first)
        save_copy(B, 'pre-upgrade-unrelated-copy@example.test', header, independent)
        box.queue(B, 'DestroyDraftTask', messageIds=[independent['savedDraftId']])
        moved = move_saved(A, B, header, first, 'Updated before the move.')
        active = box.save(B, draft(B, header, 'Updated after the move.', moved))
        # The later save still proves the original row and revision in A.
        box.db.execute('DELETE FROM Task WHERE id=?', (first['id'],))
        box.db.commit()

        first_round = box.save(A, draft(A, roundtrip_header, 'The original returns to A.'))
        save_copy(A, 'pre-upgrade-roundtrip-copy@example.test', roundtrip_header, first_round)
        in_b = move_saved(A, B, roundtrip_header, first_round, 'A update.')
        returned = move_saved(B, A, roundtrip_header, in_b, 'B update.')

        for h, saved_copy in ((missing_header, 'pre-upgrade-missing-copy@example.test'),
                              (wrong_id_header, 'pre-upgrade-mismatched-copy@example.test')):
            original = box.save(A, draft(A, h, 'Source with an unverifiable move.'))
            save_copy(A, saved_copy, h, original)
            receipt = box.move(A, B, h, original, 'Source with an unverifiable move.')
            if h == missing_header:
                box.db.execute('DELETE FROM Task WHERE id=?', (receipt['id'],))
                # A new independent draft can reuse the retired local id in A.
                box.db.commit()
                box.save(A, draft(A, h, 'Unrelated draft in the old account.'))
            else:
                receipt['savedDraftId'] = 'unverified-row-id'
                box.db.execute('UPDATE Task SET data=? WHERE id=?', (json.dumps(receipt), receipt['id']))
                box.db.commit()

        for h, saved_copy, keep_creation, keep_update in (
            (wrong_source_header, wrong_source_copy, True, True),
            (update_only_header, update_only_copy, False, True),
            (proof_removed_header, proof_removed_copy, False, False),
        ):
            source = box.save(A, draft(A, h, 'The actual source in A.'))
            independent_c = box.save(C, draft(C, h, 'Unrelated original in C.'))
            assert source['savedDraftRevision'] == independent_c['savedDraftRevision']
            assert source['savedDraftId'] != independent_c['savedDraftId']
            save_copy(C, saved_copy, h, independent_c)
            later = box.save(C, draft(C, h, 'A later successful save in C.', independent_c))
            assert not later.get('error'), later
            assert later['draft']['id'] == independent_c['savedDraftId']
            assert later['draft']['v'] == independent_c['savedDraftRevision']
            box.queue(C, 'DestroyDraftTask', messageIds=[later['savedDraftId']])
            receipt = box.move(A, B, h, source, 'The actual source in A.')
            # The creation or update can contradict this claim if still retained.
            receipt['moveSource']['accountId'] = C
            box.db.execute('UPDATE Task SET data=? WHERE id=?', (json.dumps(receipt), receipt['id']))
            if not keep_creation:
                box.db.execute('DELETE FROM Task WHERE id=?', (independent_c['id'],))
            if not keep_update:
                box.db.execute('DELETE FROM Task WHERE id=?', (later['id'],))
            box.db.commit()

        duplicate = box.save(A, draft(A, duplicate_header, 'Original with two old copies.'))
        save_copy(A, first_duplicate, duplicate_header, duplicate)
        duplicate_in_b = box.move(A, B, duplicate_header, duplicate, 'Original with two old copies.')
        copy_id, copy_revision = box.rows(first_duplicate)[0][1:3]
        box.move(A, B, first_duplicate, {'savedDraftId': copy_id, 'savedDraftRevision': copy_revision},
                 'The first copy resides in B.')
        if not via:
            save_copy(B, second_duplicate, duplicate_header, duplicate_in_b)

        first_info = copy_info('pre-upgrade-copy@example.test')
        roundtrip_info = copy_info('pre-upgrade-roundtrip-copy@example.test')
        untouched = {h: copy_info(h) for h in ('pre-upgrade-unrelated-copy@example.test',
                                             'pre-upgrade-missing-copy@example.test',
                                             'pre-upgrade-mismatched-copy@example.test',
                                             wrong_source_copy, update_only_copy, proof_removed_copy)}
        assert first_info[1] == A, first_info

    if via:
        box.upgrade(via)
        with box:
            assert box.recovery_links()['pre-upgrade-copy@example.test'] == 0
            save_copy(B, second_duplicate, duplicate_header, duplicate_in_b)
            assert copy_info(second_duplicate)[-1] == 1
    box.upgrade(binary)
    with box:
        assert copy_info('pre-upgrade-copy@example.test') == (A, B, *first_info[2:]), copy_info('pre-upgrade-copy@example.test')
        assert copy_info('pre-upgrade-roundtrip-copy@example.test') == roundtrip_info
        for h, metadata in untouched.items():
            assert copy_info(h) == metadata, (h, copy_info(h), metadata)
        links = box.recovery_links()
        assert links['pre-upgrade-copy@example.test'] == links['pre-upgrade-roundtrip-copy@example.test'] == 1, links
        assert all(links[h] == 0 for h in untouched), links

        save_copy(B, 'post-upgrade-copy@example.test', header, active)
        save_copy(A, 'post-upgrade-roundtrip-copy@example.test', roundtrip_header, returned)
        assert copy_info('post-upgrade-copy@example.test')[-1] == 2
        assert copy_info('post-upgrade-roundtrip-copy@example.test')[-1] == 2
        assert box.rows(header)[0][3] == 'Updated after the move.'
        third_duplicate = 'post-upgrade-duplicate-copy@example.test'
        save_copy(B, third_duplicate, duplicate_header, duplicate_in_b)
        related = box.db.execute(
            'SELECT copyNumber,sourceLineageId FROM PaperReedDraftRecovery WHERE sourceDraftId=? ORDER BY copyNumber',
            (duplicate_header,)).fetchall()
        assert len({lineage for _, lineage in related}) == 1, related
        assert [number for number, _ in related] == [1, 1, 2], related
        print('PASS duplicate historical numbers survive and subsequent copies continue numbering', flush=True)
        print('PASS retained move and save receipts reconnect existing copies and continue numbering', flush=True)
        print('PASS missing or contradictory receipts and independent same-header drafts stay separate', flush=True)
        print('PASS a later save proves the previous row even when its creation receipt is missing', flush=True)
        print('PASS a move without independent source evidence leaves the old link unavailable', flush=True)


def reused_legacy_identity(binary, older, output, move_engine=None, via=None, edit_in_v15=False, move_in_v15=False):
    box = NativeDrafts(older, output, None)
    cases = (
        ('recreated-with-history@example.test', ()),
        ('recreated-without-first-save@example.test', ('first',)),
        ('recreated-with-copy-receipt@example.test', ('first', 'deletion')),
        ('recreated-after-cleanup@example.test', ('first', 'copy', 'deletion')),
    )
    replacements = {}
    metadata = {}
    with box:
        for header, prune in cases:
            first = box.save(A, draft(A, header, 'Original draft before deletion.'))
            copy_header = 'copy-' + header
            copy = box.save(A, draft(A, copy_header, 'Content recovered from the original.'), recoverySource={
                'sourceDraftId': header, 'sourceRevision': first['savedDraftRevision'],
            })
            assert not copy.get('error'), copy
            metadata[header] = box.db.execute(
                'SELECT accountId,accountId,sourceRevision,createdAt,copyNumber '
                'FROM PaperReedDraftRecovery WHERE copyDraftId=?', (copy_header,)).fetchone()
            deleted = box.queue(A, 'DestroyDraftTask', messageIds=[first['savedDraftId']])
            assert not deleted.get('error') and len(deleted['stubIds']) == 1, deleted
            replacement = box.save(A, draft(A, header, 'Unrelated replacement draft.'))
            assert replacement['savedDraftId'] == first['savedDraftId']
            assert replacement['savedDraftRevision'] == first['savedDraftRevision'] == 1
            receipts = {'first': first, 'copy': copy, 'deletion': deleted}
            box.db.executemany('DELETE FROM Task WHERE id=?', ((receipts[name]['id'],) for name in prune))
            box.db.commit()
            replacements[header] = replacement

        intact_header = 'intact-legacy-original@example.test'
        intact_copy = 'intact-legacy-copy@example.test'
        intact = box.save(A, draft(A, intact_header, 'Continuous original draft.'))
        box.save(A, draft(A, intact_copy, 'Recovered from the continuous original.'), recoverySource={
            'sourceDraftId': intact_header, 'sourceRevision': intact['savedDraftRevision'],
        })
    source_account = A
    if move_engine:
        box.upgrade(move_engine)
        with box:
            for header, replacement in replacements.items():
                replacements[header] = box.move(A, B, header, replacement, 'Unrelated replacement draft.')
        source_account = B
    valid_copies = {}
    if via:
        box.upgrade(via)
        with box:
            assert box.db.execute('PRAGMA user_version').fetchone() == (15,)
            if edit_in_v15:
                for header, replacement in replacements.items():
                    good_copy = 'v15-copy-' + header
                    receipt = box.save(A, draft(A, good_copy, 'Recovered from the replacement in v15.'),
                                       recoverySource={'sourceDraftId': header,
                                                       'sourceRevision': replacement['savedDraftRevision']})
                    assert not receipt.get('error'), receipt
                    assert box.recovery_links()[good_copy] == 1
                    if move_in_v15:
                        replacements[header] = box.move(A, B, header, replacement, 'Unrelated replacement draft.')
                    valid_copies[good_copy] = box.recovery_info(good_copy)
                    # v15 may have copied the wrong account into this older row.
                    metadata[header] = box.recovery_info('copy-' + header)
                if move_in_v15:
                    source_account = B

    box.upgrade(binary)
    with box:
        links = box.recovery_links()
        retained = {h: (box.recovery_info('copy-' + h), links['copy-' + h]) for h in replacements}
        expected = {h: (metadata[h], 0) for h in replacements}
        valid_links = {h: (box.recovery_info(h), links[h]) for h in valid_copies}
        expected_valid = {h: (value, 1) for h, value in valid_copies.items()}
        assert (retained, valid_links) == (expected, expected_valid), (retained, expected, valid_links, expected_valid)
        for copy_header in valid_copies:
            assert box.rows(copy_header)[0][3] == 'Recovered from the replacement in v15.'
        for header, replacement in replacements.items():
            copy_header = 'copy-' + header
            assert box.rows(copy_header)[0][3] == 'Content recovered from the original.'
            assert box.rows(header)[0][0] == source_account
            assert box.rows(header)[0][3] == 'Unrelated replacement draft.'
            new_copy = 'new-copy-' + header
            box.save(source_account, draft(source_account, new_copy, 'New draft recovery content.'), recoverySource={
                'sourceDraftId': header, 'sourceRevision': replacement['savedDraftRevision'],
            })
            earlier = valid_copies.get('v15-copy-' + header)
            assert box.recovery_info(new_copy)[-1] == (earlier[-1] + 1 if earlier else 1)
            assert box.recovery_links()[new_copy] == 1

        assert links[intact_copy] == 1, links
        print('PASS reused v13 draft identity keeps old recovery content and metadata without linking to a replacement', flush=True)
        print('PASS incomplete history leaves old links unavailable after receipt cleanup', flush=True)
        print('PASS continuous legacy and newly created recovery links stay available', flush=True)
        if edit_in_v15:
            print('PASS correct v15 copies keep their links and numbering independently of older copies', flush=True)


def arrival_boundary(binary, older, output, move_engine, via=None):
    box = NativeDrafts(older, output, None, accounts=(A, B, C))
    incoming = ['incoming@example.test']
    if via:
        incoming.append('incoming-through-b@example.test')
    replaced, retired_copy = 'replaced@example.test', 'replaced-copy@example.test'
    arrivals = {}
    with box:
        for header in incoming:
            original_b = box.save(B, draft(B, header, 'The deleted draft in B.'))
            box.save(B, draft(B, 'retired-copy-' + header, 'Copied from the deleted draft.'), recoverySource={
                'sourceDraftId': header, 'sourceRevision': original_b['savedDraftRevision'],
            })
            box.queue(B, 'DestroyDraftTask', messageIds=[original_b['savedDraftId']])
            original_a = box.save(A, draft(A, header, 'The unrelated draft in A.'))
            box.save(A, draft(A, 'valid-copy-' + header, 'Copied from A.'), recoverySource={
                'sourceDraftId': header, 'sourceRevision': original_a['savedDraftRevision'],
            })
            arrivals[header] = (original_a, original_b)

        before = box.save(B, draft(B, replaced, 'The original draft.'))
        box.save(B, draft(B, retired_copy, 'Copied before the deletion.'), recoverySource={
            'sourceDraftId': replaced, 'sourceRevision': before['savedDraftRevision'],
        })
        box.queue(B, 'DestroyDraftTask', messageIds=[before['savedDraftId']])
        replacement = box.save(B, draft(B, replaced, 'The independent replacement.'))
        assert replacement['savedDraftRevision'] == before['savedDraftRevision']
        updated = box.save(B, draft(B, replaced, 'Updated independent replacement.', replacement))
        assert not updated.get('error'), updated
        box.db.execute('DELETE FROM Task WHERE id=?', (replacement['id'],))
        box.db.commit()

    box.upgrade(move_engine)
    with box:
        moved = {}
        for header, (original_a, original_b) in arrivals.items():
            arrived = box.move(A, B, header, original_a, 'The unrelated draft in A.')
            assert arrived['savedDraftId'] == original_b['savedDraftId']
            assert arrived['savedDraftRevision'] > original_b['savedDraftRevision']
            moved[header] = arrived
    if via:
        box.upgrade(via)
        with box:
            header = incoming[-1]
            box.move(B, C, header, moved[header], 'The unrelated draft in A.')
    box.upgrade(binary)
    with box:
        links = box.recovery_links()
        expected = {retired_copy: 0}
        for header in incoming:
            copy_a, copy_b = 'valid-copy-' + header, 'retired-copy-' + header
            expected.update({copy_a: 1, copy_b: 0})
        assert links == expected, (links, expected)
        for header in incoming:
            copy_a, copy_b = 'valid-copy-' + header, 'retired-copy-' + header
            target = B if header == incoming[0] else C
            assert box.recovery_info(copy_a)[1] == target
            assert box.rows(copy_b)[0][3] == 'Copied from the deleted draft.'
            assert box.rows(header)[0][0] == target
            assert box.rows(header)[0][3] == 'The unrelated draft in A.'
        assert box.rows(retired_copy)[0][3] == 'Copied before the deletion.'
        print('PASS the arriving draft keeps its own origin links without inheriting a retired local identity', flush=True)
        print('PASS a retained deletion invalidates the old link even without the replacement creation receipt', flush=True)


def cleanup_upgrade(binary, older, output, move=False):
    box = NativeDrafts(older, output, None)
    header, old_copy, new_copy = 'cleanup-original@example.test', 'cleanup-old-copy@example.test', 'cleanup-new-copy@example.test'
    with box:
        original = box.save(A, draft(A, header, 'Continuous draft.'))
        copy = box.save(A, draft(A, old_copy, 'Copied from the continuous draft.'), recoverySource={
            'sourceDraftId': header, 'sourceRevision': original['savedDraftRevision'],
        })
        if move:
            original = box.move(A, B, header, original, 'Continuous draft.')
            evicted_id, cleaned_account = original['id'], B
            box.queue_completed_failures(B)
        else:
            evicted_id, cleaned_account = copy['id'], A
            other_header = 'unrelated-draft-saves@example.test'
            other = None
            for _ in range(111):
                other = box.save(A, draft(A, other_header, 'Unrelated draft.', other))
                assert not other.get('error'), other
            # In the offline fixture the remote stage cannot complete. Let the
            # engine age completed tasks exactly as it would after remote sync.
            box.db.execute("UPDATE Task SET status='complete',data=json_set(data,'$.status','complete') "
                           "WHERE accountId=? AND status='remote'", (A,))
            box.db.commit()
        box.check_receipt_cleanup(cleaned_account, evicted_id)
        sample = box.recovery_info(old_copy) if move else None
    box.upgrade(binary)
    with box:
        assert box.recovery_links()[old_copy] == 1, box.recovery_links()
        assert box.rows(old_copy)[0][3] == 'Copied from the continuous draft.'
        if sample:
            assert box.recovery_info(old_copy) == sample
        box.save(cleaned_account, draft(cleaned_account, new_copy, 'Another recovery copy.'), recoverySource={
            'sourceDraftId': header, 'sourceRevision': original['savedDraftRevision'],
        })
        assert box.recovery_links()[new_copy] == 1
        assert box.recovery_info(new_copy)[-1] == 2
        print('PASS native task cleanup preserves a valid recovery link and its numbering', flush=True)


def unrelated_retirement(binary, older, output, prune_arrival=False):
    box = NativeDrafts(older, output, None, accounts=(A, B, C))
    header = 'outgoing-and-incoming@example.test'
    old_copy = 'outgoing-copy@example.test'
    late_copy = 'outgoing-late-copy@example.test'
    incoming_copy = 'incoming-then-deleted-copy@example.test'

    def save_copy(account, copy_header, source):
        result = box.save(account, draft(account, copy_header, copy_header), recoverySource={
            'sourceDraftId': header, 'sourceRevision': source['savedDraftRevision'],
        })
        assert not result.get('error'), result

    with box:
        original = box.save(A, draft(A, header, 'The healthy original in A.'))
        independent = box.save(C, draft(C, header, 'The independent draft in C.'))
        save_copy(A, old_copy, original)
        save_copy(C, incoming_copy, independent)
        moved = box.move(A, B, header, original, 'The healthy original in B.')
        replacement = box.move(C, A, header, independent, 'The independent draft in A.')
        assert replacement['savedDraftId'] == original['savedDraftId']
        assert replacement['savedDraftRevision'] > original['savedDraftRevision']
        save_copy(A, late_copy, original)
        deleted = box.queue(A, 'DestroyDraftRevisionTask', messageIds=[replacement['savedDraftId']], expectedDraft={
            'aid': A, 'hMsgId': header, 'id': replacement['savedDraftId'], 'v': replacement['savedDraftRevision'],
        })
        assert not deleted.get('error') and len(deleted['stubIds']) == 1, deleted
        if prune_arrival:
            box.queue_completed_failures(A)
            box.check_receipt_cleanup(A, replacement['id'])
            assert box.db.execute('SELECT 1 FROM Task WHERE id=?', (deleted['id'],)).fetchone()
        expected = {old_copy: 1, late_copy: 1, incoming_copy: 0}
        assert box.recovery_links() == expected, box.recovery_links()
        metadata = {copy_header: box.recovery_info(copy_header) for copy_header in expected}
    box.upgrade(binary)
    with box:
        assert box.recovery_links() == expected, (box.recovery_links(), expected)
        assert {copy_header: box.recovery_info(copy_header) for copy_header in expected} == metadata
        assert box.rows(header) == [(B, moved['savedDraftId'], moved['savedDraftRevision'], 'The healthy original in B.')]
        new_copy = 'outgoing-new-copy@example.test'
        save_copy(B, new_copy, moved)
        assert box.recovery_info(new_copy)[-1] == 3
        assert box.recovery_links()[new_copy] == 1
        print('PASS deleting an incoming same-header draft preserves the outgoing original and both recovery links', flush=True)
        if prune_arrival:
            print('PASS a retained deletion revision separates drafts after the arrival receipt is pruned', flush=True)


def moved_copy_cleanup(binary, older, via, output):
    box = NativeDrafts(older, output, None)
    header, copy_header = 'copy-move-origin@example.test', 'copy-move-recovery@example.test'
    with box:
        original = box.save(A, draft(A, header, 'The original remains in A.'))
        copy = box.save(A, draft(A, copy_header, 'Saved recovery from A.'), recoverySource={
            'sourceDraftId': header, 'sourceRevision': original['savedDraftRevision'],
        })
        assert not copy.get('error'), copy
        moved = box.move(A, B, copy_header, copy, 'Saved recovery from A.')
    box.upgrade(via)
    with box:
        box.queue_completed_failures(B)
        box.check_receipt_cleanup(B, moved['id'])
        assert box.db.execute('SELECT 1 FROM Task WHERE id=?', (copy['id'],)).fetchone()
        assert box.recovery_links()[copy_header] == 1
        metadata = box.recovery_info(copy_header)
    box.upgrade(binary)
    with box:
        assert box.recovery_links()[copy_header] == 1, box.recovery_links()
        assert box.recovery_info(copy_header) == metadata
        assert box.rows(copy_header)[0][3] == 'Saved recovery from A.'
        fresh = 'copy-move-next-recovery@example.test'
        box.save(A, draft(A, fresh, 'New recovery from A.'), recoverySource={
            'sourceDraftId': header, 'sourceRevision': original['savedDraftRevision'],
        })
        assert box.recovery_info(fresh)[-1] == 2
        assert box.recovery_links()[fresh] == 1
        print('PASS pruning the old move of a recovery copy preserves its original link and numbering', flush=True)


def retired_destination_cleanup(binary, older, output):
    box = NativeDrafts(older, output, None)
    header, copy_header = 'destination-origin@example.test', 'destination-recovery@example.test'
    with box:
        retired = box.save(B, draft(B, header, 'An unrelated original once existed in B.'))
        deleted = box.queue(B, 'DestroyDraftRevisionTask', messageIds=[retired['savedDraftId']], expectedDraft={
            'aid': B, 'hMsgId': header, 'id': retired['savedDraftId'], 'v': retired['savedDraftRevision'],
        })
        assert not deleted.get('error'), deleted
        original = box.save(A, draft(A, header, 'The original actually linked to this copy.'))
        copy = box.save(A, draft(A, copy_header, 'Saved recovery from A.'), recoverySource={
            'sourceDraftId': header, 'sourceRevision': original['savedDraftRevision'],
        })
        assert not copy.get('error'), copy
        moved = box.move(A, B, header, original, 'The original actually linked to this copy.')
        # Model completion of the remote stage in this offline profile.
        box.db.execute("UPDATE Task SET status='complete',data=json_set(data,'$.status','complete') "
                       "WHERE accountId=? AND status='remote'", (A,))
        box.db.commit()
        box.queue_completed_failures(A)
        box.check_receipt_cleanup(A, copy['id'])
        assert box.db.execute('SELECT 1 FROM Task WHERE id=?', (retired['id'],)).fetchone()
        assert box.recovery_links()[copy_header] == 1
        metadata = box.recovery_info(copy_header)
    box.upgrade(binary)
    with box:
        assert box.recovery_links()[copy_header] == 1, box.recovery_links()
        assert box.recovery_info(copy_header) == metadata
        fresh = 'destination-next-recovery@example.test'
        box.save(B, draft(B, fresh, 'New recovery from the original.'), recoverySource={
            'sourceDraftId': header, 'sourceRevision': moved['savedDraftRevision'],
        })
        assert box.recovery_info(fresh)[-1] == 2
        assert box.recovery_links()[fresh] == 1
        print('PASS an earlier destination draft cannot refute a link after copy receipt cleanup', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('binary', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--case', choices=['roundtrip', 'provenance', 'roundtrip_delete', 'source_move'])
    parser.add_argument('--legacy-engine', type=Path)
    parser.add_argument('--upgrade-from', type=Path, help='Create moved drafts and recovery copies using an older native engine')
    parser.add_argument('--reuse-from', type=Path, help='Create reused draft identities using a v13 engine')
    parser.add_argument('--move-engine', type=Path, help='Optionally move a reused draft using an intermediate v14 engine')
    parser.add_argument('--via-engine', type=Path, help='Optionally reproduce an intermediate broken upgrade first')
    parser.add_argument('--edit-in-v15', action='store_true', help='Save a legitimate recovery copy before the final upgrade')
    parser.add_argument('--move-in-v15', action='store_true', help='Move the replacement after saving a legitimate copy in v15')
    parser.add_argument('--arrival-from', type=Path, help='Build retired local origins and incoming same-header drafts')
    parser.add_argument('--cleanup-from', type=Path, help='Exercise receipt cleanup on an older engine before upgrading')
    parser.add_argument('--cleanup-moved', action='store_true', help='Use a v15 source and prune its destination move receipt')
    parser.add_argument('--retirement-from', type=Path, help='Test an unrelated draft arriving after the original moved away')
    parser.add_argument('--retirement-pruned', action='store_true', help='Prune the unrelated arrival receipt before upgrading')
    parser.add_argument('--moved-copy-from', type=Path, help='Test cleanup of a v14 move of the recovery copy itself')
    parser.add_argument('--retired-destination-from', type=Path, help='Test copy receipt cleanup with an earlier draft in the destination')
    parser.add_argument('--legacy-delete', action='store_true', help='Run the old unversioned request as a negative control')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    if args.retirement_from:
        unrelated_retirement(args.binary.resolve(), args.retirement_from.resolve(), args.output, args.retirement_pruned)
        return
    if args.moved_copy_from:
        if not args.via_engine:
            parser.error('--moved-copy-from requires --via-engine')
        moved_copy_cleanup(args.binary.resolve(), args.moved_copy_from.resolve(), args.via_engine.resolve(), args.output)
        return
    if args.retired_destination_from:
        retired_destination_cleanup(args.binary.resolve(), args.retired_destination_from.resolve(), args.output)
        return
    if args.arrival_from:
        if not args.move_engine:
            parser.error('--arrival-from requires --move-engine')
        arrival_boundary(args.binary.resolve(), args.arrival_from.resolve(), args.output, args.move_engine, args.via_engine)
        return
    if args.cleanup_from:
        cleanup_upgrade(args.binary.resolve(), args.cleanup_from.resolve(), args.output, args.cleanup_moved)
        return
    if args.reuse_from:
        if args.edit_in_v15 and not args.via_engine:
            parser.error('--edit-in-v15 requires --via-engine')
        if args.edit_in_v15 and args.move_engine:
            parser.error('--edit-in-v15 requires the replacement to remain in its original account until v15')
        if args.move_in_v15 and not args.edit_in_v15:
            parser.error('--move-in-v15 requires --edit-in-v15')
        reused_legacy_identity(args.binary.resolve(), args.reuse_from.resolve(), args.output,
                              args.move_engine, args.via_engine, args.edit_in_v15, args.move_in_v15)
        return
    if args.upgrade_from:
        receipt_upgrade(args.binary.resolve(), args.upgrade_from.resolve(), args.output, args.via_engine)
        return
    with NativeDrafts(args.binary.resolve(), args.output, args.legacy_engine) as box:
        for case in (roundtrip, provenance, source_move):
            if args.case in (None, case.__name__):
                case(box)
        if args.case in (None, 'roundtrip_delete'):
            roundtrip_delete(box, args.legacy_delete)


if __name__ == '__main__':
    main()
