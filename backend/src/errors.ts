export type ArticleFetchStatus = 400 | 403 | 422 | 502;

export class ArticleFetchError extends Error {
  readonly status: ArticleFetchStatus;

  constructor(message: string, status: ArticleFetchStatus) {
    super(message);
    this.status = status;
  }
}
