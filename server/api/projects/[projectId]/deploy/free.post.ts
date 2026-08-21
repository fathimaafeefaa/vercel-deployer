import { defineEventHandler, readBody, getRouterParam, createError } from 'h3'
import { getProjectById } from '~~/server/utils/projects'
import { validateBranch } from '~~/server/utils/validation'
import { FreeDeployProvider } from '~~/server/utils/deployment'

export default defineEventHandler(async (event) => {
  const project = getProjectById(getRouterParam(event, 'projectId'))
  if (!project) throw createError({ statusCode: 404, message: 'Project not found' })

  if (!project.github) {
    throw createError({
      statusCode: 400,
      message: `Project "${project.name}" has no GitHub configuration. Free Deploy requires GitHub integration to dispatch deployment workflows.`,
    })
  }

  const body = await readBody<{
    branch?: string
    workflowFile?: string
    inputs?: Record<string, string>
  }>(event)

  const branch = body?.branch || 'main'
  validateBranch(branch)

  const provider = new FreeDeployProvider()
  const result = await provider.deploy(project, {
    branch,
    workflowFile: body?.workflowFile,
    inputs: body?.inputs,
  })

  if (result.status === 'failed') {
    throw createError({
      statusCode: 502,
      message: result.message || 'Failed to trigger free deployment',
    })
  }

  return {
    ok: true,
    url: result.url,
    message: result.message,
    status: result.status,
  }
})
