import { createError } from 'h3'

export interface ProjectVercelConfig {
  token: string
  projectId: string
  teamId?: string
}

export interface ProjectGithubConfig {
  token: string
  owner: string
  repo: string
  workflowFile?: string
}

export interface ProjectJiraConfig {
  org: string
  email: string
  apiToken: string
}

export interface Project {
  id: string
  name: string
  vercel: ProjectVercelConfig
  github: ProjectGithubConfig | null
  jira: ProjectJiraConfig | null
}

// Parsing PROJECTS is cheap and env vars don't change at runtime, so no caching.
export function getProjects(): Project[] {
  const config = useRuntimeConfig()

  if (!config.projects) {
    throw createError({
      statusCode: 500,
      message: 'Server configuration error: PROJECTS is not set. Define at least one project (see .env.example).',
    })
  }

  let parsed: any
  try {
    // Tolerate trailing commas (e.g. from an editor's auto-format) since they're
    // never ambiguous — a comma directly before a closing bracket is always invalid JSON.
    parsed = JSON.parse(config.projects.replace(/,(\s*[}\]])/g, '$1'))
  } catch {
    throw createError({
      statusCode: 500,
      message: 'Server configuration error: PROJECTS is not valid JSON. It must be a single line (or wrapped in "..." if your .env file preserves multi-line quoted values).',
    })
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw createError({
      statusCode: 500,
      message: 'Server configuration error: PROJECTS must be a non-empty JSON array of projects.',
    })
  }

  return parsed.map((p: any, i: number) => {
    if (!p || typeof p !== 'object') {
      throw createError({ statusCode: 500, message: `Server configuration error: PROJECTS[${i}] is not an object` })
    }
    if (!p.id) {
      throw createError({ statusCode: 500, message: `Server configuration error: PROJECTS[${i}] is missing an "id"` })
    }
    if (!p.vercel || !p.vercel.token || !p.vercel.projectId) {
      throw createError({ statusCode: 500, message: `Server configuration error: PROJECTS entry "${p.id}" is missing a "vercel" config with token and projectId` })
    }
    return {
      id: p.id,
      name: p.name ?? p.id,
      vercel: p.vercel,
      github: p.github ?? null,
      jira: p.jira ?? null,
    }
  })
}

export function getProjectById(id: string | undefined | null): Project | undefined {
  if (!id) return undefined
  return getProjects().find(p => p.id === id)
}
