/** A tool call the model got wrong. Its message goes back to the model, so it can correct the call. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}
