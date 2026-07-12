# Botond Csereklye

**IMS student · aspiring application developer — Python · C# / .NET · Flutter · Full-stack web**

I'm a second-year student at an IMS (*Informatikmittelschule*) in Aargau, Switzerland. An IMS is a full-time Swiss vocational-IT school whose application-development track leads to a federal IT diploma (EFZ Informatiker/in, Applikationsentwicklung) together with a vocational baccalaureate (*Berufsmaturität*). I'm looking for an **internship in application development** where I can contribute to real software while I finish my education.

Most of what I build is full-stack and backend-leaning: an HTTP API with a database and migrations behind it, a typed frontend on top, automated tests, and Docker so the whole stack starts with one command. I work in feature branches and pull requests, and I add CI where it earns its keep.

## Core skills

- **Languages:** Python, C#, TypeScript/JavaScript, Dart, SQL
- **Backend:** ASP.NET Core (.NET 8), FastAPI, REST APIs, EF Core & SQLAlchemy, Alembic / EF migrations, JWT/cookie authentication, role-based authorization
- **Frontend:** React 19, TypeScript, Vite, React Query, Flutter
- **Data:** PostgreSQL, SQLite
- **Infrastructure & tooling:** Docker, Docker Compose, GitHub Actions (CI), Git, pull-request workflow
- **Testing:** unit and integration tests with pytest, xUnit, and Vitest
- **Also:** machine-learning basics (supervised-learning coursework in Python/Jupyter), defensive security fundamentals

## Selected projects

| Project | What it is & why it matters | Stack | Engineering proof |
| --- | --- | --- | --- |
| **[ModelForge](https://github.com/BotondCsereklye/ModelForge)** | Full-stack workbench to benchmark and compare LLM endpoints, with live run progress, authentication, and exportable reports. My most complete project. | C# / ASP.NET Core 8 · React 19 + TS · Python/FastAPI worker · PostgreSQL · SignalR | GitHub Actions CI (build, xUnit + pytest + Vitest, EF-migration check), Docker Compose, `.env.example`, architecture/deployment docs, Apache-2.0 |
| **[VSW – Vulnerability Scanner Web App](https://github.com/BotondCsereklye/VSW)** | Defensive, read-only web-security scanner (HTTP headers, TLS, safe ports, misconfigurations) with a scored report dashboard and a browser extension. | Python/FastAPI · SQLAlchemy · React + TS · Docker | 15 pytest unit + integration test files, Vitest, Docker Compose, PR-based Git workflow, 5-language i18n |
| **[Classroom Internet Control](https://github.com/BotondCsereklye/internet-ein-aus)** | Web app to switch internet access per classroom/subnet, with logins, roles, schedules, an audit log, and a real Linux policy layer (nftables/Squid). | Python/FastAPI · Jinja2 · SQLAlchemy + Alembic · Docker | pytest suite (API, scheduler, negative & web-flow), Alembic migrations, systemd/nginx deploy files |
| **[Mac_changer](https://github.com/BotondCsereklye/Mac_changer)** | Small Windows WLAN MAC-randomization utility plus a tested Python helper for validating locally-administered MAC addresses. | Python · Windows Batch | GitHub Actions CI running pytest, packaged as an installable module |

Also on my profile: **[Graftcount](https://github.com/BotondCsereklye/Graftcount)** — a Flutter/Dart counting app with CSV/PDF export — and **[LB_259](https://github.com/BotondCsereklye/LB_259)**, a supervised-learning dataset analysis in Jupyter.

## How I work

- Structure code in layers (API / services / data) instead of one large file
- Database schema changes go through migrations, not manual edits
- Tests before I trust a feature — unit tests for logic, integration tests for the API
- One-command local setup via Docker Compose and a checked-in `.env.example`
- Small commits, feature branches, and pull requests

## Currently going deeper on

- ASP.NET Core and clean API architecture in C# / .NET
- Automated testing and CI/CD with GitHub Actions
- Full-stack TypeScript/React on top of typed backends

## Contact

- GitHub: [@BotondCsereklye](https://github.com/BotondCsereklye)
- Location: Aargau, Switzerland
- Email: *add your preferred contact email here*
- LinkedIn: *add your LinkedIn URL here (recommended for the internship search)*
