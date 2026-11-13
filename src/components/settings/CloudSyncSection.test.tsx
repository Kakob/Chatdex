import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { CloudSyncSection } from './CloudSyncSection';
import { useAuthStore } from '../../stores/authStore';

beforeEach(() => {
  localStorage.clear();
  useAuthStore.setState({ status: 'logged-out', user: null });
  vi.stubGlobal('isSecureContext', false);
  vi.stubGlobal('PublicKeyCredential', undefined);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('shows actionable HTTPS guidance on mobile HTTP instead of blaming the browser', () => {
  render(<CloudSyncSection />);
  expect(screen.getByRole('alert')).toHaveTextContent('same HTTPS Chatdex address');
  expect(screen.queryByText(/doesn't support passkeys/)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Log in' })).not.toBeInTheDocument();
});

it('disables unlocking an existing session on an insecure address', () => {
  localStorage.setItem('chatdex.authToken', 'jwt');
  localStorage.setItem('chatdex.user', JSON.stringify({ userId: 'user-1', email: 'me@example.com' }));
  render(<CloudSyncSection />);
  expect(screen.getByRole('button', { name: 'Unlock with passkey' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Log out' })).toBeEnabled();
});
