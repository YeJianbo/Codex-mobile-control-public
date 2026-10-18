export type SubmissionFailureKind = 'writer_occupied' | 'not_started' | 'uncertain' | 'failed';

export class SubmissionFailure extends Error {
  constructor(readonly kind: SubmissionFailureKind, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SubmissionFailure';
  }
}

// Legacy text recognition belongs at the untyped CLI/RPC boundary, before display translation.
export function submissionFailureKind(error: unknown): SubmissionFailureKind {
  if (error instanceof SubmissionFailure) return error.kind;
  const message = error instanceof Error ? error.message : String(error);
  if (/active writer|正在桌面执行|当前任务仍在运行/i.test(message)) return 'writer_occupied';
  if (/timeout|timed out|EPIPE|ECONNRESET|ETIMEDOUT|broken pipe|超时|退出|closed|disconnect|断开|连接中断|已关闭|结果待确认/i.test(message)) return 'uncertain';
  return 'failed';
}

export function isWriterOccupied(error: unknown): boolean {
  return submissionFailureKind(error) === 'writer_occupied';
}
