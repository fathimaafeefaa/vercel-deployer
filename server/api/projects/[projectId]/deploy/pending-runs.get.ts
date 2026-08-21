import { defineEventHandler, getRouterParam, createError } from "h3"
import { getProjectById } from '~~/server/utils/projects'
import { createGithubApi } from '~~/server/utils/api'

interface GitHubWorkflowRun {
  id: number
  name: string
  head_branch: string
  head_sha: string
  status: string
  conclusion: string | null
  html_url: string
  created_at: string
  updated_at: string
  actor?: { login: string; avatar_url: string }
  triggering_actor?: { login: string }
  event: string
}

interface GitHubRunsResponse {
  total_count: number
  workflow_runs: GitHubWorkflowRun[]
}

export default defineEventHandler(async (event) => {
  const project = getProjectById(getRouterParam(event, 'projectId'))
  if (!project) throw createError({ statusCode: 404, message: 'Project not found' })

  if (!project.github) {
    return { runs: [] }
  }

  const githubApi = createGithubApi(project)

  // Fetch both queued and in_progress runs in parallel
  const [queuedRes, inProgressRes] = await Promise.allSettled([
    githubApi<GitHubRunsResponse>('/actions/runs', { query: { status: 'queued', event: 'workflow_dispatch', per_page: 10 } }),
    githubApi<GitHubRunsResponse>('/actions/runs', { query: { status: 'in_progress', event: 'workflow_dispatch', per_page: 10 } }),
  ])

  const allRuns: GitHubWorkflowRun[] = []

  if (queuedRes.status === 'fulfilled') {
    allRuns.push(...queuedRes.value.workflow_runs)
  }
  if (inProgressRes.status === 'fulfilled') {
    allRuns.push(...inProgressRes.value.workflow_runs)
  }

  // Deduplicate by ID and sort newest first
  const uniqueRuns = [...new Map(allRuns.map(r => [r.id, r])).values()]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  return {
    runs: uniqueRuns.map(r => ({
      runId: String(r.id),
      name: r.name,
      branch: r.head_branch,
      commitSha: r.head_sha,
      status: r.status,
      conclusion: r.conclusion,
      url: r.html_url,
      createdAt: new Date(r.created_at).getTime(),
      actor: r.triggering_actor?.login || r.actor?.login || null,
      event: r.event,
    })),
  }
})
