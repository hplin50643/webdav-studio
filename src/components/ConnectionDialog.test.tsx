import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectionDialog } from './ConnectionDialog';
import { testConnection } from '../lib/connection-test';
import type { ConnectionProfile } from '../types';

const profile: ConnectionProfile = {
  id: 'test',
  name: '測試主機',
  baseUrl: 'https://dav.example.com/files/',
  auth: 'basic',
  username: 'tester',
  password: 'known-test-password',
  timeoutMs: 5000,
};

afterEach(cleanup);

describe('connection test diagnostics', () => {
  it('shows a readable 401 and safe response details directly in the dialog', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(`Access denied for password=${profile.password}`, {
        status: 401,
        headers: { 'Content-Type': 'text/plain', 'X-Request-ID': 'test-401' },
      }),
    );
    const log = vi.fn();
    render(
      <ConnectionDialog
        profile={profile}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onTest={(value, signal) => testConnection(value, signal, log)}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '測試連線' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('HTTP 401');
    expect(alert.textContent).toContain('驗證失敗');
    const summary = screen.getByText('查看請求與回應細節');
    expect(summary.closest('details')?.open).toBe(false);
    expect(screen.getByText('test-401')).toBeDefined();
    expect(screen.getByText('Access denied for password=[REDACTED]')).toBeDefined();
    expect(screen.queryByText(profile.password, { exact: false })).toBeNull();
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ status: 401, method: 'PROPFIND' }));

    fireEvent.change(screen.getByRole('textbox', { name: '連線名稱' }), {
      target: { value: '主機' },
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('explains an unreadable cross-origin failure without inventing a cause or HTTP status', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const failure = await testConnection(profile, new AbortController().signal, vi.fn());
    expect(failure?.reason).toContain('無法判定確切原因');
    expect(failure?.request?.status).toBeUndefined();
    expect(failure?.cors).toEqual({
      origin: location.origin,
      headers: 'Authorization, Content-Type, Depth',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('separates the HTTP status from a WebDAV item error', async () => {
    const xml =
      '<multistatus xmlns="DAV:"><response><href>/files/</href><status>HTTP/1.1 403 Forbidden</status></response></multistatus>';
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(xml, { status: 207 }));
    const failure = await testConnection(profile, new AbortController().signal, vi.fn());
    expect(failure?.request?.status).toBe(207);
    expect(failure?.davStatus).toBe(403);
    expect(failure?.reason).toContain('權限不足');
  });

  it('detects a browser-visible redirect without following it or displaying status 0', async () => {
    const response = Response.error();
    Object.defineProperty(response, 'type', { value: 'opaqueredirect' });
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response);
    const failure = await testConnection(profile, new AbortController().signal, vi.fn());
    expect(fetch).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({ redirect: 'manual' }),
    );
    expect(failure?.reason).toContain('重新導向');
    expect(failure?.request?.status).toBeUndefined();
  });

  it('retains a known HTTP error when the response body cannot be read', async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.error(new TypeError('Stream closed'));
      },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(body, { status: 403 }));
    const failure = await testConnection(profile, new AbortController().signal, vi.fn());
    expect(failure?.request?.status).toBe(403);
    expect(failure?.request?.detail).toBeUndefined();
    expect(failure?.reason).toContain('權限不足');
  });
});
