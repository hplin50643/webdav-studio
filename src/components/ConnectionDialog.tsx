import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Eye, EyeOff, Globe2, LoaderCircle, PlugZap, ShieldCheck } from 'lucide-react';
import type { ConnectionProfile } from '../types';
import { normalizeBase } from '../lib/paths';
import type { ConnectionTestFailure } from '../lib/connection-test';
import { InlineError, Modal } from './Modal';

function ConnectionDiagnosis({ failure }: { failure: ConnectionTestFailure }) {
  const { request, davStatus, cors } = failure;
  const diagnosis = useRef<HTMLElement>(null);
  useEffect(() => {
    diagnosis.current?.scrollIntoView?.({ block: 'nearest' });
  }, [failure]);
  return (
    <section ref={diagnosis} className="connection-diagnosis" aria-label="連線診斷">
      <div role="alert">
        <strong>連線測試失敗{request?.status ? ` · HTTP ${request.status}` : ''}</strong>
        <p>{failure.reason}</p>
      </div>
      {failure.guidance.length > 0 && (
        <ul>
          {failure.guidance.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
      {cors && (
        <dl>
          <dt>允許的網站來源</dt>
          <dd>
            <code>{cors.origin}</code>
          </dd>
          <dt>允許的請求方法</dt>
          <dd>
            <code>PROPFIND</code>
          </dd>
          <dt>允許的請求標頭</dt>
          <dd>
            <code>{cors.headers}</code>
          </dd>
        </dl>
      )}
      {request && (
        <details>
          <summary>查看請求與回應細節</summary>
          <dl>
            <dt>請求</dt>
            <dd>
              <code>
                {request.method} {request.url}
              </code>
            </dd>
            <dt>耗時</dt>
            <dd>{request.durationMs} ms</dd>
            {davStatus !== undefined && (
              <>
                <dt>WebDAV 項目狀態</dt>
                <dd>{davStatus}</dd>
              </>
            )}
            {Object.entries(request.headers).map(([name, value]) => (
              <div key={name}>
                <dt>
                  <code>{name}</code>
                </dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          {request.detail && (
            <>
              <p>伺服器回應摘要</p>
              <pre>{request.detail}</pre>
            </>
          )}
        </details>
      )}
    </section>
  );
}

export function ConnectionDialog({
  profile,
  onClose,
  onSave,
  onTest,
}: {
  profile?: ConnectionProfile;
  onClose: () => void;
  onSave: (profile: ConnectionProfile) => Promise<void>;
  onTest: (
    profile: ConnectionProfile,
    signal: AbortSignal,
  ) => Promise<ConnectionTestFailure | undefined>;
}) {
  const [draft, setDraft] = useState<ConnectionProfile>(
    profile ?? {
      id: crypto.randomUUID(),
      name: '',
      baseUrl: '',
      auth: 'basic',
      username: '',
      password: '',
      timeoutMs: 120_000,
    },
  );
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState<'save' | 'test'>();
  const [error, setError] = useState('');
  const [failure, setFailure] = useState<ConnectionTestFailure>();
  const [result, setResult] = useState('');
  const testController = useRef<AbortController | null>(null);
  function update<K extends keyof ConnectionProfile>(key: K, value: ConnectionProfile[K]) {
    setDraft((old) => ({ ...old, [key]: value }));
    setError('');
    setFailure(undefined);
    setResult('');
  }
  function validated(): ConnectionProfile {
    if (!draft.name.trim()) throw new Error('請填寫連線名稱。');
    if (draft.auth === 'basic' && (!draft.username || draft.username.includes(':')))
      throw new Error('請填寫帳號，帳號不可包含冒號。');
    if (!Number.isFinite(draft.timeoutMs) || draft.timeoutMs < 5000 || draft.timeoutMs > 3_600_000)
      throw new Error('逾時秒數必須介於 5 與 3600 之間。');
    return {
      ...draft,
      name: draft.name.trim(),
      baseUrl: normalizeBase(draft.baseUrl),
      ...(draft.auth === 'anonymous' ? { username: '', password: '' } : {}),
    };
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setFailure(undefined);
    setBusy('save');
    try {
      await onSave(validated());
    } catch (error) {
      setError(error instanceof Error ? error.message : '儲存失敗。');
    } finally {
      setBusy(undefined);
    }
  }
  async function test() {
    setError('');
    setFailure(undefined);
    setResult('');
    setBusy('test');
    try {
      const value = validated();
      testController.current = new AbortController();
      const signal = testController.current.signal;
      const failure = await onTest(value, signal);
      if (signal.aborted) return;
      if (failure) setFailure(failure);
      else setResult('連線成功！已讀取根目錄，詳細請求可在除錯面板查看。');
    } catch (error) {
      setError(error instanceof Error ? error.message : '連線失敗。');
    } finally {
      setBusy(undefined);
      testController.current = null;
    }
  }
  function close() {
    if (busy === 'save') return;
    testController.current?.abort();
    onClose();
  }
  return (
    <Modal
      title={profile ? '編輯連線' : '新增 WebDAV 連線'}
      subtitle="連接你的主機，檔案直接在瀏覽器與主機之間傳輸。"
      onClose={close}
    >
      <form onSubmit={submit} className="form-stack">
        <label>
          連線名稱
          <input
            value={draft.name}
            onChange={(e) => update('name', e.target.value)}
            placeholder="例如：我的 NAS、工作空間"
            required
            maxLength={80}
            disabled={!!busy}
          />
        </label>
        <label>
          WebDAV 根目錄網址
          <div className="input-icon">
            <Globe2 size={18} />
            <input
              type="url"
              value={draft.baseUrl}
              onChange={(e) => update('baseUrl', e.target.value)}
              onBlur={() => {
                if (!draft.name && draft.baseUrl) {
                  try {
                    update('name', new URL(draft.baseUrl).hostname);
                  } catch {
                    /* validate on submit */
                  }
                }
              }}
              placeholder="https://dav.example.com/files/"
              required
              disabled={!!busy}
              autoComplete="off"
            />
          </div>
          <small>請填寫完整 WebDAV 路徑。主機須允許此網站來源的 CORS 請求。</small>
        </label>
        <label>
          驗證方式
          <select
            value={draft.auth}
            onChange={(e) => update('auth', e.target.value as ConnectionProfile['auth'])}
            disabled={!!busy}
          >
            <option value="basic">帳號與密碼（Basic Authentication）</option>
            <option value="anonymous">匿名連線</option>
          </select>
        </label>
        {draft.auth === 'basic' && (
          <div className="form-columns">
            <label>
              帳號
              <input
                value={draft.username}
                onChange={(e) => update('username', e.target.value)}
                autoComplete="off"
                required
                disabled={!!busy}
              />
            </label>
            <label>
              密碼
              <div className="password-input">
                <input
                  type={visible ? 'text' : 'password'}
                  value={draft.password}
                  onChange={(e) => update('password', e.target.value)}
                  autoComplete="off"
                  disabled={!!busy}
                />
                <button
                  type="button"
                  onClick={() => setVisible(!visible)}
                  aria-label={visible ? '隱藏密碼' : '顯示密碼'}
                >
                  {visible ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </label>
          </div>
        )}
        <label>
          請求逾時（秒）
          <input
            type="number"
            value={draft.timeoutMs / 1000 || ''}
            onChange={(e) => update('timeoutMs', Number(e.target.value) * 1000)}
            min={5}
            max={3600}
            required
            disabled={!!busy}
          />
          <small>大檔案傳輸可視需要提高時間。</small>
        </label>
        <div className="security-note">
          <ShieldCheck size={18} />
          <span>帳號與密碼會以主密碼加密，僅保存在這個瀏覽器。</span>
        </div>
        <InlineError message={error} />
        {failure && <ConnectionDiagnosis failure={failure} />}
        {result && (
          <div className="inline-success" role="status">
            {result}
          </div>
        )}
        <footer className="modal-footer">
          <button className="button secondary" type="button" onClick={test} disabled={!!busy}>
            {busy === 'test' ? <LoaderCircle className="spin" size={17} /> : <PlugZap size={17} />}
            測試連線
          </button>
          <button className="button primary" type="submit" disabled={!!busy}>
            {busy === 'save' && <LoaderCircle size={17} className="spin" />}儲存並連線
          </button>
        </footer>
      </form>
    </Modal>
  );
}
