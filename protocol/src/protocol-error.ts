export class FoundationProtocolError extends Error {
  readonly code: string;
  readonly path: readonly (string | number)[];

  constructor(code: string, message: string, path: readonly (string | number)[] = []) {
    super(message);
    this.name = "FoundationProtocolError";
    this.code = code;
    this.path = Object.freeze([...path]);
  }
}
