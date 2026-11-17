// Compiles the exact guard included by TaskProcessor, using upstream SQLiteCpp.
// This does not replace a rebuilt engine's IMAP/SMTP integration tests.
#include "MailMutationGuard.hpp"
#include <cassert>
#include <cstdio>
#include <functional>
#include <iostream>
#include <signal.h>
#include <sys/wait.h>
#include <unistd.h>

using namespace PaperReed;

void conflict(const std::string & key, const std::function<void()> & work) {
    bool caught = false;
    try { work(); } catch (const Conflict & e) { caught = e.key == key; }
    assert(caught);
}

json draft(const std::string & account = "a") {
    return {{"aid", account}, {"hMsgId", "draft@example.test"}, {"id", account + "-draft"},
            {"v", 1}, {"draft", true}, {"body", "user edit"}};
}

void seed(SQLite::Database & db, const json & d) {
    SQLite::Statement q(db, "INSERT OR REPLACE INTO Message (id,accountId,headerMessageId,data) VALUES (?, ?, ?, ?)");
    q.bind(1, d["id"].get<std::string>()); q.bind(2, d["aid"].get<std::string>());
    q.bind(3, d["hMsgId"].get<std::string>()); q.bind(4, d.dump()); q.exec();
}

void transaction(SQLite::Database & db, const std::function<void()> & work) {
    db.exec("BEGIN IMMEDIATE");
    try { work(); db.exec("COMMIT"); } catch (...) { db.exec("ROLLBACK"); throw; }
}

int main(int argc, char ** argv) {
    assert(argc == 2);
    const std::string path = argv[1];
    {
        SQLite::Database db(path, SQLite::OPEN_READWRITE | SQLite::OPEN_CREATE, 5000);
        db.exec("PRAGMA journal_mode=WAL");
        db.exec("CREATE TABLE Message(id TEXT PRIMARY KEY, accountId TEXT, headerMessageId TEXT, data TEXT, gMsgId TEXT, draft INTEGER DEFAULT 1)");
        db.exec("CREATE TABLE Task(id TEXT PRIMARY KEY, status TEXT)");
        db.exec("CREATE TABLE IF NOT EXISTS Folder(id TEXT PRIMARY KEY, data TEXT)");
        db.exec("CREATE TABLE IF NOT EXISTS MessageFolder(messageId TEXT,folderId TEXT,remoteUID INTEGER)");
        MailMutationGuard::migrate(db);
        MailMutationGuard::migrate(db); // restart/migration is repeatable
        MailMutationGuard g(db);
        json origin = {{"sourceDraftId", "source@example.test"}, {"sourceRevision", 2}};
        try {
            transaction(db, [&] {
                g.recordDraftRecovery("a", "rollback-copy", origin, false);
                auto copy = draft(); copy["id"] = "rollback-copy"; seed(db, copy);
                throw std::runtime_error("copy save failed");
            });
        } catch (const std::runtime_error &) {}
        assert(db.execAndGet("SELECT COUNT(*) FROM PaperReedDraftRecovery").getInt() == 0);
        assert(db.execAndGet("SELECT COUNT(*) FROM Message WHERE id = 'rollback-copy'").getInt() == 0);
        conflict("invalid-recovery-source", [&] { g.recordDraftRecovery("a", "existing", origin, true); });
        conflict("invalid-recovery-source", [&] { g.recordDraftRecovery("a", "copy", json::object(), false); });
        transaction(db, [&] { g.recordDraftRecovery("a", "copy", origin, false); });
        transaction(db, [&] { g.recordDraftRecovery("b", "copy", origin, false); });
        assert(db.execAndGet("SELECT COUNT(*) FROM PaperReedDraftRecovery").getInt() == 2);
        assert(db.execAndGet("SELECT MIN(createdAt) FROM PaperReedDraftRecovery").getInt64() > 0);
        transaction(db, [&] { g.recordDraftRecovery("a", "second-copy", origin, false); });
        assert(db.execAndGet("SELECT copyNumber FROM PaperReedDraftRecovery WHERE accountId = 'a' AND copyDraftId = 'second-copy'").getInt() == 2);
        std::cout << "PASS recovery provenance shares transaction, rejects updates, preserves account scope\n";
        auto old = draft(); seed(db, old);
        auto latest = old; latest["v"] = 3;
        transaction(db, [&] { assert(g.checkRevision("a", old, false) == "a-draft"); seed(db, latest); });
        conflict("draft-conflict", [&] { transaction(db, [&] { g.checkRevision("a", old, false); seed(db, old); }); });
        assert(g.checkRevision("a", latest, false) == "a-draft");
        old.erase("id");
        conflict("draft-conflict", [&] { g.checkRevision("a", old, false); });
        auto wrong = latest; wrong["id"] = "another-draft";
        conflict("draft-conflict", [&] { g.checkRevision("a", wrong, false); });
        conflict("invalid-draft", [&] { g.checkRevision("b", latest, false); });
        auto missing = latest; missing.erase("v");
        conflict("invalid-draft", [&] { g.checkRevision("a", missing, false); });
        std::cout << "PASS stale revision, omitted id, wrong id/account, missing revision\n";

        // Failure after admission but before Task commit rolls back both rows.
        try {
            transaction(db, [&] {
                g.admit("a", "rolled-back", latest, latest);
                db.exec("INSERT INTO Task VALUES ('rolled-back', 'remote')");
                throw std::runtime_error("injected failure");
            });
        } catch (const std::runtime_error &) {}
        assert(g.request("a", "rolled-back").is_null());
        assert(db.execAndGet("SELECT COUNT(*) FROM Task").getInt() == 0);
        transaction(db, [&] {
            g.admit("a", "send-1", latest, latest);
            db.exec("INSERT INTO Task VALUES ('send-1', 'remote')");
        });
        conflict("duplicate-send", [&] { g.admit("a", "send-1", latest, latest); });
        auto altered = latest; altered["body"] = "different";
        conflict("request-conflict", [&] { g.admit("a", "send-1", latest, altered); });
        conflict("draft-frozen", [&] { g.admit("a", "send-2", latest, latest); });
        conflict("draft-frozen", [&] { g.requireEditable("a", "draft@example.test"); });
        db.exec("DELETE FROM Task");
        conflict("draft-frozen", [&] { g.admit("a", "after-cleanup", latest, latest); });
        std::cout << "PASS atomic admission, request reuse, changed request, duplicate draft, history cleanup\n";

        auto other = draft("b"); seed(db, other);
        transaction(db, [&] { g.admit("b", "send-1", other, other); });
        g.transition("b", "send-1", "queued", "rejected");
        g.requireEditable("b", "draft@example.test");
        transaction(db, [&] { g.admit("b", "send-2", other, other); });
        conflict("duplicate-send", [&] { g.admit("b", "send-1", other, other); });
        std::cout << "PASS account isolation and retry only after preflight rejection\n";
    }

    // Simulate process death after a durable attempt marker, not just reopening
    // an in-memory object. The parent has closed all database connections.
    pid_t child = fork(); assert(child >= 0);
    if (child == 0) {
        SQLite::Database db(path, SQLite::OPEN_READWRITE, 5000);
        MailMutationGuard(db).transition("a", "send-1", "queued", "attempting");
        kill(getpid(), SIGKILL);
        _exit(99);
    }
    int status = 0; assert(waitpid(child, &status, 0) == child);
    assert(WIFSIGNALED(status) && WTERMSIG(status) == SIGKILL);
    {
        SQLite::Database db(path, SQLite::OPEN_READWRITE, 5000);
        MailMutationGuard g(db);
        assert(g.request("a", "send-1")["phase"] == "attempting");
        g.transition("a", "send-1", "attempting", "unknown");
        conflict("send-state-conflict", [&] { g.transition("a", "send-1", "queued", "attempting"); });
        conflict("draft-frozen", [&] { g.requireEditable("a", "draft@example.test"); });
        g.transition("b", "send-2", "queued", "attempting");
        g.transition("b", "send-2", "attempting", "accepted");
        g.setCopy("b", "send-2", "failed");
    }
    {
        SQLite::Database db(path, SQLite::OPEN_READWRITE, 5000);
        MailMutationGuard g(db);
        assert(g.request("a", "send-1")["phase"] == "unknown");
        assert(g.request("b", "send-2")["phase"] == "accepted");
        assert(g.request("b", "send-2")["sentCopy"] == "failed");
        conflict("draft-frozen", [&] { g.requireEditable("b", "draft@example.test"); });
        // The SMTP copy can arrive after a failed APPEND response; once observed,
        // a delayed send worker failure must not turn it back into failed.
        g.confirmSentCopy("unrelated", "draft@example.test", "0");
        assert(g.request("b", "send-2")["sentCopy"] == "failed");
        g.confirmSentCopy("b", "draft@example.test", "0");
        assert(g.request("b", "send-2")["sentCopy"] == "filed");
        g.setCopy("b", "send-2", "failed");
        g.setCopy("b", "send-2", "pending");
        assert(g.request("b", "send-2")["sentCopy"] == "filed");
        assert(g.request("a", "send-1")["phase"] == "unknown");
        // Gmail's copy may sync before the API receipt; its rewritten header is
        // irrelevant to the stable Gmail id. Another request remains untouched.
        auto copy = draft("copy"); seed(db, copy);
        g.admit("copy", "gmail-send", copy, {{"draft", copy}});
        g.transition("copy", "gmail-send", "queued", "attempting");
        db.exec(R"SQL(INSERT INTO Message(id,accountId,headerMessageId,data,gMsgId,draft)
            VALUES ('sent','copy','rewritten@example.test','{"labels":["\\Sent"]}','88',0))SQL");
        g.accept("copy", "gmail-send", "gmail:88");
        assert(g.request("copy", "gmail-send")["sentCopy"] == "filed");
        std::cout << "PASS late failed copy converges, filed never regresses, early rewritten Gmail copy matches\n";
        auto race = draft("race"); seed(db, race);
    }
    std::cout << "PASS SIGKILL/restart, unknown stays locked, accepted distinct from failed copy\n";

    // Two processes contend for the same draft with different request ids.
    pid_t racers[2];
    for (int i = 0; i != 2; ++i) {
        racers[i] = fork(); assert(racers[i] >= 0);
        if (racers[i] == 0) {
            SQLite::Database db(path, SQLite::OPEN_READWRITE, 5000);
            MailMutationGuard g(db);
            try {
                transaction(db, [&] { g.admit("race", std::to_string(i), draft("race"), draft("race")); });
                _exit(0);
            } catch (const Conflict & e) { _exit(e.key == "draft-frozen" ? 10 : 99); }
        }
    }
    int successes = 0, conflicts = 0;
    for (auto pid : racers) {
        assert(waitpid(pid, &status, 0) == pid && WIFEXITED(status));
        successes += WEXITSTATUS(status) == 0;
        conflicts += WEXITSTATUS(status) == 10;
    }
    assert(successes == 1 && conflicts == 1);
    std::cout << "PASS concurrent admissions: exactly one winner\n";
}
