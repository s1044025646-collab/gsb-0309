export type ErrorCode =
  | 'VALIDATION'
  | 'DUPLICATE_NODE'
  | 'BAD_PARENT'
  | 'CYCLE'
  | 'BAD_SELECTOR'
  | 'UNKNOWN_PROPERTY'
  | 'EMPTY_VALUE'
  | 'BAD_IMPORTANT'
  | 'LIMIT_EXCEEDED'
  | 'NOT_FOUND'
  | 'BAD_REQUEST';

export class ApiError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
