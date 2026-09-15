export type LlmProviderErrorCode =
  | "config_missing"
  | "auth_failed"
  | "invalid_model"
  | "timeout"
  | "api_error"
  | "empty_response";

// LLMプロバイダー呼び出し中のエラーを、原因ごとに区別するための共通エラー型。
// message はサーバーログ用の詳細（原因の特定に使う）。ユーザー向けにはこのメッセージを
// そのまま出さず、toSafeApiResponse() が返す汎用メッセージだけを使うこと
// （credentialや内部情報を露出しないため）。
export class LlmProviderError extends Error {
  readonly code: LlmProviderErrorCode;

  constructor(message: string, code: LlmProviderErrorCode, cause?: unknown) {
    super(message, { cause });
    this.code = code;
  }
}

const SAFE_MESSAGES: Record<LlmProviderErrorCode, string> = {
  config_missing: "サーバーの設定が不足しています。しばらくしてから再度お試しください。",
  auth_failed: "LLMサービスへの認証に失敗しました。管理者にお問い合わせください。",
  invalid_model: "指定されたモデルが利用できません。管理者にお問い合わせください。",
  timeout: "LLMの応答がタイムアウトしました。しばらくしてから再度お試しください。",
  api_error: "LLMサービスの呼び出しに失敗しました。しばらくしてから再度お試しください。",
  empty_response: "LLMから有効な応答を取得できませんでした。しばらくしてから再度お試しください。",
};

const HTTP_STATUS: Record<LlmProviderErrorCode, 500 | 502 | 504> = {
  config_missing: 500,
  auth_failed: 500,
  invalid_model: 500,
  timeout: 504,
  api_error: 502,
  empty_response: 502,
};

// LLMプロバイダーのエラーを、クライアントに返してよい安全なレスポンスに変換する。
// 詳細（cause等）はここでは返さない。呼び出し側でサーバーログに別途出力すること。
export function toSafeApiResponse(err: LlmProviderError): { status: 500 | 502 | 504; message: string } {
  return { status: HTTP_STATUS[err.code], message: SAFE_MESSAGES[err.code] };
}
