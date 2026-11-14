# One-off shift expenses

User approved history-only suggestions: new names must never create expense_categories.
Only queue item 1 is in scope; no deployment or live database mutations.

Manager (native iOS, standalone web and owner dashboard shifts) gains an Add expense button
and repeatable name + amount rows. Existing template expenses remain unchanged. Rows can
be edited/deleted while shift editing is allowed. Suggestions come from saved ordinary
expense names (including previous template expenses, excluding payroll) in this restaurant, matching a case-insensitive prefix, with trimmed,
deduplicated names; selecting a suggestion fills only the name, never a historic amount.
Names/amounts must be complete and positive with at most two decimals before any save
writes begin; a wholly empty new row may be ignored. Zero/negative/nonfinite amounts and
missing names are rejected. Existing debt workflow applies to custom rows too.

Architecture: additive is_custom boolean default false on shift_expenses, preserving all
legacy rows and avoiding ambiguous classification by null foreign keys or magic notes.
Custom rows carry category_name but no category_id/employee_id. Shared split logic returns
custom rows independently, handles settlements before custom classification, and excludes
custom paid amounts from unmanagedPaidTotal when the form owns them. Existing templates,
inactive categories, salary-period debts and settlement rows retain their semantics.
Amounts count exactly once in shift totals, cash balance and reports. Drafts preserve rows.

History names are remembered by a trigger on saved custom expenses in a separate tenant-scoped
RLS-protected names table (no money rows). Removing/renaming an expense retains previously saved
names. Unsaved input never enters history. Read suggestions through a read-only SQL function
through the authenticated gateway. Limit suggestions to 20 matching distinct names; prefix
search happens before limiting, so old names remain searchable. Function executes as invoker;
PUBLIC/anon/authenticated cannot invoke it directly, only service_role via the gateway.
No local-device-only history; data follows the restaurant across devices.

Compared approaches: adding every name to expense_categories contradicts approved behavior;
classifying all null-category rows risks taking ownership of legacy/system expenses. Use
explicit additive metadata instead. Migration is prepared locally and requires release
coordination before new clients reach production.

Acceptance: add Perfume 12.50, totals subtract12.50 once; save/reload/edit/remove preserves
correct totals; next shift P suggests Perfume without creating a template or copying amount;
case/whitespace duplicates collapse; no suggestions from another tenant; invalid partial row
blocks saves before writes; blank row ignored; existing drafts and historic rows remain valid.
