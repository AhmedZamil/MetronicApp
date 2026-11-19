# SkyLake Control Forms

Reference product for **SKY LAKE SOLUTIONS**. It is a Metronic 8-style admin shell (Bootstrap 5.3, vanilla JavaScript, no React, Angular, or Vue) with metadata-driven forms and an ASP.NET Core-shaped API.

The public site is the customized end product. This repository does not contain KeenThemes source. The HTML uses the Metronic 8 class contract (`card-flush`, `form-control-solid`, `fv-row`, `stepper`, sidebar, header, content). [css/skylake.css](css/skylake.css) implements those classes so the app runs without redistributing the theme. The same markup drops into a licensed Metronic 8 layout by replacing that stylesheet with the theme bundle.

## What you can click through

Sign in as one of three demo users. There is no password.

| User | Role | What they can do |
| --- | --- | --- |
| Ava Chen | Analyst | Fill forms and read this tenant's submissions |
| Noah Rahman | Tenant Admin | Edit the incident schema for the active tenant |
| Maya Okonkwo | Platform Admin | Switch tenants and edit the global vendor template |

Two forms are rendered only from JSON:

- **Incident intake** is a 3-step form. Critical severity reveals executive notification. A third-party source reveals vendor fields.
- **Vendor assessment** fills region options from the country, requires at least one control row, and asks for remediation when any control fails.

Schema studio adds, edits, reorders, and deletes scalar fields. A save is rejected unless the schema shape is valid. The runtime reads that saved schema on the next load.

## Run the demo

```bash
npm test
npm start
```

Open http://localhost:4173.

`npm test` runs the shared cases in [tests/cases.json](tests/cases.json) against the browser engine and the Node API.

## ASP.NET Core

The browser demo talks to the Node routes in [api](api), because the hosted frontend is a static site plus serverless functions. The same contract is implemented in [backend/SkyLake.Api](backend/SkyLake.Api) on **.NET 10**:

```bash
dotnet run --project backend/SkyLake.Api
```

That host is authoritative. `POST /api/submissions` validates against the schema stored by the API, not a schema sent by the browser. `PUT /api/forms` writes `App_Data/store.json`. Point the same `ApiClient` headers (`X-Tenant-Id`, `X-Role`, `X-User-Name`) at it when the UI moves beside an existing .NET 10 app.

```bash
dotnet test backend/SkyLake.Api.Tests
```

The .NET test reads the same [tests/cases.json](tests/cases.json) file as Node. `dotnet build` is clean. If Windows Application Control blocks the test assembly, run the test on a machine that allows locally built executables.

## Deploy

Vercel serves the HTML, CSS, and JavaScript, plus `/api/bootstrap`, `/api/forms`, and `/api/submissions`. Schema edits and new submissions are accepted by that API and then kept in the browser, because a serverless function has no durable disk. A refresh on the same browser shows the saved schema.

## Proposal notes

The three answers for the Metronic engagement are in [docs/proposal-answers.md](docs/proposal-answers.md). Conventions for dropping this into an existing layout are in [docs/conventions.md](docs/conventions.md). The manual acceptance script is in [docs/clickthrough.md](docs/clickthrough.md).
