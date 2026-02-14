export const GITHUB_RELEASES_OWNER = 'FlightSimCommunityNL'
export const GITHUB_RELEASES_REPO = 'Dfsc-Installer'

// Optional: allow pre-release updates (disabled by default).
// Enable by setting DFSC_ALLOW_PRERELEASE_UPDATES=1 at runtime.
export const ALLOW_PRERELEASE_UPDATES = process.env.DFSC_ALLOW_PRERELEASE_UPDATES === '1'

export function getGitHubReleasesOwnerRepo() {
  return {
    owner: GITHUB_RELEASES_OWNER,
    repo: GITHUB_RELEASES_REPO,
  }
}

export function getGitHubReleasePageUrl(tagOrVersion: string) {
  const { owner, repo } = getGitHubReleasesOwnerRepo()
  // We link users externally; no in-app GitHub pages.
  return `https://github.com/${owner}/${repo}/releases/tag/${encodeURIComponent(tagOrVersion)}`
}
