// Branch binding: a pasted /tree/<branch> URL must bind to that branch, the
// card must stay reachable once bound, and an unresolvable ref must never be
// saved. Every request goes to api.github.com (SPEC-intent-trace §13).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { clearAllData, createHumanProject } from '../../lib/db';
import { getUnderstandingProject } from '../../lib/db/understanding';
import { clearGitHubCaches } from '../../lib/github/client';
import { RepoBindingCard } from './RepoBindingCard';
import type { UnderstandingProject } from '../../types/understanding';

const SHA_FEATURE = 'f'.repeat(40);
const SHA_MAIN = 'a'.repeat(40);
const BRANCH = 'feature/project-workspace-golden-path';
const TREE_URL = `https://github.com/Kakob/Chatdex/tree/${BRANCH}`;

const urls: string[] = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const REPO_BODY = {
  default_branch: 'main',
  private: false,
  html_url: 'https://github.com/Kakob/Chatdex',
  permissions: { push: false },
};

/** `refs` maps a ref to the sha it resolves to; anything else 404s. */
function stubFetch(refs: Record<string, string>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (/\/repos\/Kakob\/Chatdex$/.test(url)) return json(REPO_BODY);
      const m = /\/commits\/(.+)$/.exec(url);
      if (m) {
        const sha = refs[decodeURIComponent(m[1])];
        return sha ? json({ sha }) : json({ message: 'Not Found' }, 404);
      }
      return json({ message: 'Not Found' }, 404);
    })
  );
}

function renderCard(project: UnderstandingProject, props: Partial<Parameters<typeof RepoBindingCard>[0]> = {}) {
  let latest = project;
  const utils = render(
    <RepoBindingCard
      project={project}
      onSaved={(p) => {
        latest = p;
      }}
      {...props}
    />
  );
  return { ...utils, latest: () => latest };
}

async function seed(repository?: UnderstandingProject['repository']): Promise<UnderstandingProject> {
  const project = await createHumanProject({ name: 'Chatdex' });
  if (!repository) return project;
  const next = { ...project, repository };
  const { putUnderstandingProject } = await import('../../lib/db/understanding');
  await putUnderstandingProject(next);
  return next;
}

beforeEach(async () => {
  urls.length = 0;
  clearGitHubCaches();
  await clearAllData();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RepoBindingCard branch binding', () => {
  it('prefills the branch from a pasted /tree/ URL, resolves it, and saves it as the tracked ref', async () => {
    stubFetch({ [BRANCH]: SHA_FEATURE, main: SHA_MAIN });
    const user = userEvent.setup();
    const project = await seed();
    const { latest } = renderCard(project);

    await user.click(screen.getByLabelText('Repository'));
    await user.paste(TREE_URL);
    expect((screen.getByLabelText('Branch or ref') as HTMLInputElement).value).toBe(BRANCH);

    await user.click(screen.getByRole('button', { name: 'Validate' }));
    await waitFor(() => expect(screen.getByText(BRANCH)).toBeInTheDocument());
    expect(screen.getByText(SHA_FEATURE.slice(0, 7))).toBeInTheDocument();
    // The old headline announced the default branch as the verdict.
    expect(screen.queryByText(/tracking default branch/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(latest().repository?.pinnedRef).toBe(BRANCH));
    const stored = await getUnderstandingProject(project.id);
    expect(stored?.repository).toMatchObject({ owner: 'Kakob', repo: 'Chatdex', defaultBranch: 'main', pinnedRef: BRANCH });

    // Only the repo lookup and the one ref resolve; all on api.github.com.
    expect(urls).toHaveLength(2);
    expect(urls.every((u) => u.startsWith('https://api.github.com/'))).toBe(true);
    expect(urls[1]).toContain(`/commits/${encodeURIComponent(BRANCH)}`);
  });

  it('round-trips a saved ref back into the field', async () => {
    stubFetch({ [BRANCH]: SHA_FEATURE });
    const project = await seed({ owner: 'Kakob', repo: 'Chatdex', defaultBranch: 'main', pinnedRef: BRANCH });
    renderCard(project);
    expect((screen.getByLabelText('Branch or ref') as HTMLInputElement).value).toBe(BRANCH);
    expect((screen.getByLabelText('Repository') as HTMLInputElement).value).toBe('Kakob/Chatdex');
  });

  it('falls back through slashed-ref candidates and settles on the one that exists', async () => {
    stubFetch({ main: SHA_MAIN });
    const user = userEvent.setup();
    const { latest } = renderCard(await seed());

    await user.click(screen.getByLabelText('Repository'));
    await user.paste('https://github.com/Kakob/Chatdex/tree/main/src');
    expect((screen.getByLabelText('Branch or ref') as HTMLInputElement).value).toBe('main/src');

    await user.click(screen.getByRole('button', { name: 'Validate' }));
    await waitFor(() =>
      expect((screen.getByLabelText('Branch or ref') as HTMLInputElement).value).toBe('main')
    );
    // getRepo + the failed main/src + the successful main.
    expect(urls).toHaveLength(3);

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(latest().repository?.pinnedRef).toBe('main'));
  });

  it('refuses to save a ref that does not resolve', async () => {
    stubFetch({ main: SHA_MAIN });
    const user = userEvent.setup();
    const project = await seed();
    renderCard(project);

    await user.click(screen.getByLabelText('Repository'));
    await user.paste('Kakob/Chatdex');
    await user.type(screen.getByLabelText('Branch or ref'), 'no-such-branch');
    await user.click(screen.getByRole('button', { name: 'Validate' }));

    await waitFor(() => expect(screen.getByText(/Ref not found/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect((await getUnderstandingProject(project.id))?.repository).toBeUndefined();
  });

  it('collapses to a summary when bound and reopens with the branch prefilled', async () => {
    stubFetch({ [BRANCH]: SHA_FEATURE });
    const user = userEvent.setup();
    const project = await seed({ owner: 'Kakob', repo: 'Chatdex', defaultBranch: 'main', pinnedRef: BRANCH });
    renderCard(project, { collapsible: true });

    expect(screen.getByText('Kakob/Chatdex')).toBeInTheDocument();
    expect(screen.getByText(BRANCH)).toBeInTheDocument();
    expect(screen.queryByLabelText('Branch or ref')).not.toBeInTheDocument();

    await user.click(screen.getByLabelText('Change repository binding'));
    expect((screen.getByLabelText('Branch or ref') as HTMLInputElement).value).toBe(BRANCH);
  });

  it('fills the ref from a suggested-ref chip', async () => {
    stubFetch({ 'demo/project-deletion': SHA_FEATURE });
    const user = userEvent.setup();
    renderCard(await seed(), { suggestedRefs: [{ ref: 'demo/project-deletion', label: '9987455 · demo/project-deletion' }] });

    await user.click(screen.getByRole('button', { name: '9987455 · demo/project-deletion' }));
    expect((screen.getByLabelText('Branch or ref') as HTMLInputElement).value).toBe('demo/project-deletion');
  });
});
