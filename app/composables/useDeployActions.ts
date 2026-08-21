import type { Ref, ComputedRef } from 'vue'
import type { Deployment } from './useDeployments'

export type DeployMethod = 'deploy' | 'githubAction' | 'freeDeploy'
export type DeployStatus = 'idle' | 'loading' | 'success' | 'error'

interface ActionState {
  status: DeployStatus
  message: string
}

export function useDeployActions(
  projectId: Ref<string | null>,
  deployments?: Ref<Deployment[]> | ComputedRef<Deployment[]>,
  refresh?: () => Promise<any>
) {
  const actionStates = ref<Record<string, ActionState>>({
    deploy: { status: 'idle', message: '' },
    githubAction: { status: 'idle', message: '' },
    freeDeploy: { status: 'idle', message: '' },
  })

  const pendingDeployments = ref<Deployment[]>([])
  const ghTimers = new Map<string, ReturnType<typeof setInterval>>()

  const isDeploying = computed(() =>
    Object.values(actionStates.value).some(s => s.status === 'loading') || pendingDeployments.value.length > 0
  )

  function setStatus(method: string, status: DeployStatus, message = '') {
    actionStates.value[method] = { status, message }

    // Auto-clear success/error after 5 seconds
    if (status === 'success' || status === 'error') {
      setTimeout(() => {
        if (actionStates.value[method]?.status === status) {
          actionStates.value[method] = { status: 'idle', message: '' }
        }
      }, 5000)
    }
  }

  async function triggerGithubAction(branch = 'main', workflowFile?: string, inputs?: Record<string, string>, originUid?: string) {
    if (!projectId.value) return

    setStatus('githubAction', 'loading', 'Dispatching workflow…')

    // Find original deployment to clone metadata (if triggered from a row)
    const original = originUid && deployments?.value ? deployments.value.find(d => d.uid === originUid) : null
    const phantomUid = `gh-pending-${originUid || Date.now()}`

    // Insert pending row
    pendingDeployments.value.push({
      uid: phantomUid,
      state: 'QUEUED',
      target: original?.target ?? null,
      createdAt: Date.now(),
      deployer: 'github-actions[bot]',
      inspectorUrl: null,
      commitSha: original?.commitSha ?? null,
      commitMessage: original?.commitMessage ?? `Deploying branch: ${branch}`,
      commitAuthor: original?.commitAuthor ?? 'github-actions[bot]',
      branch,
      _pending: true,
      _originUid: originUid || phantomUid,
    })

    try {
      const result = await $fetch<{
        ok: boolean
        url: string
        deploymentId?: string
        message: string
        status: string
      }>(`/api/projects/${projectId.value}/deploy/github-action`, {
        method: 'POST',
        body: { branch, workflowFile, inputs },
      })

      setStatus('githubAction', 'success', result.message || 'Workflow dispatched successfully')
      
      if (result.deploymentId) {
        startPolling(phantomUid, result.deploymentId)
      } else {
        // Fallback if no deploymentId returned
        setTimeout(() => removePending(phantomUid), 5000)
      }

      return result
    } catch (err: any) {
      removePending(phantomUid)
      const message = err?.data?.message || err?.message || 'Failed to dispatch workflow'
      setStatus('githubAction', 'error', message)
      throw err
    }
  }

  function startPolling(phantomUid: string, deploymentId: string) {
    const timer = setInterval(async () => {
      if (!projectId.value) return
      try {
        const run = await $fetch<{ deploymentId: string, status: string, message: string, url: string }>(`/api/projects/${projectId.value}/deploy/status/${deploymentId}`)
        
        if (run.status === 'success' || run.status === 'failed') {
          stopPolling(phantomUid)
          if (run.status === 'success') {
            removePending(phantomUid)
            if (refresh) await refresh()
          } else {
            updatePending(phantomUid, { state: 'ERROR', inspectorUrl: run.url })
          }
        } else {
          updatePending(phantomUid, {
            state: run.status === 'in_progress' ? 'BUILDING' : 'QUEUED',
            inspectorUrl: run.url
          })
        }
      } catch (e) {
        // Ignore poll errors, retry next tick
      }
    }, 4000)
    ghTimers.set(phantomUid, timer)
  }

  function stopPolling(phantomUid: string) {
    const t = ghTimers.get(phantomUid)
    if (t !== undefined) {
      clearInterval(t)
      ghTimers.delete(phantomUid)
    }
  }

  function updatePending(phantomUid: string, patch: Partial<Deployment>) {
    const idx = pendingDeployments.value.findIndex(d => d.uid === phantomUid)
    if (idx !== -1) {
      pendingDeployments.value[idx] = { ...pendingDeployments.value[idx], ...patch }
    }
  }

  function removePending(phantomUid: string) {
    pendingDeployments.value = pendingDeployments.value.filter(d => d.uid !== phantomUid)
  }

  async function triggerFreeDeploy(branch = 'main', inputs?: Record<string, string>) {
    if (!projectId.value) return

    setStatus('freeDeploy', 'loading', 'Starting free deployment…')

    try {
      const result = await $fetch<{
        ok: boolean
        url: string
        message: string
        status: string
      }>(`/api/projects/${projectId.value}/deploy/free`, {
        method: 'POST',
        body: { branch, inputs },
      })

      setStatus('freeDeploy', 'success', result.message || 'Free deployment triggered')
      return result
    } catch (err: any) {
      const message = err?.data?.message || err?.message || 'Failed to trigger free deployment'
      setStatus('freeDeploy', 'error', message)
      throw err
    }
  }

  async function pollDeployStatus(deploymentId: string) {
    if (!projectId.value) return null

    try {
      return await $fetch<{
        deploymentId: string
        status: string
        message: string
        url: string
      }>(`/api/projects/${projectId.value}/deploy/status/${deploymentId}`)
    } catch (err: any) {
      console.error('Failed to poll deployment status:', err?.message)
      return null
    }
  }

  function resetStates() {
    for (const key of Object.keys(actionStates.value)) {
      actionStates.value[key] = { status: 'idle', message: '' }
    }
    // Also clean up any pending deployments and their timers
    for (const [uid] of ghTimers) {
      stopPolling(uid)
    }
    pendingDeployments.value = []
  }

  // ── Fetch pending runs from GitHub on page load ──────────────
  interface PendingRun {
    runId: string
    name: string
    branch: string
    commitSha: string
    status: string
    conclusion: string | null
    url: string
    createdAt: number
    actor: string | null
    event: string
  }

  async function fetchPendingRuns() {
    if (!projectId.value) return

    try {
      const result = await $fetch<{ runs: PendingRun[] }>(
        `/api/projects/${projectId.value}/deploy/pending-runs`
      )

      if (!result.runs.length) return

      for (const run of result.runs) {
        const phantomUid = `gh-run-${run.runId}`

        // Skip if we already have this run tracked
        if (pendingDeployments.value.some(d => d.uid === phantomUid)) continue

        pendingDeployments.value.push({
          uid: phantomUid,
          state: run.status === 'in_progress' ? 'BUILDING' : 'QUEUED',
          target: null,
          createdAt: run.createdAt,
          deployer: run.actor || 'github-actions[bot]',
          inspectorUrl: run.url,
          commitSha: run.commitSha?.slice(0, 7) || null,
          commitMessage: run.name,
          commitAuthor: run.actor || 'github-actions[bot]',
          branch: run.branch,
          _pending: true,
          _originUid: phantomUid,
          _githubRunUrl: run.url,
        })

        // Start polling this run
        startPolling(phantomUid, run.runId)
      }
    } catch (err: any) {
      console.error('Failed to fetch pending GitHub runs:', err?.message)
    }
  }

  // Fetch pending runs whenever the project changes
  watch(projectId, (id) => {
    if (id) fetchPendingRuns()
  }, { immediate: true })

  onUnmounted(() => {
    for (const [uid] of ghTimers) {
      stopPolling(uid)
    }
  })

  return {
    actionStates,
    isDeploying,
    pendingDeployments,
    triggerGithubAction,
    triggerFreeDeploy,
    pollDeployStatus,
    fetchPendingRuns,
    resetStates,
    setStatus,
  }
}
