# Update Product Meaning

## Purpose

Use this operation when admitted learning should become durable product
authority. Product judgment from a Work Boundary may be a source of learning,
but only the durable product meaning extracted from it enters semantic
authority.

## Procedure

1. Identify the durable meaning that changed. If the source is product
   judgment, separate the reusable product meaning from process-local tradeoff,
   proof status, and run history.
2. Open `semantic-authority/semantic-authority-surface-registry.yaml`.
3. Select the owning semantic authority surface from `owns`,
   `promotion_candidates`, and the surface contract.
4. Read the surface contract under `semantic-authority/surfaces/`.
5. Use the generated entry template under `semantic-authority/templates/`.
6. Create or update the smallest entry in the surface storage locator.
7. Fill stable `id`, `state`, `scope`, `current_meaning`, `retrieval_keys`,
   `target_references`, `related_surfaces`, supersession, and `updated_at`
   fields at the depth future work needs.
8. Add only the Markdown body sections needed for the entry's durable meaning.
   Use the template's body-shape guidance when it fits, and delete irrelevant
   sections instead of filling placeholders.
9. Run [checks/entry-adequacy.md](checks/entry-adequacy.md).
10. Check semantic authority backpressure before marking the update complete.
11. Update the active Clarity Boundary, Context Review Packet, Work Boundary,
    knowledge promotion decision, closure record, or archive decision that
    required the update.

Use the installed registry field `storage_locator` to find the selected
surface. For a `records/` folder, create or update an entry in that folder.
For a file pattern, create or update the matching committed file. Description
currently uses `_*.desc.md` beside the source file or source group it describes
instead of `records/description/`.

## Migration Inputs

When the learning comes from an old docs area, wiki, methodology, source
repository, support taxonomy, or other migrated source, treat the source as
input material rather than target structure.

For each candidate item, choose one outcome before writing durable authority:

```text
keep content in the owning target surface
reshape content so it fits the target surface, labels, naming, and chunking
drop source structure, navigation, duplicate history, obsolete labels, or old
document types that are not current target meaning
defer material whose current target owner is unclear
```

The resulting entry should read as native to the current target model. It
should not require old source paths, old file boundaries, old page hierarchy,
or old support labels to be understood or retrieved. Keep that provenance in
Control records, Evidence Packets, hardening notes, source inventories, or
archives.

## Update Outcomes

Every proposed product-meaning update ends in one outcome:

```text
promoted into the owning semantic authority surface
rejected because it is not durable product meaning
archived as useful history only
deferred with retrieval condition and owner
blocked because the owning surface or required earlier meaning is missing
```

Do not leave a learning candidate implicit after closure. Either update the
owning semantic authority entry or record why no product authority changed.

## Guardrails

Do not write runtime observations, proof summaries, chat notes, or closed
Control record state directly into product authority. Promote only the product
meaning that passed a semantic authority update or knowledge promotion. A closed
product judgment does not govern future work unless its durable meaning was
rewritten into the owning semantic authority surface.

Do not add `source_basis` to semantic authority entries. Keep source material,
admission context, proof, and promotion evidence in the owning Control record,
archive decision, hardening note, observation record, or source-material
workspace. A current semantic authority entry should be usable without reopening
those records.

Do not create all semantic authority surfaces for every change. Update only the
surface whose owned meaning changed or whose absence would make future work
unsafe.

Do not use target references as a proof registry. Add a target reference only
when the implementation surface is part of the entry's owned meaning.

## Failure Route

If no semantic authority surface owns the changed meaning, use
[resolve-semantic-authority-backpressure.md](resolve-semantic-authority-backpressure.md).
