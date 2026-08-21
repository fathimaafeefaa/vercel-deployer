import type { Project } from './projects'

// ── Types ──────────────────────────────────────────────────────

export interface DeployOptions {
  branch: string
  workflowFile?: string
  inputs?: Record<string, string>
}

export interface DeploymentResult {
  url: string
  deploymentId?: string
  status: 'success' | 'failed' | 'pending'
  message?: string
}

export interface DeploymentProvider {
  name: string
  deploy(project: Project, options: DeployOptions): Promise<DeploymentResult>
  getStatus?(project: Project, deploymentId: string): Promise<DeploymentResult>
}

// ── GitHub Actions Provider ────────────────────────────────────

export class GitHubActionsProvider implements DeploymentProvider {
  name = 'GitHub Actions'

  async deploy(project: Project, options: DeployOptions): Promise<DeploymentResult> {
    if (!project.github) {
      return { url: '', status: 'failed', message: 'No GitHub configuration found for this project' }
    }

    const { token, owner, repo } = project.github
    const workflowFile = options.workflowFile || project.github.workflowFile

    if (!workflowFile) {
      return { url: '', status: 'failed', message: 'No workflow file configured. Set github.workflowFile in your project config.' }
    }

    try {
      // Dispatch the workflow via GitHub REST API (workflow_dispatch)
      const response = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowFile}/dispatches`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ref: options.branch,
            inputs: options.inputs || {},
          }),
        }
      )

      // GitHub returns 204 No Content on successful dispatch
      if (response.status === 204) {
        // After dispatching, find the newly created run to get its ID for polling
        const runId = await this.findLatestRunId(token, owner, repo, options.branch)
        return {
          url: `https://github.com/${owner}/${repo}/actions`,
          deploymentId: runId || undefined,
          status: 'pending',
          message: 'Workflow dispatched successfully',
        }
      }

      // Handle errors
      const errorBody = await response.json().catch(() => ({}))
      const errorMessage = (errorBody as any)?.message || response.statusText || 'Unknown error'

      if (response.status === 404) {
        return { url: '', status: 'failed', message: `Workflow "${workflowFile}" not found in ${owner}/${repo}. Make sure the file exists in .github/workflows/` }
      }
      if (response.status === 403) {
        return { url: '', status: 'failed', message: 'Insufficient permissions. Token needs actions:write scope.' }
      }
      if (response.status === 422) {
        return { url: '', status: 'failed', message: `Validation error: ${errorMessage}` }
      }

      return { url: '', status: 'failed', message: `GitHub API error (${response.status}): ${errorMessage}` }
    } catch (err: any) {
      return { url: '', status: 'failed', message: err?.message || 'Failed to dispatch workflow' }
    }
  }

  /**
   * After dispatching a workflow, poll briefly to find the newly created run ID
   * so we can track its status in the UI.
   */
  private async findLatestRunId(token: string, owner: string, repo: string, branch: string): Promise<string | null> {
    // Wait a moment for GitHub to create the run
    await new Promise(resolve => setTimeout(resolve, 2000))

    try {
      const response = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/actions/runs?branch=${encodeURIComponent(branch)}&per_page=1&event=workflow_dispatch`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
        }
      )
      if (response.ok) {
        const data = await response.json() as any
        if (data.workflow_runs?.length > 0) {
          return String(data.workflow_runs[0].id)
        }
      }
    } catch {
      // Non-critical — we just won't have a run ID for polling
    }
    return null
  }

  async getStatus(project: Project, runId: string): Promise<DeploymentResult> {
    if (!project.github) {
      return { url: '', status: 'failed', message: 'No GitHub configuration' }
    }

    const { token, owner, repo } = project.github
    try {
      const response = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
        }
      )

      if (!response.ok) {
        return { url: '', status: 'failed', message: `Failed to get run status: ${response.statusText}` }
      }

      const run = await response.json() as any
      const htmlUrl = run.html_url || `https://github.com/${owner}/${repo}/actions/runs/${runId}`

      if (run.status === 'completed') {
        return {
          url: htmlUrl,
          deploymentId: runId,
          status: run.conclusion === 'success' ? 'success' : 'failed',
          message: run.conclusion === 'success'
            ? 'Workflow completed successfully'
            : `Workflow ${run.conclusion || 'failed'}`,
        }
      }

      return {
        url: htmlUrl,
        deploymentId: runId,
        status: 'pending',
        message: run.status === 'in_progress' ? 'Building…' : `Status: ${run.status}`,
      }
    } catch (err: any) {
      return { url: '', status: 'failed', message: err?.message || 'Failed to check run status' }
    }
  }
}

// ── Free Deploy Provider ───────────────────────────────────────
// Dispatches a GitHub Actions workflow with a special `deploy_target: free` input.
// This delegates the actual deployment to the target repository's workflow, which
// can build and push to any free hosting (Cloudflare Pages, Surge, Netlify, etc.).

export class FreeDeployProvider implements DeploymentProvider {
  name = 'Free Deploy'

  async deploy(project: Project, options: DeployOptions): Promise<DeploymentResult> {
    if (!project.github) {
      return { url: '', status: 'failed', message: 'No GitHub configuration found for this project' }
    }

    const { token, owner, repo } = project.github
    const workflowFile = options.workflowFile || project.github.workflowFile || 'deploy.yml'

    try {
      const response = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowFile}/dispatches`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ref: options.branch,
            inputs: {
              deploy_target: 'free',
              ...(options.inputs || {}),
            },
          }),
        }
      )

      if (response.status === 204) {
        return {
          url: `https://github.com/${owner}/${repo}/actions`,
          status: 'pending',
          message: 'Free deployment workflow dispatched',
        }
      }

      const errorBody = await response.json().catch(() => ({}))
      const errorMessage = (errorBody as any)?.message || response.statusText || 'Unknown error'

      if (response.status === 404) {
        return { url: '', status: 'failed', message: `Workflow "${workflowFile}" not found. Free deploy requires a workflow that accepts deploy_target input.` }
      }

      return { url: '', status: 'failed', message: `GitHub API error (${response.status}): ${errorMessage}` }
    } catch (err: any) {
      return { url: '', status: 'failed', message: err?.message || 'Failed to trigger free deployment' }
    }
  }
}

// ── Vercel Provider (wraps existing force-deploy logic) ────────

export class VercelDeployProvider implements DeploymentProvider {
  name = 'Vercel'

  async deploy(_project: Project, _options: DeployOptions): Promise<DeploymentResult> {
    // The Vercel deployment is handled by the existing force-deploy.post.ts endpoint.
    // This provider exists only for the abstraction layer — actual calls go through
    // the existing /api/projects/{id}/force-deploy route from the frontend.
    return {
      url: '',
      status: 'pending',
      message: 'Use the existing force-deploy endpoint for Vercel deployments',
    }
  }
}

// ── Factory ────────────────────────────────────────────────────

export function getDeploymentProvider(method: string): DeploymentProvider {
  switch (method) {
    case 'github-action':
      return new GitHubActionsProvider()
    case 'free':
      return new FreeDeployProvider()
    case 'vercel':
      return new VercelDeployProvider()
    default:
      throw new Error(`Unknown deployment method: ${method}`)
  }
}
