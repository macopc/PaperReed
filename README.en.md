# Paper Reed

[中文](README.md) · [Contributing](CONTRIBUTING.md) · [Roadmap](ROADMAP.md)

Paper Reed is an open-source macOS email client exploration focused on thoughtful reading, writing, and organization, with convenient access for external agents such as Claude Code, Codex, and OpenCode.

**Early exploration: the current interface is the first-version baseline; architecture and technology choices remain undecided.** Mail core design is now in progress. There is no installable mail client or release yet. Mailspring is a candidate, not a selected foundation.

## What is here

- A self-contained, interactive HTML prototype with sample mail and simulated agent handoff.
- Earlier visual directions and a source-grounded UI/UX review.
- Research into Mailspring and Zero, with pinned source provenance and isolated feasibility checks.
- Candidate architecture and CLI / agent interactions; built-in AI is a later priority.
- A proposed [first-version mail core](design/MAIL-CORE.md) and [domain glossary](GLOSSARY.md), covering shared UI / CLI state, drafts, account boundaries and operation results. These documents are in Chinese.
- A [technology recommendation](design/TECH-CHOICE.md) with source evidence and validation criteria: investigate a Mailspring product fork first; complete builds and real mailbox integration remain unverified.

## Try the prototype

```sh
git clone https://github.com/macopc/PaperReed.git
cd PaperReed
```

Open `design/direction.html` directly in a browser. No build or server is needed. Nothing connects to a mailbox, sends mail, installs a CLI, or launches an agent. Refreshing resets the sample state. The prototype currently uses Chinese copy.

[Page directory](design/PAGES.md) · [UI exploration](design/INTERFACE.md) · [UX review](design/UX-REVIEW.md) · [Candidate architecture](design/ARCHITECTURE.md) · [Research](research/README.md)

## Develop and contribute

Python 3.10+ and Node.js 22+ are sufficient for the repository checks; npm dependencies are not needed.

```sh
python3 design/build-previews.py
python3 scripts/check.py
```

Edit `design/direction.html` and regenerate its standalone pages. Historical snapshots are not the current specification. Checks cover generated pages, JavaScript syntax, JSON and local documentation links; they do not test browser interaction or real email integration.

Concrete design feedback, email workflow examples, and evidence-backed technology comparisons are welcome. Issues and pull requests may be in English or Chinese. Discuss substantial implementation before starting: the product design and architecture are still open. See [CONTRIBUTING.md](CONTRIBUTING.md) and [ROADMAP.md](ROADMAP.md).

## License

Copyright (C) 2026 Paper Reed contributors. Original repository content is licensed under [GNU GPL v3.0 only](LICENSE), without warranty. Upstream code, third-party materials and trademarks retain their own terms and ownership; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). This is an independent project, not affiliated with or endorsed by Spark, Mailspring, Zero, or their maintainers.
