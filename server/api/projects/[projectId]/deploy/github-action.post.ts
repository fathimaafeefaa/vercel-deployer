import { defineEventHandler, readBody, getRouterParam, createError } from 'h3'
import { getProjectById } from '~~/server/utils/projects'
import { validateBranch, validateWorkflowFile } from '~~/server/utils/validation'
import { GitHubActionsProvider } from '~~/server/utils/deployment'

export default defineEventHandler(async (event) => {
  const project = getProjectById(getRouterParam(event, 'projectId'))
  if (!project) throw createError({ statusCode: 404, message: 'Project not found' })

  if (!project.github) {
    throw createError({
      statusCode: 400,
      message: `Project "${project.name}" has no GitHub configuration. Add a github section to your project config.`,
    })
  }

  const body = await readBody<{
    branch?: string
    workflowFile?: string
    inputs?: Record<string, string>
  }>(event)

  const branch = body?.branch || 'main'
  const workflowFile = body?.workflowFile || project.github.workflowFile

  validateBranch(branch)
  if (workflowFile) validateWorkflowFile(workflowFile)

  const provider = new GitHubActionsProvider()
  const result = await provider.deploy(project, {
    branch,
    workflowFile,
    inputs: body?.inputs,
  })

  if (result.status === 'failed') {
    throw createError({
      statusCode: 502,
      message: result.message || 'Failed to dispatch GitHub Actions workflow',
    })
  }

  return {
    ok: true,
    url: result.url,
    deploymentId: result.deploymentId,
    message: result.message,
    status: result.status,
  }
})
