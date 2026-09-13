import { assertFoundationAuthorityExecutionContext, discardFoundationAuthorityCredential, type FoundationAuthorityCredential } from "./repository/authority.js";
import {
  createFoundationRuntimeOperationRequest,
  type FoundationRuntimeAdmitRequest,
  type FoundationRuntimeAcceptRequest,
  type FoundationRuntimeNoShipRequest,
  type FoundationRuntimeOperationResult,
} from "@neutral/lifecycle-protocol";
import {
  resolveFoundationInstalledRuntimeConfigurationV7,
} from "./installed-configuration-v7.js";
import {
  createFoundationRuntimeMutationExecutorV7,
  digestFoundationInvocationPrivateAuthorizationSemanticInputV1,
  type FoundationInvocationPrivateAuthorizationClaimV1,
  type FoundationInvocationPrivateAuthorizationExpectationV1,
  type FoundationInvocationPrivateDeliveryLocatorV1,
} from "./runtime-mutation-v7.js";

type InvocationPrivateAuthoritySelection =
  | Readonly<{ operation: "delivery.admit" | "delivery.accept"; input: null }>
  | Readonly<{
      operation: "delivery.no-ship";
      input: Readonly<{ semanticMarkdown: string }>;
    }>;

export type FoundationInvocationPrivateAuthorizationInputV1 = Readonly<{
  locator: FoundationInvocationPrivateDeliveryLocatorV1;
  selection: InvocationPrivateAuthoritySelection;
  /** Ephemeral and invocation-private; never enters a request, result, or challenge. */
  authorityCredential: FoundationAuthorityCredential;
  beginClaim(): FoundationInvocationPrivateAuthorizationClaimV1 |
    Promise<FoundationInvocationPrivateAuthorizationClaimV1>;
}>;

export type FoundationInvocationPrivateAuthorizationRuntimeV1 = Readonly<{
  authorize(
    input: FoundationInvocationPrivateAuthorizationInputV1,
  ): Promise<FoundationRuntimeOperationResult>;
}>;

type AuthorityRequest =
  | FoundationRuntimeAdmitRequest
  | FoundationRuntimeAcceptRequest
  | FoundationRuntimeNoShipRequest;

function authorityRequest(
  input: FoundationInvocationPrivateAuthorizationInputV1,
): AuthorityRequest {
  if (input.selection.operation === "delivery.no-ship") {
    return createFoundationRuntimeOperationRequest({
      target: input.locator.target,
      deliveryId: input.locator.deliveryId,
      operation: "delivery.no-ship",
      input: input.selection.input,
    }) as FoundationRuntimeNoShipRequest;
  }
  if (input.selection.operation === "delivery.admit") {
    return createFoundationRuntimeOperationRequest({
      target: input.locator.target,
      deliveryId: input.locator.deliveryId,
      operation: "delivery.admit",
      input: null,
    }) as FoundationRuntimeAdmitRequest;
  }
  return createFoundationRuntimeOperationRequest({
    target: input.locator.target,
    deliveryId: input.locator.deliveryId,
    operation: "delivery.accept",
    input: null,
  }) as FoundationRuntimeAcceptRequest;
}

/**
 * Create the installed invocation-private Director handoff. This is a
 * server-side source API, not a public Runtime Facade operation or protocol.
 */
export function createFoundationInvocationPrivateAuthorizationRuntimeV1(
  options: Readonly<{
    environment?: NodeJS.ProcessEnv;
    now?: () => string;
  }> = {},
): FoundationInvocationPrivateAuthorizationRuntimeV1 {
  const mutation = createFoundationRuntimeMutationExecutorV7({ now: options.now });
  return Object.freeze({
    async authorize(input): Promise<FoundationRuntimeOperationResult> {
      try {
        const request = authorityRequest(input);
        const context = Object.freeze({ authorityCredential: input.authorityCredential });
        assertFoundationAuthorityExecutionContext(context, request.operation);
        const configuration = await resolveFoundationInstalledRuntimeConfigurationV7({
          environment: options.environment,
        });
        return await mutation.authorizeInvocationPrivate({
          request,
          context,
          configuration,
          gate: Object.freeze({
            beginClaim: input.beginClaim,
          }),
        });
      } finally {
        discardFoundationAuthorityCredential(input.authorityCredential);
      }
    },
  });
}

export type {
  FoundationInvocationPrivateAuthorizationClaimV1,
  FoundationInvocationPrivateAuthorizationExpectationV1,
  FoundationInvocationPrivateDeliveryLocatorV1,
};

export { digestFoundationInvocationPrivateAuthorizationSemanticInputV1 };
