# One-off expenses implementation plan

Goal: implement only approved queue item 1 on native/web Manager and owner shifts.
Architecture: explicit is_custom metadata, shared domain split, authenticated derived history.
Spec: docs/superpowers/specs/2026-11-13-custom-expenses-design.md
Constraints: preserve dirty workspace, no commits/publication/live SQL or financial mutations.

- [x] Shared domain and regression tests: custom round trip/ownership, settlement/debt exclusions,
  decimal validation, history prefix normalization; additive migration + gateway scope.
- [x] iOS model/UI/drafts/save + autocomplete with stale-response guards and keyboard access.
- [x] Web Manager/dashboard model/UI/save + reusable autocomplete rows with keyboard access.
- [x] Run tests/types/build, meaningful browser fixtures, native build/simulator, offline Semgrep;
  inspect role/tenant/input boundaries and obtain independent review before completion.

Review focus: old clients preserve custom rows; new clients don't delete system expenses;
failed/duplicate saves don't count twice; old drafts decode; out-of-order suggestions don't
cross dates/tenants; debt settlements not reclassified; reports count named custom rows once.


## Final verification
- 85 Vitest tests across13files pass, including actual form persistence harnesses for bothwebforms.
- TypeScript andproductionwebbuild pass. Newcomponents/helpers/tests ESLint pass; repository-widelint remains failing (legacy/project-level findings), so no global lint-clean claim.
- Native Debug simulatorbuild andthreegroups of actual Swift domain/Manager-model tests pass. OfflineiPhone18Pro UI: name+prefixsuggestions visibleabovekeyboard, amount12.50 countedonce, debt/delete/invalidsave checked.
- Productionbrowser fixtures at390x844/1440x960: autocompletekeyboardselection, insert/reload/edit/repeatsave withoutduplicates, unpaid/removal, zero templatewrites, invalidrowzero financialwrites; dashboarddirectsavechecked. No pageexceptions/horizontaloverflow. Mobileerrorstatuswrapswithin358px.
- DisposablelocalPostgres: additive migration replay, legacyrows retained, stableUUIDupsert, tenant shiftguard, namehistoryretention/case/whitespace, direct anon/authenticated denial, settledcustom immutability pass. No productionDBconnectionormutation.
- SemgrepOSS six rulesets final13 application/SQLfiles, zero findings, zero failed/skipped. Metrics off; source not uploaded. Pro unavailable; CodeQL not run because private-source license eligibility not established.
- Independentreview issues (UUIDcase, settleddebts/remoteadditions, retry, blankdraft, historywhitespace) corrected and coveredbyregressions. No outstanding actionablefindings.
- Deployment/migration/application-store release remain deferred at user's request. Apply docs/migrations/custom-shift-expenses-2026-11-13.sql before releasing server/web/iOS clients. Existingclients preserve customrows as unmanagedledgerexpenses.
