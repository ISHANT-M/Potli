# Project report review

Reviewed incoming commit `bd4b478` against the current code and approved proposal. The report was merged without rewriting local commits. Reviewed `project-report/main.tex`, `references.bib`, `tietreport.cls`, and the supplied 39-page PDF; rendered its title, scope table and diagram pages.

## Correction status

The report source has now been revised:

- Authentication, account linkage, migrations, seeding and security descriptions match the Appwrite/PostgreSQL implementation.
- Removed claims about deprecated API aliases; endpoint paths are consistent.
- Added password-recovery/reset details, including the mail-service prerequisite.
- Added the component diagram as a structural model and references for Appwrite, Drizzle and JWT.
- Replaced promotional and repetitive phrasing with direct, formal descriptions of the work and its limitations.
- All eleven figures now reference canonical root `assets/` files. Removed duplicate report copies; moved the three previously report-only PNGs into `assets/`.
- Cropped only blank top/bottom margins from the Gantt PNG, increased its inclusion size, and placed the sequence diagram on a dedicated page at a larger size. The approved diagram content is unchanged.

Static checks passed for LaTeX environment nesting, fourteen unique labels, seven cited bibliography keys, eleven existing figure paths, and whitespace. After the user installed Tectonic through Scoop, the revised source was compiled and **`project-report/main.pdf` was replaced with the updated 41-page report**.

The compiled report was checked for missing references and stale authentication descriptions. Rendered all eleven figure pages, the scope and evaluation tables, the title page, and the bibliography; inspected the page overview and detailed component, scope-table and sequence pages. All PDF fonts are embedded. The final TeX log has no overfull or underfull boxes, and the PDF build no longer reports duplicate hyperlink targets.

Layout corrections use ragged-right table columns, natural page-bottom spacing, breakable bibliography URLs, and shorter sentences where lines overflowed. Loading `float` before `hyperref` fixes duplicate figure/table targets; disabling page anchors only on the title page fixes the repeated page-one target. No warning thresholds were raised.

The remaining tool notices are biblatex's expected fallback to the configured BibTeX backend and Tectonic's missing default Fontconfig configuration. The latter did not prevent the explicitly selected Latin Modern fonts from being embedded in the PDF. No persistent machine configuration was changed.

From the repository root, rebuild in PowerShell with:

```powershell
Set-Location project-report; tectonic --keep-logs main.tex
```

Tectonic's initial run downloaded the TeX bundle; subsequent builds reuse the cache.

The findings below record the original review. Their line/page references refer to the incoming version, not the revised source.

## Findings

### High: authentication and persistence describe the removed Supabase implementation

**Locations:** `project-report/main.tex:57`, `105`, `176-181`, `266`, `273-286`, `302`.

The abstract, scope table, architecture, frontend, backend, database, security and verification sections still describe Supabase Auth, `supabase-js`, managed access/refresh sessions, `auth.users`, signup triggers, row-level security and Supabase-specific migrations. These no longer describe the implementation.

Current evidence:

- `code/frontend/src/appwrite.ts:9-21` configures Appwrite's Web SDK. `code/frontend/src/main.ts:58-60` mints a JWT from the current session; browser sign-in uses `account.createEmailPasswordSession`.
- `code/backend/src/appwrite.ts` delegates account/JWT checks to Appwrite. PostgreSQL owns application profiles and roles, not credentials.
- `code/backend/src/server.ts:32-41` creates a default traveler profile on first authenticated API contact, rather than through an auth-database signup trigger.
- `code/db/schema.ts:16-37` uses a local UUID primary key and a unique string `appwrite_user_id`. Partner profiles reference the local profile UUID.
- `code/db/migrations/0000_initial-accounts.sql` does not define the claimed auth foreign key, signup trigger or profile RLS policies.
- `code/db/scripts/migrate.ts:33-55` tracks local SQL migrations in a `migrations` table.

**Correction:** update all affected sections together to Appwrite identity plus PostgreSQL/Drizzle application persistence. Do not present the old RLS controls as active security guarantees. Preserve the existing distinction between implemented account access and planned transactional functionality.

### Medium: deprecated API aliases are claimed but do not exist

**Locations:** `project-report/main.tex:177`, `275`.

The report claims temporary unversioned aliases with deprecation and sunset headers. `code/backend/src/server.ts:44-88` defines only the versioned router mounted at `/api/v1`; no aliases or corresponding headers remain.

**Correction:** remove both claims. In the scope table at lines 104-105, spell out `/api/v1/auth/login` and `/api/v1/auth/me` consistently with `/api/v1/health`.

### Medium: important diagram labels are too small in the compiled report

**Locations:** PDF pages 18 and 26; `project-report/main.tex:167`, `234`.

The Gantt image has substantial internal whitespace and is constrained to a roughly 328-point square despite its landscape page. Its actual chart occupies only part of that area. The sequence diagram is roughly 322 points wide, making its message labels much smaller than surrounding text.

**Correction:** crop export whitespace and size the Gantt to the usable landscape width. Give the sequence diagram a dedicated page and more usable width, or a larger vector export. Preserve all approved diagram content; do not simplify it by deleting interactions.

### Medium: the new component diagram is absent

**Locations:** `project-report/main.tex:218-259`, `project-report/figures/`.

The report includes class and behavioral diagrams but not the newly added component view of physical implementation. The state diagram remains in the report; the request to hide it was scoped to the README, so its presence here is not itself an error.

**Correction:** include the component diagram as a structural/implementation view, outside the Behavioral Models section. Canonical assets are `assets/component-diagram.{mmd,drawio,svg,png}`.

### Low: authentication recovery is omitted from implementation status

**Location:** `project-report/main.tex:263-278`.

The frontend contains password-recovery and password-reset handlers (`code/frontend/src/main.ts:347-401`). The report only describes login. The recovery handler also explicitly reports an unconfigured mail service, so the presence of code alone does not prove successful email delivery.

**Correction:** document the recovery/reset implementation and its Appwrite mail-configuration prerequisite, without claiming a tested delivery result.

### Low: report figures duplicate canonical assets

**Location:** `project-report/figures/`, `project-report/main.tex:27`.

The report checks in separate copies of ten diagrams already maintained under repository-root `assets/`. They can drift as diagram sources change.

**Correction:** reference canonical assets through LaTeX's graphics search path, or use an explicit packaging step when a standalone report directory is required.

## What is sound

- Search, bookings, handoffs, payments, ratings and administrative operations are clearly identified as planned, rather than reported as completed.
- BFT, the three-minute median target, pilot participant ranges and the example availability target agree with `project-proposal/main.tex:162-181`.
- No measured performance or pilot outcomes are claimed.
- Figures, tables, contents and bibliography are present; PDF text extraction found no `?` unresolved-reference markers. This is not a fresh LaTeX build or log check.
- Blank pages are consistent with the class's intentional `twoside,openright` configuration, not necessarily a rendering defect.

## Verification completed

Source checks, PDF compilation, build-log inspection, font-embedding checks and rendered-page review are complete. No application build or live authentication test was performed for this report revision.
