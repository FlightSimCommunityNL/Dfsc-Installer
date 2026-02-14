export const en = {
  // Categories
  'category.liveries': 'Liveries',
  'category.aircraft': 'Aircraft',
  'category.tools': 'Tools',
  'category.scenery': 'Scenery',

  // Common
  'common.close': 'Close',
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.searchPlaceholder': 'Search...',
  'common.category': 'Category',
  'common.noResults': 'No addons found.',
  'common.notSet': 'Not set',
  'common.noAddonSelected': 'No addon selected.',
  'common.selectAddonToStart': 'Select an addon to get started.',

  // Selection footer
  'links.discord': 'Discord',

  // Content
  'content.chooseVersion': 'Choose Your Version',
  'content.description': 'Description',
  'channel.stable': 'Stable',
  'channel.beta': 'Beta',
  'channel.dev': 'Development',

  // Actions
  'actions.title': 'Actions',
  'actions.configure': 'Configure',
  'actions.releaseNotes': 'Release Notes',
  'actions.about': 'About',

  // About (addon)
  'about.title': 'About',
  'about.description': 'DutchFlightSimCommunity Installer helps you install and manage MSFS Community addons from a central source.',
  'about.techSpecs': 'Tech Specs',
  'about.aircraftType': 'Aircraft type',
  'about.engineType': 'Engine type',
  'about.wingType': 'Wing type',

  // App updates
  'updates.title': 'App Updates',
  'updates.check': 'Check for updates',
  'updates.download': 'Download update',
  'updates.restart': 'Restart to install',
  'updates.status.checking': 'Checking for updates…',
  'updates.status.available': 'Update available',
  'updates.status.notAvailable': 'No updates available',
  'updates.status.downloaded': 'Update downloaded',
  'updates.status.error': 'Update error',

  // Release notes (in-app)
  'releaseNotes.title': 'Release notes',
  'releaseNotes.noneAvailable': 'No release notes available.',
  'releaseNotes.loading': 'Loading release notes…',
  'releaseNotes.loadFailed': 'Failed to load release notes.',
  'releaseNotes.retry': 'Retry',
  'releaseNotes.close': 'Close',

  // Install section
  'install.title': 'Install',
  'install.install': 'Install',
  'install.update': 'Update',
  'install.installed': 'Installed',
  'install.uninstall': 'Uninstall',
  'install.updateAvailableHint': 'Update available for the selected channel.',
  'install.setCommunityHint': 'Set your Community folder in Settings.',
  'install.setInstallPathHint': 'Set your Install path in Settings.',
  'install.rawInstallHint': 'This addon ZIP does not look like an MSFS package. For testing, enable allowRawInstall in the manifest for this addon.',

  // Offline
  'offline.usingCached': 'Offline mode: using cached data',

  // Install confirmation
  'installConfirm.title': 'Ready to Install',
  'installConfirm.subtitleInstall': 'Review disk space before installing.',
  'installConfirm.subtitleUpdate': 'Review disk space before updating.',
  'installConfirm.installTo': 'Install to:',
  'installConfirm.freeSpace': 'Free space:',
  'installConfirm.downloadSize': 'Download size:',
  'installConfirm.required': 'Required:',
  'installConfirm.afterInstall': 'After install:',
  'installConfirm.loading': 'Checking…',
  'installConfirm.unknown': 'Unknown',
  'installConfirm.downloadUnknownWarn': 'Download size unknown — space will be checked again before final install.',
  'installConfirm.downloadProbeError': 'Could not determine download size',
  'installConfirm.diskError': 'Disk space check failed',
  'installConfirm.notEnough': 'Not enough disk space',
  'installConfirm.negative': 'insufficient',
  'installConfirm.confirmInstall': 'Confirm Install',
  'installConfirm.confirmUpdate': 'Confirm Update',

  // Community path required
  'communityRequired.title': 'Community Folder Required',
  'communityRequired.body': 'Set your MSFS Community folder in Settings before installing addons.',
  'communityRequired.openSettings': 'Open Settings',

  // Settings
  'settings.title': 'Settings',
  'settings.subtitle': 'Community folder + preferences',
  'settings.communityFolder': 'MSFS Community folder',
  'settings.installPath': 'Install path',
  'settings.useCommunityFolder': 'Use Community Folder',
  'settings.installPath.found': 'Found:',
  'settings.installPath.notFound': 'Not found',
  'settings.autoDetect': 'Auto-detect',
  'settings.autoDetect.found': 'Found:',
  'settings.autoDetect.notFound': 'Not found',
  'settings.browse': 'Browse…',
  'settings.language': 'Language',
  'settings.language.system': 'System (Auto)',
  'settings.language.en': 'English',
  'settings.language.nl': 'Nederlands',

  // Settings: app updates
  'settings.updates.title': 'App Updates',
  'settings.updates.check': 'Check for updates',
  'settings.updates.checking': 'Checking…',
  'settings.updates.install': 'Install update',
  'settings.updates.downloading': 'Downloading…',
  'settings.updates.uptodate': "You're up to date.",
  'settings.updates.available': 'Update available:',
  'settings.updates.ready': 'Downloaded. Ready to install.',
  'settings.updates.error': 'Update check failed',
  'settings.updates.helper': 'Checks whether a newer version is available.',

  // Settings: about
  'settings.aboutTitle': 'About',
  'settings.installedVersion': 'Installed Version',
  'settings.channel.dev': 'Dev',
  'settings.channel.release': 'Release',
} as const

export type EnDict = typeof en
