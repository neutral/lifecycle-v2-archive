declare module "atlas-reference-validator" {
  export function validateAtlas(
    path: string,
    options: Readonly<{ profile: string; specificationRevision: string }>,
  ): Readonly<{ toJSON(): unknown }>;
}
