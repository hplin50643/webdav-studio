import type { ConnectionProfile, LogWriter, RequestLog } from '../types';
import { DavClient, DavError } from './webdav';

export interface ConnectionTestFailure {
  reason: string;
  guidance: string[];
  request?: RequestLog;
  davStatus?: number;
  cors?: { origin: string; headers: string };
}

function describeConnectionFailure(
  error: unknown,
  request: RequestLog | undefined,
  origin: string,
  auth: ConnectionProfile['auth'],
  crossOrigin: boolean,
): ConnectionTestFailure {
  const davError = error instanceof DavError ? error : undefined;
  const reason = davError?.message ?? '無法完成 WebDAV 連線測試。';
  const status = davError?.status;
  const failure: ConnectionTestFailure = {
    reason,
    guidance: [],
    request,
    davStatus: status !== request?.status ? status : undefined,
  };

  switch (davError?.kind) {
    case 'mixed-content':
      return { ...failure, guidance: ['將 WebDAV 服務設為 HTTPS，並使用瀏覽器信任的憑證。'] };
    case 'redirect':
      return {
        ...failure,
        guidance: [
          '填入最終的 WebDAV 服務網址（含資料夾路徑和尾端斜線）。檢查反向代理是否將請求轉到登入頁。',
        ],
      };
    case 'timeout':
      return { ...failure, guidance: ['確認主機有回應，再視需要調高請求逾時。'] };
    case 'invalid-webdav':
      return {
        ...failure,
        guidance: ['確認這是 WebDAV 資料夾的服務網址。直接送出 PROPFIND 時，應回傳 WebDAV XML。'],
      };
    case 'unreadable':
      return {
        ...failure,
        reason: '瀏覽器未提供可讀取的 HTTP 回應，無法判定確切原因。',
        guidance: [
          '確認網址、連接埠、網路及 HTTPS 憑證。若主機位於區域網路，確認瀏覽器允許網頁存取區域網路。',
          ...(crossOrigin
            ? [
                '檢查主機的 CORS 設定。OPTIONS 預檢應能在未登入時成功，PROPFIND 的成功及錯誤回應都應允許目前網站來源。',
              ]
            : []),
        ],
        cors: crossOrigin
          ? {
              origin,
              headers:
                auth === 'basic' ? 'Authorization, Content-Type, Depth' : 'Content-Type, Depth',
            }
          : undefined,
      };
  }

  switch (status) {
    case 401:
      failure.guidance = [
        auth === 'anonymous'
          ? '主機要求登入。請切換驗證方式並填入 WebDAV 帳號與密碼。'
          : '確認 WebDAV 帳號、密碼或應用程式密碼，並確認主機支援 Basic Authentication。',
      ];
      break;
    case 403:
      failure.guidance = ['確認帳號有目標資料夾的讀取權限，以及主機或反向代理允許 PROPFIND。'];
      break;
    case 404:
      failure.reason = '找不到 WebDAV 根目錄。';
      failure.guidance = ['確認主機、連接埠和完整 WebDAV 資料夾路徑。'];
      break;
    case 405:
    case 501:
      failure.guidance = ['確認 WebDAV 服務已啟用，且反向代理允許 PROPFIND。'];
      break;
    default:
      if (status && status >= 500) failure.guidance = ['查看 WebDAV 主機或反向代理的服務紀錄。'];
  }
  return failure;
}

export async function testConnection(
  profile: ConnectionProfile,
  signal: AbortSignal,
  log: LogWriter,
): Promise<ConnectionTestFailure | undefined> {
  let request: RequestLog | undefined;
  const connection = new DavClient(profile, (entry) => {
    if (entry.method === 'PROPFIND') request = entry;
    log(entry);
  });
  try {
    await connection.testRoot(signal);
  } catch (error) {
    return describeConnectionFailure(
      error,
      request,
      location.origin,
      profile.auth,
      new URL(connection.base).origin !== location.origin,
    );
  } finally {
    connection.abortAll();
  }
}
