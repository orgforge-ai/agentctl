export class AgentctlError extends Error {
  constructor(message: string, public readonly exitCode: number = 1) {
    super(message);
    this.name = "AgentctlError";
  }
}
