import { ZodError } from "zod";

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  errors?: Array<{
    path: string;
    message: string;
  }>;
}

export class HttpProblem extends Error {
  readonly details: ProblemDetails;

  constructor(details: ProblemDetails) {
    super(details.detail ?? details.title);
    this.name = "HttpProblem";
    this.details = details;
  }
}

export function isHttpProblem(value: unknown): value is HttpProblem {
  return value instanceof HttpProblem;
}

export function fromZodError(error: ZodError, instance?: string): HttpProblem {
  return new HttpProblem({
    type: "https://api.crosspost.local/problems/validation-error",
    title: "Validation failed",
    status: 400,
    detail: "One or more request fields are invalid",
    instance,
    errors: error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  });
}
