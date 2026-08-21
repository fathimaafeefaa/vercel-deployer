import { defineEventHandler, getRouterParam, createError } from 'h3'
import { getProjectById } from '~~/server/utils/projects'
import { GitHubActionsProvider } from '~~/server/utils/deployment'

export default defineEventHandler(async (event) => {
  const project = getProjectById(getRouterParam(event, 'projectId'))
  if (!project) throw createError({ statusCode: 404, message: 'Project not found' })

  const deploymentId = getRouterParam(event, 'deploymentId')
  if (!deploymentId || !/^\d+$/.test(deploymentId)) {
    throw createError({ statusCode: 400, message: 'Invalid deployment/run ID format' })
  }

  if (!project.github) {
    throw createError({
      statusCode: 400,
      message: 'No GitHub configuration found for this project',
    })
  }

  const provider = new GitHubActionsProvider()
  const result = await provider.getStatus(project, deploymentId)

  return {
    deploymentId,
    status: result.status,
    message: result.message,
    url: result.url,
  }
})
