<script setup lang="ts">
const { projects, currentProjectId, currentProject, currentProjectHasGithub, selectProject } = useProjects()

const {
  projectName,
  deployments,
  pending,
  error,
  refresh,
  collapsed,
  inspectingUid,
  cancelling,
  cancelDeployment,
} = useDeployments(currentProjectId)

const {
  pendingDeployments: fdPendingDeployments,
  fdErrors,
  confirmPending,
  deployBranchDialog,
  forceDeploy,
  confirmForceDeploy,
  openDeployBranchDialog,
  handleDeployBranch,
  resetForceDeploy,
} = useForceDeploy(currentProjectId, deployments, refresh)

const allPendingDeployments = computed(() => [...fdPendingDeployments.value, ...(ghPendingDeployments?.value || [])])

const {
  search,
  filterStatus,
  filterAuthor,
  hasFilters,
  clearFilters,
  uniqueStatuses,
  uniqueAuthors,
  filteredDeployments,
} = useDeploymentsFilters(currentProjectId, deployments, allPendingDeployments, collapsed, inspectingUid)

// Switching projects (not the initial resolution) invalidates any deployment-specific view state
watch(currentProjectId, (id, prevId) => {
  if (prevId) {
    inspectingUid.value = null
    resetForceDeploy()
    resetDeployActions()
  }
})

onMounted(() => {
  const onKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (confirmPending.value) confirmPending.value = null
      if (deployBranchDialog.value.open) deployBranchDialog.value.open = false
    }
  }
  window.addEventListener('keydown', onKeydown)
  onUnmounted(() => {
    window.removeEventListener('keydown', onKeydown)
  })
})

const showSettingsModal = ref(false)

const {
  isDeploying,
  pendingDeployments: ghPendingDeployments,
  triggerGithubAction,
  resetStates: resetDeployActions,
} = useDeployActions(currentProjectId, deployments, refresh)

async function handleRunGithubAction(branch?: string, uid?: string) {
  try {
    await triggerGithubAction(branch || 'main', undefined, undefined, uid)
  } catch {
    // Error state is already set inside the composable
  }
}

</script>

<template>
  <div class="max-w-[1400px] mx-auto py-5 px-4 sm:py-8 sm:px-6 text-text-primary min-h-screen">
    <!-- Header -->
    <DashboardHeader
      :project-name="projectName"
      :deployments-count="filteredDeployments.length"
      :has-data="!!deployments.length"
      :projects="projects"
      :current-project-id="currentProjectId"
      @update:current-project-id="selectProject"
      @open-settings="showSettingsModal = true"
    />

    <!-- Filter and Controls bar -->
    <DeploymentFilters
      v-model:search="search"
      v-model:filter-status="filterStatus"
      v-model:filter-author="filterAuthor"
      :unique-statuses="uniqueStatuses"
      :unique-authors="uniqueAuthors"
      :pending="pending"
      :has-filters="hasFilters"
      :has-data="!!deployments.length"
      @refresh="refresh"
      @deploy-branch="openDeployBranchDialog"
      @clear-filters="clearFilters"
    />

    <!-- Loading / Empty states -->
    <DeploymentsTableSkeleton v-if="(pending || !currentProjectId) && !deployments.length" />

    <div v-else-if="error" class="flex flex-col items-center justify-center py-20 text-red-text text-[15px] gap-3">
      <Icon name="lucide:alert-triangle" class="h-6 w-6 text-rose-500" />
      <span>{{ error.message }}</span>
    </div>

    <div v-else-if="!filteredDeployments.length" class="flex flex-col items-center justify-center py-20 text-text-tertiary text-[15px] gap-3">
      <span>No deployments found{{ hasFilters ? ' for the active filters' : '' }}.</span>
    </div>

    <!-- Deployments Table -->
    <DeploymentsTable
      v-else
      :deployments="filteredDeployments"
      :pending-deployments="allPendingDeployments"
      :cancelling="cancelling"
      :fd-errors="fdErrors"
      :jira-org="currentProject?.jiraOrg ?? null"
      :has-github="currentProjectHasGithub"
      v-model:collapsed="collapsed"
      @inspect="uid => inspectingUid = uid"
      @cancel="(e, uid) => cancelDeployment(uid)"
      @force-deploy="(e, uid, branch) => forceDeploy(e, uid, branch)"
      @run-github-action="(e, uid, branch) => handleRunGithubAction(branch, uid)"
    />

    <!-- Modals -->
    <DeployBranchDialog
      v-model="deployBranchDialog.open"
      :initial-branch="deployBranchDialog.selectedBranch"
      @deploy="handleDeployBranch"
    />

    <ConfirmForceDeployDialog
      :model-value="!!confirmPending"
      :branch="confirmPending?.branch ?? ''"
      @update:model-value="val => { if (!val) confirmPending = null }"
      @confirm="confirmForceDeploy"
    />

     <DeploymentDetailDrawer
      :uid="inspectingUid"
      :project-id="currentProjectId"
      @close="inspectingUid = null"
    />

    <SettingsDialog v-model="showSettingsModal" />
  </div>
</template>


