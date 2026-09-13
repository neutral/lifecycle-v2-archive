/** Classifies review meaning before any Delivery records its response. */
export function reviewRequiresMandateResolutionV1(review: Readonly<{
  mandateApplicability: Readonly<{disposition?:unknown}>;
  baselineApplicability: readonly Readonly<{disposition?:unknown}>[];
  mandateExcess:boolean;
  missingObligationIds:readonly string[];
  overallUncertainty:unknown;
  judgments:readonly Readonly<{uncertainty:unknown}>[];
}>): boolean {
  return review.mandateApplicability.disposition === "requires-readmission" ||
    review.baselineApplicability.some(({disposition}) => disposition === "insufficient") ||
    review.mandateExcess || review.missingObligationIds.length > 0 || review.overallUncertainty === "material" ||
    review.judgments.some(({uncertainty}) => uncertainty === "material");
}
