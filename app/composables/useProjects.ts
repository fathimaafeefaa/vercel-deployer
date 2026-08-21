export interface ProjectSummary {
  id: string
  name: string
  jiraOrg: string | null
  hasGithub: boolean
}

export function useProjects() {
  const route = useRoute()

  const { data: projects, pending, error } = useFetch<ProjectSummary[]>('/api/projects', {
    default: () => [],
  })

  // Stays null until the project list resolves and we can confirm a valid id —
  // this prevents fetching deployments for an unvalidated (possibly bogus) ?project= value.
  const currentProjectId = ref<string | null>(null)

  // Resolve the active project once the list loads: prefer the URL choice, then the
  // last-visited (localStorage) choice, then the first project — but only if still valid.
  watch(projects, (list) => {
    if (!list?.length) return
    if (currentProjectId.value && list.some(p => p.id === currentProjectId.value)) return

    const fromUrl = route.query.project as string | undefined
    const stored = import.meta.client ? localStorage.getItem('currentProjectId') : null
    currentProjectId.value =
      list.find(p => p.id === fromUrl)?.id ??
      list.find(p => p.id === stored)?.id ??
      list[0]!.id
  }, { immediate: true })

  watch(currentProjectId, (id) => {
    if (id && import.meta.client) {
      try { localStorage.setItem('currentProjectId', id) } catch { /* ignore */ }
    }
  })

  const currentProject = computed(() => projects.value?.find(p => p.id === currentProjectId.value) ?? null)
  const currentProjectHasGithub = computed(() => currentProject.value?.hasGithub ?? false)

  function selectProject(id: string) {
    currentProjectId.value = id
  }

  return { projects, pending, error, currentProjectId, currentProject, currentProjectHasGithub, selectProject }
}
