import { createError } from 'h3'

const VALID_NAME_RE = /^[a-zA-Z0-9_-]+$/
const VALID_BRANCH_RE = /^[a-zA-Z0-9_./-]+$/
const VALID_SHA_RE = /^[a-fA-F0-9]{7,40}$/
const VALID_UID_RE = /^dpl_[a-zA-Z0-9]+$/


export function validateOwnerRepo(owner: any, repo: any) {
  if (owner && (typeof owner !== 'string' || !VALID_NAME_RE.test(owner))) {
    throw createError({ statusCode: 400, message: 'Invalid repository owner format' })
  }
  if (repo && (typeof repo !== 'string' || !VALID_NAME_RE.test(repo))) {
    throw createError({ statusCode: 400, message: 'Invalid repository name format' })
  }
}

export function validateBranch(branch: any) {
  if (!branch || typeof branch !== 'string' || !VALID_BRANCH_RE.test(branch)) {
    throw createError({ statusCode: 400, message: 'Invalid branch name format' })
  }
}

export function validateSha(sha: any) {
  if (sha && (typeof sha !== 'string' || !VALID_SHA_RE.test(sha))) {
    throw createError({ statusCode: 400, message: 'Invalid commit SHA format' })
  }
}

export function validateUid(uid: any) {
  if (!uid || typeof uid !== 'string' || !VALID_UID_RE.test(uid)) {
    throw createError({ statusCode: 400, message: 'Invalid deployment UID format' })
  }
}

const VALID_WORKFLOW_RE = /^[a-zA-Z0-9_.-]+\.ya?ml$/

export function validateWorkflowFile(workflow: any) {
  if (workflow && (typeof workflow !== 'string' || !VALID_WORKFLOW_RE.test(workflow))) {
    throw createError({ statusCode: 400, message: 'Invalid workflow file format. Must be a .yml or .yaml filename.' })
  }
}
