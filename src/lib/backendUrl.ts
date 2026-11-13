// Development requests go through Vite's /api proxy. A localhost backend URL
// belongs to the development computer, not to the phone viewing the app.
// Production can use the same origin or an explicitly configured API host.
export function resolveBackendUrl(apiUrl: string | undefined, development: boolean): string {
  if (development) return '';
  return (apiUrl ?? '').trim().replace(/\/+$/, '').replace(/\/api$/, '');
}

export const BACKEND_URL = resolveBackendUrl(import.meta.env.VITE_API_URL, import.meta.env.DEV);
