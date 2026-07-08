# AGENTS.md

## Purpose

This repository is a **pnpm monorepo** managed with **TurboRepo**.

Before making changes, understand the task and identify the minimum number of files required. Avoid scanning unrelated parts of the repository.

---

# Technology Stack

* Package manager: **pnpm**
* Monorepo: **TurboRepo**
* Backend: **NestJS**
* Frontend: **Next.js**
* ORM: **Prisma 5.x**
* Database: **PostgreSQL**

---

# Repository Structure

```
apps/
  api/        NestJS backend
  web/        Next.js frontend
  admin/      Admin application

packages/
  db/         Prisma schema and Prisma Client
  ui/         Shared UI components
  config/     Shared configuration
```

Read only the packages relevant to the current task.

---

# Package Management

Always use **pnpm**.

Use:

```
pnpm install
pnpm <script>
pnpm --filter <package> <script>
pnpm exec <command>
```

Never use:

```
npm install
npm update
npx
yarn
```

Do not install global packages.

---

# Prisma

This project currently uses **Prisma 5.x**.

Never upgrade Prisma unless explicitly requested.

Do not use:

```
npx prisma ...
```

Use one of the following instead:

```
cd packages/db
pnpm exec prisma generate

pnpm exec prisma migrate dev

pnpm exec prisma db push
```

or from the repository root:

```
pnpm --filter @matsrc/db db:generate
pnpm --filter @matsrc/db db:migrate
```

Do not migrate the project to Prisma 7 unless explicitly requested.

---

# TurboRepo

Use existing workspace scripts whenever possible.

Examples:

```
pnpm build
pnpm dev
pnpm db:generate
```

Prefer filtered execution instead of running every package.

Example:

```
pnpm --filter @matsrc/api dev
```

---

# File Reading Strategy

Before opening files:

1. Determine which package is responsible.
2. Read only the files necessary.
3. Reuse existing implementation patterns.
4. Avoid broad repository exploration.

Do NOT recursively inspect the repository unless requested.

---

# Avoid Reading

Unless required, do not inspect:

* node_modules
* dist
* build
* coverage
* .next
* generated Prisma client
* lock files
* compiled output

---

# Code Style

Follow existing conventions in the surrounding code.

Do not introduce new architectural patterns if an existing pattern already exists.

Keep changes consistent with neighboring modules.

---

# Dependency Management

Do not:

* upgrade dependencies
* replace libraries
* change tooling versions

unless explicitly requested.

---

# Scope

Modify only files required for the requested task.

Avoid unrelated refactoring.

Avoid formatting files that are unrelated to the change.

Do not rename files unless requested.

---

# Before Coding

Identify:

* which package owns the feature
* existing implementation to follow
* minimum files required

Reuse existing services, DTOs, repositories, utilities, and shared components whenever possible.

---

# Before Finishing

Verify:

* code builds
* existing conventions are followed
* imports are clean
* no unrelated files were modified
* only necessary files were changed

Provide a concise summary of the files changed and the reasoning behind the implementation.
