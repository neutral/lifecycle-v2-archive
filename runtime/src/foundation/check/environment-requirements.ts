/** Selected Docker Check limitation; this leaf owns no parsing or execution. */
export const FOUNDATION_DOCKER_CHECK_ENVIRONMENT_LIMITATION =
  "The first Docker Check profile does not interpret free-text environment requirements.";

/** Authoring guidance only; it neither rejects a draft nor changes its mandate. */
export const FOUNDATION_DOCKER_CHECK_ENVIRONMENT_GUIDANCE = [
  FOUNDATION_DOCKER_CHECK_ENVIRONMENT_LIMITATION,
  "The Docker Check execution route returns unsupported before allocation for every nonempty Environment requirement, even when it repeats the Binding's settings.",
  "Environment requirement is optional; omit it only when no additional proof precondition is intended. The exact selected Binding already declares its executable, arguments, working directory, environment, network selection and timeout.",
  "An authorized baseline postcondition not-run Receipt does not establish final execution support.",
  "Preserve genuine additional requirements and request a supported selection or a Director decision to change the mandate. Do not silently remove or reinterpret an authored requirement.",
  "Semantic draft validity does not establish Check execution feasibility.",
].join(" ");
