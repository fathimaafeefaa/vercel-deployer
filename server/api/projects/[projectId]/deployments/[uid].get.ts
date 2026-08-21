import { defineEventHandler, getRouterParam, createError } from 'h3'
import { createVercelApi } from '~~/server/utils/api'
import { getProjectById } from '~~/server/utils/projects'
import { validateUid } from '~~/server/utils/validation'

interface VercelDeploymentDetail {
  uid: string
  id: string
  name: string
  url: string
  alias?: string[]
  state?: string
  readyState?: string
  target?: string
  createdAt?: number
  buildingAt?: number
  readyAt?: number
  inspectorUrl?: string
  meta?: Record<string, string>
  creator?: { username?: string; email?: string }
  regions?: string[]
}

export default defineEventHandler(async (event) => {
  const project = getProjectById(getRouterParam(event, 'projectId'))
  if (!project) throw createError({ statusCode: 404, message: 'Project not found' })

  const uid = getRouterParam(event, 'uid')
  if (!uid) throw createError({ statusCode: 400, message: 'Missing uid' })

  // Intercept GitHub Action phantom/pending IDs
  if (uid.startsWith('gh-')) {
    if (uid.startsWith('gh-run-') && project.github) {
      const runId = uid.replace('gh-run-', '')
      const { token, owner, repo } = project.github
      try {
        const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}`, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
        })
        if (response.ok) {
          const run = await response.json() as any
          return {
            uid,
            name: run.name,
            state: run.status === 'completed' ? (run.conclusion === 'success' ? 'READY' : 'ERROR') : 'BUILDING',
            url: run.html_url,
            target: null,
            createdAt: new Date(run.created_at).getTime(),
            buildingAt: new Date(run.run_started_at || run.created_at).getTime(),
            readyAt: run.updated_at ? new Date(run.updated_at).getTime() : null,
            buildDurationMs: run.updated_at ? new Date(run.updated_at).getTime() - new Date(run.run_started_at || run.created_at).getTime() : null,
            inspectorUrl: run.html_url,
            branch: run.head_branch,
            commitSha: run.head_sha,
            commitMessage: run.head_commit?.message || run.name,
            commitAuthor: run.head_commit?.author?.name || run.actor?.login || 'github-actions',
            repoUrl: `https://github.com/${owner}/${repo}`,
            prId: null,
            ghOrg: owner,
            ghRepo: repo,
            regions: [],
            creator: run.actor?.login || 'github-actions',
          }
        }
      } catch (err) {
        // Fallback to placeholder if fetch fails
      }
    }

    // Fallback for pending workflows that don't have a real run ID yet
    return {
      uid,
      name: 'GitHub Action',
      state: 'BUILDING',
      url: `https://github.com/${project.github?.owner}/${project.github?.repo}/actions`,
      target: null,
      createdAt: Date.now(),
      buildingAt: Date.now(),
      readyAt: null,
      buildDurationMs: null,
      inspectorUrl: `https://github.com/${project.github?.owner}/${project.github?.repo}/actions`,
      branch: 'pending',
      commitSha: null,
      commitMessage: 'Starting workflow...',
      commitAuthor: 'github-actions',
      repoUrl: project.github ? `https://github.com/${project.github.owner}/${project.github.repo}` : null,
      prId: null,
      ghOrg: project.github?.owner || null,
      ghRepo: project.github?.repo || null,
      regions: [],
      creator: 'github-actions',
    }
  }

  validateUid(uid)

  const vercelApi = createVercelApi(project)
  const d = await vercelApi<VercelDeploymentDetail>(`/v13/deployments/${uid}`)
  const meta = d.meta ?? {}

  const branch =
    meta.githubCommitRef ??
    meta.gitlabCommitRef ??
    meta.bitbucketCommitRef ??
    null

  const fullSha =
    meta.githubCommitSha ??
    meta.gitlabCommitSha ??
    meta.bitbucketCommitSha ??
    null

  const commitMessage =
    meta.githubCommitMessage ??
    meta.gitlabCommitMessage ??
    meta.bitbucketCommitMessage ??
    null

  const commitAuthor =
    meta.githubCommitAuthorLogin ??
    meta.gitlabCommitAuthorName ??
    meta.bitbucketCommitAuthorName ??
    null

  const ghOrg = meta.githubOrg ?? null
  const ghRepo = meta.githubRepo ?? null
  const prId = meta.githubPrId ?? null

  const repoUrl = ghOrg && ghRepo ? `https://github.com/${ghOrg}/${ghRepo}` : null

  const branchUrl =
    d.alias?.find((a) => a.includes('-git-')) ??
    d.url

  const buildDurationMs =
    d.buildingAt && d.readyAt ? d.readyAt - d.buildingAt : null

  return {
    uid: d.uid,
    name: d.name,
    state: d.readyState ?? d.state ?? 'UNKNOWN',
    url: branchUrl,
    target: d.target ?? null,
    createdAt: d.createdAt ?? null,
    buildingAt: d.buildingAt ?? null,
    readyAt: d.readyAt ?? null,
    buildDurationMs,
    inspectorUrl: d.inspectorUrl ?? null,
    branch,
    commitSha: fullSha ?? null,
    commitMessage,
    commitAuthor,
    repoUrl,
    prId,
    ghOrg,
    ghRepo,
    regions: d.regions ?? [],
    creator: d.creator?.username ?? d.creator?.email ?? null,
  }
})
