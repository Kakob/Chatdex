// GitHub-backed RepoSource (SPEC-change-workspace §9, D2). Wraps the hardened
// read-only client: constant host, header-only auth, validated inputs. Every
// path still passes the fetch gate in the indexer before it is cached.

import { getTree, getFileContent, type GitHubClientOptions } from '../github/client';
import { githubRepoKey, type RepoSource } from './sources';

export function createGitHubSource(
  owner: string,
  repo: string,
  opts: GitHubClientOptions = {}
): RepoSource {
  return {
    key: githubRepoKey(owner, repo),
    label: `${owner}/${repo}`,
    async listFiles(sha) {
      const tree = await getTree(owner, repo, sha, opts);
      return {
        truncated: tree.truncated,
        files: tree.entries
          .filter((e) => e.type === 'blob')
          .map((e) => ({ path: e.path, ...(e.size !== undefined ? { size: e.size } : {}) })),
      };
    },
    async readFile(sha, path) {
      const file = await getFileContent(owner, repo, path, sha, opts);
      return { text: file.text, size: file.size };
    },
  };
}
