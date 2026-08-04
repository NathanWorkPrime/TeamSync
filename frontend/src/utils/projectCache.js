export const projectCache = {
  // Get cached project list or metadata
  getProjectMeta: (repoName) => {
    try {
      const cached = localStorage.getItem(`teamsync_cached_project_${repoName}`);
      return cached ? JSON.parse(cached) : null;
    } catch (e) {
      return null;
    }
  },

  // Save project metadata
  setProjectMeta: (repoName, meta) => {
    try {
      localStorage.setItem(`teamsync_cached_project_${repoName}`, JSON.stringify({
        ...meta,
        lastOpened: Date.now()
      }));
    } catch (e) {}
  },

  // Generic tab data caching
  getTabData: (repoName, tabId) => {
    try {
      const data = localStorage.getItem(`teamsync_cache_${repoName}_${tabId}`);
      return data ? JSON.parse(data) : null;
    } catch (e) {
      return null;
    }
  },

  setTabData: (repoName, tabId, data) => {
    try {
      localStorage.setItem(`teamsync_cache_${repoName}_${tabId}`, JSON.stringify(data));
    } catch (e) {}
  },

  clearCache: (repoName, tabId = null) => {
    try {
      if (tabId) {
        localStorage.removeItem(`teamsync_cache_${repoName}_${tabId}`);
      } else {
        // Clear all cached tabs for this repo
        const keys = Object.keys(localStorage);
        keys.forEach(key => {
          if (key.startsWith(`teamsync_cache_${repoName}_`)) {
            localStorage.removeItem(key);
          }
        });
      }
    } catch (e) {}
  }
};
