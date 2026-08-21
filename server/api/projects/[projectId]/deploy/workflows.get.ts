import { defineEventHandler, getRouterParam, createError } from 'h3'
import { getProjectById } from '~~/server/utils/projects'
import { createGithubApi } from '~~/server/utils/api'

interface GitHubWorkflow {
  id: number
  name: string
  path: string
  state: string
  created_at: string
  updated_at: string
}

interface GitHubWorkflowsResponse {
  total_count: number
  workflows: GitHubWorkflow[]
}

export default defineEventHandler(async (event) => {
  const project = getProjectById(getRouterParam(event, 'projectId'))
  if (!project) throw createError({ statusCode: 404, message: 'Project not found' })

  if (!project.github) {
    throw createError({
      statusCode: 400,
      message: `Project "${project.name}" has no GitHub configuration`,
    })
  }

  const githubApi = createGithubApi(project)

  try {
    const data = await githubApi<GitHubWorkflowsResponse>('/actions/workflows')

    return {
      workflows: data.workflows.map(w => ({
        id: w.id,
        name: w.name,
        path: w.path,
        state: w.state,
        filename: w.path.split('/').pop() || w.path,
      })),
    }
  } catch (err: any) {
    // If the repo has no workflows, return empty
    if (err?.statusCode === 404) {
      return { workflows: [] }
    }
    throw err
  }
})
