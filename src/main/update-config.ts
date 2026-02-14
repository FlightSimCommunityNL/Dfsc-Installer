export const GITHUB_RELEASES_OWNER = 'FlightSimCommunityNL'
export const GITHUB_RELEASES_REPO = 'Dfsc-Installer'

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
