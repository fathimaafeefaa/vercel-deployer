import { defineEventHandler, getQuery, getRouterParam, createError } from 'h3'
import { createVercelApi, createGithubApi } from '~~/server/utils/api'
import { getProjectById } from '~~/server/utils/projects'

interface VercelDeployment {
  uid: string
  name?: string
  state?: string
  readyState?: string
  target?: string
  createdAt?: number
  created?: number
  inspectorUrl?: string
  meta?: Record<string, string>
}

interface VercelResponse {
  deployments: VercelDeployment[]
}

export default defineEventHandler(async (event) => {
  const project = getProjectById(getRouterParam(event, 'projectId'))
  if (!project) throw createError({ statusCode: 404, message: 'Project not found' })

  const query = getQuery(event)
  const collapse = query.collapse === 'true' || query.collapse === '1'

  const vercelApi = createVercelApi(project)
  const vercelPromise = vercelApi<VercelResponse>('/v6/deployments', {
    query: { limit: '75' },
  }).catch(() => ({ deployments: [] }))

  let githubPromise = Promise.resolve({ workflow_runs: [] as any[] })
  if (project.github) {
    const githubApi = createGithubApi(project)
    githubPromise = githubApi<any>('/actions/runs', {
      query: { event: 'workflow_dispatch', status: 'completed', per_page: 50 },
    }).catch(() => ({ workflow_runs: [] }))
  }

  const [vercelData, githubData] = await Promise.all([vercelPromise, githubPromise])
  const data = vercelData

  const mapped = data.deployments.map((d) => {
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

    const rawCommitMessage =
      meta.githubCommitMessage ??
      meta.gitlabCommitMessage ??
      meta.bitbucketCommitMessage ??
      null

    const commitMessage = rawCommitMessage && rawCommitMessage.includes('Triggered-By:')
      ? rawCommitMessage.split('Triggered-By:')[0].trim()
      : rawCommitMessage

    const commitAuthor =
      meta.githubCommitAuthorLogin ??
      meta.gitlabCommitAuthorName ??
      meta.bitbucketCommitAuthorName ??
      null

    let deployer: string | null = null
    if (rawCommitMessage && rawCommitMessage.includes('Triggered-By:')) {
      const parts = rawCommitMessage.split('Triggered-By:')
      const email = parts[parts.length - 1].trim()
      if (email) {
        deployer = email
      }
    }

    const prId = meta.githubPrId ?? null
    const ghOrg = meta.githubOrg ?? null
    const ghRepo = meta.githubRepo ?? null
    const prUrl = prId && ghOrg && ghRepo
      ? `https://github.com/${ghOrg}/${ghRepo}/pull/${prId}`
      : null

    return {
      uid: d.uid,
      state: d.readyState ?? d.state ?? 'UNKNOWN',
      target: d.target ?? null,
      createdAt: d.createdAt ?? d.created ?? null,
      inspectorUrl: d.inspectorUrl ?? null,
      branch,
      commitSha: fullSha ? fullSha.slice(0, 7) : null,
      commitMessage,
      commitAuthor,
      deployer,
      prUrl,
      prId,
    }
  })

  const ghMapped = githubData.workflow_runs.map((r: any) => ({
    uid: `gh-run-${r.id}`,
    state: r.conclusion === 'success' ? 'READY' : 'ERROR',
    target: null,
    createdAt: new Date(r.created_at).getTime(),
    inspectorUrl: r.html_url,
    branch: r.head_branch,
    commitSha: r.head_sha ? r.head_sha.slice(0, 7) : null,
    commitMessage: r.head_commit?.message || r.name,
    commitAuthor: r.head_commit?.author?.name || r.actor?.login || 'github-actions',
    deployer: r.actor?.login || 'github-actions',
    prUrl: null,
    prId: null,
  }))

  const allDeployments = [...mapped, ...ghMapped].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))

  const deployments = (() => {
    if (!collapse) return allDeployments

    // Keep only the latest deployment per branch
    const seen = new Set<string>()
    return allDeployments.filter((d) => {
      const key = d.branch ?? d.uid
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  })()

  return {
    projectName: data.deployments[0]?.name ?? project.name,
    deployments,
  }
})
