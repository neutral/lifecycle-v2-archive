# Discipline usage adequacy

## Purpose

Use this check before Build, before Proof, and before Closure when discipline
was selected or appears material to the work.

## Required answers

The active Control record or Work Boundary must answer:

- Which discipline applied?
- Which package supplied it?
- Which binding selected it?
- Why did it apply to this work?
- Which discipline slice was retrieved?
- Which exact rule, fact, constraint, or decision criterion shaped the run?
- What changed in product judgment, tradeoff, exclusion, falsifier, or proof
  consequence?
- Was the material adopted, rejected, conflicted, or treated as an assumption?
- What changed in Work Boundary, Build, Proof, Closure, or promotion?
- What evidence satisfies each discipline obligation?
- What was rejected and why?
- Did any product-specific statement require promotion?

## Failure conditions

The check fails when:

- discipline shaped work but `disciplines_used` is missing
- discipline use records only a path to ignored local material
- selected package has no binding
- selected package has no version or retrieval timestamp
- selected package is broad context with no material state effect
- adopted constraints lack used material
- product judgment was shaped by discipline but the Work Boundary does
  not record the effect
- Proof does not cover discipline obligations
- a conflict is unresolved before Build
- a promotion candidate copies a generic discipline rule without product-specific
  acceptance

## Passing condition

The check passes when the selected package is narrow, material, recorded,
connected to product judgment when it shaped admission, and connected to
evidence or an explicit rejection.
