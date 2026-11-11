(function () {
  'use strict';

  var client = null;
  var portalRoot = null;
  var activeProfile = null;
  var progressChannel = null;
  var progressRefreshTimer = null;
  var currentPortalSection = 'Dashboard';
  var currentPortalPage = 'dashboard';
  var pendingProjectOpen = '';
  var pendingProjectSection = '';
  var pendingProjectStep = '';
  var pendingTeamMessageOpen = '';
  var selectedTeamConversation = 'group';
  var calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  var portalTheme = 'dark';
  var projectCache = [];
  var relatedData = {};
  var notificationState = { read: [], archived: [], showEarlier: false, showAll: false };
  var notificationStorageKey = '';
  var navigationStorageKey = '';
  var dashboardStorageKey = '';
  var navigationGroupState = {};
  var dashboardPreferences = { order: [], hidden: [] };
  var categories = [
    ['web', 'Web development'],
    ['it_support', 'IT support'],
    ['security', 'Security setup']
  ];
  var statuses = [
    ['received', 'Request Received'],
    ['scoping', 'Scoping'],
    ['awaiting_approval', 'Awaiting Approval'],
    ['awaiting_payment', 'Awaiting Payment'],
    ['awaiting_customer', 'Awaiting Client Feedback'],
    ['in_progress', 'In Progress'],
    ['review', 'Under Review'],
    ['handover', 'Handover'],
    ['complete', 'Completed'],
    ['paused', 'On Hold']
  ];
  var stepStatuses = [
    ['not_started', 'Not Started'],
    ['in_progress', 'In Progress'],
    ['in_review', 'Under Review'],
    ['done', 'Completed']
  ];

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
    });
  }

  function renderAttentionPanel() {
    var actions = [];
    function addAction(projectId, label, section) {
      if (actions.length >= 5 || !projectId) return;
      actions.push({ target: 'clientDeskProject-' + projectId, label: label, section: section || '' });
    }
    if (activeProfile.role === 'owner') {
      projectCache.filter(function (project) { return ['received', 'awaiting_approval'].indexOf(project.status) !== -1; })
        .slice(0, 5).forEach(function (project) { addAction(project.id, 'Review request: ' + project.title, 'management'); });
      (relatedData.steps || []).filter(function (step) { return step.status === 'in_review'; }).forEach(function (step) {
        var project = projectCache.find(function (item) { return item.id === step.project_id; });
        if (project) addAction(project.id, 'Review deliverable: ' + step.title, 'deliverables');
      });
    } else if (activeProfile.role === 'freelancer') {
      (relatedData.steps || []).filter(function (step) {
        return step.owner_id === activeProfile.id && step.status !== 'done';
      }).forEach(function (step) {
        var project = projectCache.find(function (item) { return item.id === step.project_id; });
        if (project) addAction(project.id, 'Update task: ' + step.title, 'deliverables');
      });
    } else {
      (relatedData.steps || []).filter(function (step) { return step.status === 'in_review'; }).forEach(function (step) {
        var project = projectCache.find(function (item) { return item.id === step.project_id; });
        if (project) addAction(project.id, 'Review deliverable: ' + step.title, 'deliverables');
      });
      (relatedData.checklist || []).filter(function (item) { return item.owner_kind === 'customer' && !item.completed_at; })
        .forEach(function (item) {
          var project = projectCache.find(function (project) { return project.id === item.project_id; });
          if (project) addAction(project.id, 'Complete checklist: ' + item.title);
        });
      (relatedData.quotes || []).filter(function (quote) { return quote.status === 'sent'; }).forEach(function (quote) {
        var project = projectCache.find(function (item) { return item.id === quote.project_id; });
        if (project) addAction(project.id, 'Review project quote', 'billing');
      });
    }
    var actionList = actions.length
      ? '<ul>' + actions.map(function (action) {
        var projectId = action.target.replace('clientDeskProject-', '');
        var targetPage = activeProfile.role === 'freelancer' ? 'tasks' : 'projects';
        return '<li><span>' + escapeHtml(action.label) + '</span><a href="#portal-' + targetPage + '" data-portal-page="' + targetPage + '" data-open-project="' + escapeHtml(projectId) + '" data-open-section="deliverables">View tracker</a></li>';
      }).join('') + '</ul>'
      : '<p class="client-desk-footnote">You’re all caught up. There are no actions requiring attention.</p>';
    return '<section class="client-desk-attention" aria-labelledby="attention-heading"><div class="client-desk-attention-heading"><span class="client-desk-attention-icon" aria-hidden="true">!</span><h2 id="attention-heading">Requires Your Attention</h2></div>' + actionList + '</section>';
  }

  function renderSummaryStrip() {
    var active = projectCache.filter(function (project) { return ['complete', 'paused'].indexOf(project.status) === -1; }).length;
    var approvals = (relatedData.steps || []).filter(function (step) { return step.status === 'in_review'; }).length;
    var invoices = (relatedData.invoices || []).filter(function (invoice) { return ['sent', 'overdue'].indexOf(invoice.status) !== -1; }).length;
    var tasks = (relatedData.steps || []).filter(function (step) { return step.owner_id === activeProfile.id && step.status !== 'done'; }).length;
    var thirdLabel = activeProfile.role === 'freelancer' ? 'My Active Tasks' : 'Open Invoices';
    var thirdCount = activeProfile.role === 'freelancer' ? tasks : invoices;
    var projectPage = activeProfile.role === 'freelancer' ? 'tasks' : 'projects';
    var lastPage = activeProfile.role === 'freelancer' ? 'tasks' : activeProfile.role === 'owner' ? 'finance' : 'billing';
    return '<div class="client-desk-summary-strip" aria-label="Workspace summary"><a href="#portal-' + projectPage + '" data-portal-page="' + projectPage + '"><span>Active Projects</span><strong>' + active + '</strong></a><a href="#portal-' + projectPage + '" data-portal-page="' + projectPage + '"><span>Pending Approvals</span><strong>' + approvals + '</strong></a><a href="#portal-' + lastPage + '" data-portal-page="' + lastPage + '"><span>' + thirdLabel + '</span><strong>' + thirdCount + '</strong></a></div>';
  }

  function money(amount, currency) {
    return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: currency || 'ZAR', maximumFractionDigits: 2 }).format((amount || 0) / 100);
  }

  function dateLabel(value) {
    if (!value) return 'Not scheduled';
    var date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Not scheduled' : new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium' }).format(date);
  }

  function setStatus(message, isError, target) {
    var status = target && target.querySelector('[data-portal-status]') || portalRoot && portalRoot.querySelector('[data-portal-status]');
    if (!status) return;
    status.textContent = message || '';
    status.setAttribute('role', isError ? 'alert' : 'status');
    status.classList.toggle('is-error', Boolean(isError));
  }

  function portalIcon(name) {
    var icons = {
      home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
      projects: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 4V2m8 2V2M3 9h18"/>',
      messages: '<path d="M21 11.5a8.5 8.5 0 0 1-12.4 7.6L3 21l1.9-5.6A8.5 8.5 0 1 1 21 11.5Z"/><path d="M8 11h8m-8 4h5"/>',
      files: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8m-8 4h8"/>',
      billing: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18m-14 5h4"/>',
      support: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9a2.5 2.5 0 1 1 4.5 1.5c-1.2 1.2-2.1 1.5-2.1 3m0 3h.01"/>',
      tasks: '<path d="m4 7 2 2 4-4M4 17l2 2 4-4"/><path d="M12 7h8m-8 10h8"/>',
      team: '<path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2m6-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm8-7a4 4 0 0 1 0 8m4 9v-2a4 4 0 0 0-3-3.9"/>',
      calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18m-13 4h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>',
      finance: '<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-4 4"/>',
      settings: '<circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.7a8 8 0 0 1-1.7 1l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.7-1l-1.7.7-1.4-2.4 1.4-1.1a7 7 0 0 1 0-2l-1.4-1.1 1.4-2.4 1.7.7a8 8 0 0 1 1.7-1l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.7 1l1.7-.7 1.4 2.4-1.4 1.1a7 7 0 0 1 0 2Z"/>',
      lock: '<rect x="4" y="10" width="16" height="11" rx="1"/><path d="M8 10V7a4 4 0 1 1 8 0v3m-4 4v3"/>',
      search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
      bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12a2 2 0 0 0 4 0"/>',
      help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4.5 1.5c-1.2 1.2-2 1.5-2 3m0 3h.01"/>',
      sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/>',
      moon: '<path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z"/>',
      more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'
    };
    return '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (icons[name] || icons.home) + '</svg>';
  }

  function portalNavigation(profile) {
    if (!profile || profile.role === 'deleted') return [];
    if (profile.role === 'owner') return [
      { group: 'Overview', label: 'Dashboard', icon: 'home', page: 'dashboard', mobilePrimary: true },
      { group: 'Work', label: 'Projects', icon: 'projects', page: 'projects', mobilePrimary: true },
      { group: 'Work', label: 'Clients', icon: 'team', page: 'clients' },
      { group: 'Team', label: 'Team Management', icon: 'team', page: 'team' },
      { group: 'Team', label: 'Team Communication', icon: 'messages', page: 'communication', mobilePrimary: true },
      { group: 'Team', label: 'Calendar', icon: 'calendar', page: 'calendar' },
      { group: 'Insights', label: 'Analytics & Reports', icon: 'finance', page: 'analytics' },
      { group: 'Finance', label: 'Finance', icon: 'finance', page: 'finance' },
      { group: 'Admin', label: 'Settings', icon: 'settings', page: 'settings' }
    ];
    if (profile.role === 'freelancer') return [
      { group: 'Overview', label: 'Dashboard', icon: 'home', page: 'dashboard', mobilePrimary: true },
      { group: 'Work', label: 'My Tasks', icon: 'tasks', page: 'tasks', mobilePrimary: true },
      { group: 'Work', label: 'Performance', icon: 'finance', page: 'performance' },
      { group: 'Work', label: 'Documents', icon: 'files', page: 'documents' },
      { group: 'Team', label: 'Team Communication', icon: 'messages', page: 'communication', mobilePrimary: true },
      { group: 'Team', label: 'Calendar', icon: 'calendar', page: 'calendar', mobilePrimary: true },
      { group: 'Account', label: 'Profile', icon: 'team', page: 'profile' }
    ];
    return [
      { group: 'Overview', label: 'Dashboard', icon: 'home', page: 'dashboard', mobilePrimary: true },
      { group: 'Work', label: 'Projects', icon: 'projects', page: 'projects', mobilePrimary: true },
      { group: 'Work', label: 'Documents', icon: 'files', page: 'documents' },
      { group: 'Communication', label: 'Messages', icon: 'messages', page: 'messages', mobilePrimary: true },
      { group: 'Billing', label: 'Invoices & Payments', icon: 'billing', page: 'billing', mobilePrimary: true },
      { group: 'Help', label: 'Support', icon: 'support', href: '#/contact' }
    ];
  }

  function renderPortalNavItem(item) {
    var primaryClass = item.mobilePrimary ? ' is-mobile-primary' : '';
    if (item.disabled) return '<span class="client-desk-nav-link is-disabled' + primaryClass + '" aria-label="' + escapeHtml(item.label + ', available in a future update') + '" aria-disabled="true" title="Available in a future update">' + portalIcon(item.icon) + '<span>' + escapeHtml(item.label) + '<small>Available in a future update</small></span></span>';
    var attributes = item.href ? 'href="' + item.href + '"' : item.page
      ? 'href="#portal-' + escapeHtml(item.page) + '" data-portal-page="' + escapeHtml(item.page) + '"'
      : 'href="#' + escapeHtml(item.target) + '" data-portal-nav data-target="' + escapeHtml(item.target) + '"';
    var current = item.page === currentPortalPage ? ' aria-current="page"' : '';
    return '<a class="client-desk-nav-link' + primaryClass + '" aria-label="' + escapeHtml(item.label) + '" title="' + escapeHtml(item.label) + '" ' + attributes + current + '>' + portalIcon(item.icon) + '<span>' + escapeHtml(item.label) + '</span></a>';
  }

  function renderNavigationGroups(navigation) {
    var groups = [];
    navigation.forEach(function (item) {
      var group = groups.find(function (entry) { return entry.label === item.group; });
      if (!group) {
        group = { label: item.group, items: [] };
        groups.push(group);
      }

      group.items.push(item);
    });
    return groups.map(function (group) {
      var open = navigationGroupState[group.label] !== false;
      return '<details class="client-desk-nav-group" data-nav-group="' + escapeHtml(group.label) + '"' + (open ? ' open' : '') + '><summary>' + escapeHtml(group.label) + '</summary><div>' + group.items.map(renderPortalNavItem).join('') + '</div></details>';
    }).join('');
  }

  function renderTeamCommunication() {
    if (activeProfile.role !== 'owner' && activeProfile.role !== 'freelancer') return '';
    var directory = relatedData.teamDirectory || [];
    var conversation = selectedTeamConversation;
    if (conversation !== 'group' && !directory.some(function (person) { return person.id === conversation; })) conversation = 'group';
    var person = directory.find(function (entry) { return entry.id === conversation; });
    var messages = (relatedData.teamMessages || []).filter(function (message) {
      if (conversation === 'group') return !message.recipient_id;
      return (message.author_id === activeProfile.id && message.recipient_id === conversation)
        || (message.author_id === conversation && message.recipient_id === activeProfile.id);
    });
    var chatItems = messages.length
      ? messages.map(function (message) {
        var own = message.author_id === activeProfile.id;
        var initialsText = String(message.author_display_name || 'TM').trim().split(/\s+/).slice(0, 2).map(function (part) { return part.charAt(0).toUpperCase(); }).join('');
        var attachments = (relatedData.teamAttachments || []).filter(function (attachment) { return attachment.message_id === message.id; });
        var attachmentMarkup = attachments.map(function (attachment) {
          return '<a class="client-desk-chat-attachment" href="' + escapeHtml(attachment.signed_url || '#') + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(attachment.file_name) + '</a><small class="client-desk-attachment-expiry">Available until ' + escapeHtml(dateLabel(attachment.expires_at)) + '</small>';
        }).join('');
        return '<li class="client-desk-chat-message' + (own ? ' is-own' : '') + '" id="teamMessage-' + escapeHtml(message.id) + '"><span class="client-desk-chat-avatar" aria-hidden="true">' + escapeHtml(initialsText || 'TM') + '</span><div class="client-desk-chat-bubble"><div class="client-desk-chat-meta"><strong>' + escapeHtml(own ? 'You' : message.author_display_name || 'Team member') + '</strong><time datetime="' + escapeHtml(message.created_at) + '">' + escapeHtml(new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(message.created_at))) + '</time></div><p>' + escapeHtml(message.body) + '</p>' + (attachmentMarkup ? '<div class="client-desk-chat-attachments">' + attachmentMarkup + '</div>' : '') + '</div></li>';
      }).join('')
      : '<li class="client-desk-chat-empty">No messages here yet. Start the conversation with a clear update or question.</li>';
    var conversations = '<button type="button" class="client-desk-conversation' + (conversation === 'group' ? ' is-selected' : '') + '" data-action="select-conversation" data-conversation="group"><span class="client-desk-chat-avatar" aria-hidden="true">Team</span><span><strong>Everyone</strong><small>Group conversation</small></span></button>' +
      directory.map(function (entry) {
        var selected = entry.id === conversation;
        return '<button type="button" class="client-desk-conversation' + (selected ? ' is-selected' : '') + '" data-action="select-conversation" data-conversation="' + escapeHtml(entry.id) + '"><span class="client-desk-chat-avatar" aria-hidden="true">' + escapeHtml(initials({ display_name: entry.display_name })) + '</span><span><strong>' + escapeHtml(entry.display_name) + '</strong><small>Private conversation</small></span></button>';
      }).join('');
    var mentionPicker = conversation === 'group' && directory.length
      ? '<div class="client-desk-mention-picker"><label class="client-desk-label" for="teamMentionSelect">Tag a teammate</label><div><select id="teamMentionSelect" data-mention-select><option value="">Select a teammate</option>' + directory.map(function (entry) {
        return '<option value="' + escapeHtml(entry.id) + '">' + escapeHtml(entry.display_name) + '</option>';
      }).join('') + '</select><button class="btn ghost" type="button" data-action="insert-mention">Insert @ mention</button></div><div class="client-desk-mention-tags" data-mention-tags></div></div>'
      : '';
    return '<section class="client-desk-team-communication" id="clientDeskTeamCommunication" data-portal-section="teamCommunication"><div class="client-desk-chat-layout"><aside class="client-desk-chat-sidebar"><h2>Conversations</h2>' + conversations + '</aside><div class="client-desk-chat-main"><header><div class="client-desk-chat-avatar" aria-hidden="true">' + (person ? escapeHtml(initials({ display_name: person.display_name })) : 'Team') + '</div><div><h2>' + escapeHtml(person ? person.display_name : 'Everyone') + '</h2><p>' + (person ? 'Private staff conversation' : 'Group conversation for the whole staff team') + '</p></div></header><ol class="client-desk-team-message-list" aria-live="polite">' + chatItems + '</ol><form class="client-desk-message-form client-desk-chat-compose" data-action="team-message" data-recipient="' + (person ? escapeHtml(person.id) : '') + '"><label class="client-desk-label" for="teamMessage">Message ' + escapeHtml(person ? person.display_name : 'the team') + '</label><textarea id="teamMessage" name="body" maxlength="4000" required placeholder="Write a message..." rows="2"></textarea>' + mentionPicker + '<label class="client-desk-label" for="teamAttachment">Attachment (optional; removed after 30 days)</label><input id="teamAttachment" name="attachment" type="file" accept="image/jpeg,image/png,image/webp,application/pdf"><button class="btn" type="submit">Send Message</button><p class="client-desk-footnote">Only teammates you tag in a group message receive a notification. Attachments are available for 30 days.</p><p class="client-desk-form-status" data-portal-status aria-live="polite"></p></form></div></div></section>';
  }

  function portalPageTitle(page) {
    var labels = {
      dashboard: 'Dashboard',
      projects: activeProfile.role === 'freelancer' ? 'My Tasks' : 'Projects',
      tasks: 'My Tasks',
      clients: 'Clients',
      team: 'Team Management',
      communication: 'Team Communication',
      calendar: 'Calendar',
      finance: 'Finance',
      analytics: 'Analytics & Reports',
      performance: 'Performance',
      settings: 'Settings',
      documents: 'Documents',
      messages: 'Messages',
      billing: 'Invoices & Payments',
      profile: 'Profile'
    };
    return labels[page] || 'Dashboard';
  }

  function portalPageAllowed(page, role) {
    var allowed = {
      owner: ['dashboard', 'projects', 'clients', 'team', 'communication', 'calendar', 'analytics', 'finance', 'settings'],
      freelancer: ['dashboard', 'tasks', 'performance', 'documents', 'communication', 'calendar', 'profile'],
      customer: ['dashboard', 'projects', 'documents', 'messages', 'billing', 'profile']
    };
    return Boolean(allowed[role] && allowed[role].indexOf(page) !== -1);
  }

  function renderCalendar() {
    var firstDay = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
    var gridStart = new Date(firstDay);
    gridStart.setDate(firstDay.getDate() - firstDay.getDay());
    var lastDay = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0);
    var gridEnd = new Date(lastDay);
    gridEnd.setDate(lastDay.getDate() + (6 - lastDay.getDay()));
    var taskSteps = (relatedData.steps || []).filter(function (step) {
      if (!step.due_at || step.status === 'done') return false;
      return activeProfile.role === 'owner' || step.owner_id === activeProfile.id;
    });
    var days = [];
    for (var day = new Date(gridStart); day <= gridEnd; day.setDate(day.getDate() + 1)) {
      var date = new Date(day);
      var key = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
      var due = taskSteps.filter(function (step) { return String(step.due_at).slice(0, 10) === key; });
      var cells = due.slice(0, 3).map(function (step) {
        var projectPage = activeProfile.role === 'freelancer' ? 'tasks' : 'projects';
        return '<a href="#portal-' + projectPage + '" data-portal-page="' + projectPage + '" data-open-project="' + escapeHtml(step.project_id) + '" data-open-section="deliverables" data-open-step="' + escapeHtml(step.id) + '" title="' + escapeHtml(step.title) + '">' + escapeHtml(step.title) + '</a>';
      }).join('');
      if (due.length > 3) cells += '<small>+' + (due.length - 3) + ' more</small>';
      days.push('<div class="client-desk-calendar-day' + (date.getMonth() === calendarMonth.getMonth() ? '' : ' is-outside') + (key === new Date().toISOString().slice(0, 10) ? ' is-today' : '') + '"><strong>' + date.getDate() + '</strong>' + cells + '</div>');
    }
    return '<section class="client-desk-calendar"><div class="client-desk-calendar-heading"><button class="btn ghost" type="button" data-action="calendar-prev" aria-label="Previous month">‹</button><h2>' + escapeHtml(new Intl.DateTimeFormat('en-ZA', { month: 'long', year: 'numeric' }).format(calendarMonth)) + '</h2><button class="btn ghost" type="button" data-action="calendar-next" aria-label="Next month">›</button></div><div class="client-desk-calendar-grid" role="grid">' + ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(function (name) { return '<div class="client-desk-calendar-weekday" role="columnheader">' + name + '</div>'; }).join('') + days.join('') + '</div><p class="client-desk-footnote">' + (activeProfile.role === 'owner' ? 'Scheduled project steps across the team.' : 'Your assigned steps with due dates.') + ' Select a task to open its project.</p></section>';
  }

  function renderMobileNavigation(navigation) {
    var primary = navigation.filter(function (item) { return item.mobilePrimary; });
    var secondary = navigation.filter(function (item) { return !item.mobilePrimary; });
    return '<nav class="client-desk-mobile-nav" aria-label="Main portal navigation">' + primary.map(renderPortalNavItem).join('') +
      (secondary.length ? '<details class="client-desk-mobile-more"><summary class="client-desk-nav-link">' + portalIcon('more') + '<span>More</span></summary><div class="client-desk-mobile-more-sheet"><button type="button" data-action="close-mobile-more">Close</button>' + renderNavigationGroups(secondary) + '</div></details>' : '') + '</nav>';
  }

  function initials(profile) {
    var words = String(profile && (profile.display_name || profile.email) || 'FC').trim().split(/[\s@._-]+/).filter(Boolean);
    return words.slice(0, 2).map(function (word) { return word.charAt(0).toUpperCase(); }).join('') || 'FC';
  }

  function notificationEvents() {
    var events = (relatedData.events || []).slice();
    (relatedData.teamMentions || []).forEach(function (mention) {
      events.push({
        id: mention.id,
        event_kind: 'team_mention',
        message_id: mention.message_id,
        title: 'Mentioned by ' + mention.author_display_name,
        description: mention.message_preview,
        created_at: mention.created_at,
        read_at: mention.read_at
      });
    });
    return events.sort(function (left, right) {
      return new Date(right.created_at) - new Date(left.created_at);
    });
  }

  function notificationId(event) {
    return event.id || [event.project_id, event.created_at, event.title].join('|');
  }

  function notificationIsRead(event) {
    return Boolean(event.read_at) || notificationState.read.indexOf(notificationId(event)) !== -1;
  }

  async function markTeamMentionsRead(events) {
    var ids = events.filter(function (event) {
      return event.event_kind === 'team_mention' && !event.read_at;
    }).map(function (event) { return event.id; });
    if (!ids.length) return;
    var readAt = new Date().toISOString();
    var result = await client.from('team_message_mentions').update({ read_at: readAt }).in('id', ids);
    if (result.error) throw result.error;
    (relatedData.teamMentions || []).forEach(function (mention) {
      if (ids.indexOf(mention.id) !== -1) mention.read_at = readAt;
    });
  }

  function saveNotificationState() {
    if (notificationStorageKey) localStorage.setItem(notificationStorageKey, JSON.stringify(notificationState));
  }

  function loadPortalPreferences(profileId) {
    notificationStorageKey = 'fixerctrl.portal.notifications.' + profileId;
    navigationStorageKey = 'fixerctrl.portal.navigation.' + profileId;
    dashboardStorageKey = 'fixerctrl.portal.dashboard.' + profileId;
    var savedNotifications = localStorage.getItem(notificationStorageKey);
    if (savedNotifications) {
      try {
        var parsedNotifications = JSON.parse(savedNotifications);
        notificationState = {
          read: Array.isArray(parsedNotifications.read) ? parsedNotifications.read : [],
          archived: Array.isArray(parsedNotifications.archived) ? parsedNotifications.archived : [],
          showEarlier: false,
          showAll: false
        };
      } catch (_error) {
        notificationState = { read: [], archived: [], showEarlier: false, showAll: false };
      }
    } else notificationState = { read: [], archived: [], showEarlier: false, showAll: false };
    var savedNavigation = localStorage.getItem(navigationStorageKey);
    if (savedNavigation) {
      try {
        var parsedNavigation = JSON.parse(savedNavigation);
        navigationGroupState = parsedNavigation && typeof parsedNavigation === 'object' && !Array.isArray(parsedNavigation) ? parsedNavigation : {};
      } catch (_error) {
        navigationGroupState = {};
      }
    } else navigationGroupState = {};
    var savedDashboard = localStorage.getItem(dashboardStorageKey);
    if (savedDashboard) {
      try {
        var parsedDashboard = JSON.parse(savedDashboard);
        dashboardPreferences = {
          order: Array.isArray(parsedDashboard.order) ? parsedDashboard.order : [],
          hidden: Array.isArray(parsedDashboard.hidden) ? parsedDashboard.hidden : []
        };
      } catch (_error) {
        dashboardPreferences = { order: [], hidden: [] };
      }
    } else dashboardPreferences = { order: [], hidden: [] };
  }

  function dashboardWidgetDefinitions() {
    if (activeProfile.role === 'owner') return [
      ['invoice-overview', 'Invoice Overview'],
      ['team-workload', 'Team Workload']
    ];
    if (activeProfile.role === 'freelancer') return [
      ['today-tasks', 'Today’s Tasks'],
      ['deadlines-week', 'Deadlines This Week'],
      ['earnings-period', 'Earnings This Period']
    ];
    return [
      ['project-progress', 'Project Progress'],
      ['upcoming-approvals', 'Upcoming Approvals'],
      ['latest-update', 'Latest Update']
    ];
  }

  function saveDashboardPreferences() {
    if (dashboardStorageKey) localStorage.setItem(dashboardStorageKey, JSON.stringify(dashboardPreferences));
  }

  function renderDashboardCustomization() {
    var widgetMap = dashboardWidgetDefinitions();
    var defaults = widgetMap.map(function (widget) { return widget[0]; });
    var order = dashboardPreferences.order.filter(function (key) { return defaults.indexOf(key) !== -1; });
    defaults.forEach(function (key) { if (order.indexOf(key) === -1) order.push(key); });
    var widgets = order.map(function (key) { return widgetMap.find(function (widget) { return widget[0] === key; }); });
    return '<details class="client-desk-dashboard-customize"><summary>Customize Dashboard</summary><p>Choose which widgets to show and adjust their order.</p><div class="client-desk-dashboard-widget-settings">' + widgets.map(function (widget, index) {
      var hidden = dashboardPreferences.hidden.indexOf(widget[0]) !== -1;
      return '<div><label><input type="checkbox" data-action="dashboard-widget-toggle" data-widget="' + widget[0] + '"' + (hidden ? '' : ' checked') + '> ' + widget[1] + '</label><span><button type="button" data-action="dashboard-widget-move" data-widget="' + widget[0] + '" data-direction="up" aria-label="Move ' + widget[1] + ' up"' + (index === 0 ? ' disabled' : '') + '>↑</button><button type="button" data-action="dashboard-widget-move" data-widget="' + widget[0] + '" data-direction="down" aria-label="Move ' + widget[1] + ' down"' + (index === widgets.length - 1 ? ' disabled' : '') + '>↓</button></span></div>';
    }).join('') + '</div><button type="button" data-action="dashboard-widget-reset">Reset to defaults</button></details>';
  }

  function applyDashboardPreferences() {
    var container = portalRoot && portalRoot.querySelector('.client-desk-dashboard-widgets');
    if (!container) return;
    var widgets = Array.prototype.slice.call(container.querySelectorAll('[data-dashboard-widget]'));
    var definitions = dashboardWidgetDefinitions().map(function (widget) { return widget[0]; });
    var order = dashboardPreferences.order.filter(function (key) { return definitions.indexOf(key) !== -1; });
    definitions.forEach(function (key) { if (order.indexOf(key) === -1) order.push(key); });
    order.forEach(function (key) {
      var widget = widgets.find(function (item) { return item.dataset.dashboardWidget === key; });
      if (!widget) return;
      container.appendChild(widget);
      widget.hidden = dashboardPreferences.hidden.indexOf(key) !== -1;
    });
    var customize = portalRoot.querySelector('.client-desk-dashboard-customize');
    if (customize) {
      dashboardWidgetDefinitions().forEach(function (definition) {
        var input = customize.querySelector('[data-widget="' + definition[0] + '"]');
        if (input) input.checked = dashboardPreferences.hidden.indexOf(definition[0]) === -1;
      });
    }
  }

  function handleNavigationGroupToggle(event) {
    var group = event.target.closest('[data-nav-group]');
    if (!group || !navigationStorageKey) return;
    navigationGroupState[group.dataset.navGroup] = group.open;
    localStorage.setItem(navigationStorageKey, JSON.stringify(navigationGroupState));
  }

  function renderNotificationPanel() {
    var events = notificationEvents();
    var archived = notificationState.archived;
    var activeEvents = events.filter(function (event) {
      return archived.indexOf(notificationId(event)) === -1;
    });
    var list = notificationState.showEarlier
      ? events.filter(function (event) { return archived.indexOf(notificationId(event)) !== -1; })
      : activeEvents.slice(0, notificationState.showAll ? activeEvents.length : 10);
    var grouped = { today: [], earlier: [] };
    var today = new Date().toDateString();
    list.forEach(function (event) {
      grouped[new Date(event.created_at).toDateString() === today ? 'today' : 'earlier'].push(event);
    });
    function renderGroup(title, items) {
      if (!items.length) return '';
      return '<li class="client-desk-notification-group">' + title + '</li>' + items.map(function (event) {
        var project = projectCache.find(function (item) { return item.id === event.project_id; });
        var eventId = notificationId(event);
        var link = event.event_kind === 'team_mention'
          ? '<a href="#portal-communication" data-portal-page="communication" data-open-team-message="' + escapeHtml(event.message_id) + '" data-mention-id="' + escapeHtml(event.id) + '"><strong>' + escapeHtml(event.title) + '</strong><span>' + escapeHtml(event.description || 'Open the group conversation') + '</span><small>' + escapeHtml(dateLabel(event.created_at)) + '</small></a>'
          : '<a href="#portal-' + (activeProfile.role === 'freelancer' ? 'tasks' : 'projects') + '" data-portal-page="' + (activeProfile.role === 'freelancer' ? 'tasks' : 'projects') + '" data-open-project="' + escapeHtml(event.project_id) + '" data-open-section="deliverables"><strong>' + escapeHtml(event.title) + '</strong><span>' + escapeHtml(project ? project.title : 'Project update') + (event.description ? ' / ' + escapeHtml(event.description) : '') + '</span><small>' + escapeHtml(dateLabel(event.created_at)) + '</small></a>';
        return '<li class="client-desk-notification-item' + (notificationIsRead(event) ? '' : ' is-unread') + '">' + link + (!notificationState.showEarlier ? '<button type="button" data-action="dismiss-notification" data-notification="' + escapeHtml(eventId) + '" aria-label="Dismiss update">×</button>' : '') + '</li>';
      }).join('');
    }
    var items = renderGroup('Today', grouped.today) + renderGroup('Earlier', grouped.earlier);
    if (!items) items = '<li class="client-desk-notification-empty">You’re all caught up.</li>';
    var earlierCount = events.filter(function (event) { return archived.indexOf(notificationId(event)) !== -1; }).length;
    var viewControls = notificationState.showEarlier
      ? '<button type="button" data-action="view-notifications">Back to recent updates</button>'
      : (activeEvents.length > 10 ? '<button type="button" data-action="view-all-notifications">View all updates</button>' : '') +
        (activeEvents.length ? '<button type="button" data-action="archive-notifications">Clear all</button>' : '');
    if (!notificationState.showEarlier && earlierCount) viewControls += '<button type="button" data-action="view-earlier-notifications">View earlier notifications (' + earlierCount + ')</button>';
    return '<div class="client-desk-popover" data-notification-panel role="dialog" aria-label="Notifications" hidden><div class="client-desk-popover-head"><strong>' + (notificationState.showEarlier ? 'Earlier Notifications' : 'Recent Updates') + '</strong><button type="button" data-action="close-notifications" aria-label="Close notifications">Close</button></div><ul>' + items + '</ul><div class="client-desk-notification-actions">' + viewControls + '</div></div>';
  }

  function renderNotifications(profile) {
    if (!profile) return '';
    return '<div class="client-desk-popover-wrap">' + renderNotificationPanel() + '</div>';
  }

  function recentActivityCount() {
    return notificationEvents().slice(0, 10).filter(function (event) {
      return !notificationIsRead(event) && notificationState.archived.indexOf(notificationId(event)) === -1;
    }).length;
  }

  function refreshNotificationPanel() {
    var existing = portalRoot && portalRoot.querySelector('[data-notification-panel]');
    var wasHidden = existing && existing.hidden;
    if (existing) {
      existing.outerHTML = renderNotificationPanel();
      var updatedPanel = portalRoot.querySelector('[data-notification-panel]');
      if (updatedPanel) updatedPanel.hidden = wasHidden;
    }
    var badge = portalRoot && portalRoot.querySelector('.client-desk-notification-count');
    if (badge) {
      var count = recentActivityCount();
      badge.textContent = count || '';
      badge.setAttribute('aria-label', count + ' unread updates');
    }
  }

  function applyPortalTheme() {
    var app = portalRoot && portalRoot.querySelector('.client-desk-app');
    if (app) app.dataset.theme = portalTheme;
  }

  function renderShell(content, profile) {
    var name = profile ? (profile.display_name || profile.email || 'Client') : 'Secure access';
    var role = profile ? (profile.role === 'owner' ? 'Owner' : profile.role === 'freelancer' ? 'Staff' : profile.role === 'deleted' ? 'Access removal in progress' : 'Client') : '';
    var portalTitle = !profile || profile.role === 'customer' || profile.role === 'deleted' ? 'Client Portal' : profile.role === 'freelancer' ? 'Staff Portal' : 'Management Portal';
    var portalDescription = profile && profile.role === 'owner'
      ? 'Manage client projects, team assignments, and payment settings.'
      : profile && profile.role === 'freelancer'
        ? 'Review assigned work, project updates, and shared documents.'
        : 'Follow project progress, review deliverables, and manage agreed payments.';
    var navigation = portalNavigation(profile);
    var secureLabel = window.isSecureContext ? (profile ? 'Secure session' : 'Secure connection') : 'Connection not secure';
    var secureIndicator = '<span class="client-desk-security-indicator">' + portalIcon('lock') + '<span>' + secureLabel + '</span></span>';
    var portalHeader = '<header class="client-desk-portal-header"><div class="client-desk-portal-heading"><p class="client-desk-kicker">Private project workspace</p><h1>' + portalTitle + '</h1><p>' + portalDescription + '</p></div>' + secureIndicator + '</header>';
    if (!profile || !navigation.length) {
      portalRoot.innerHTML = '<div class="client-desk-app" data-theme="' + portalTheme + '">' + portalHeader + '<main class="client-desk-main-content">' + content + '</main>' + portalFooter() + '</div>';
      return;
    }

    var navLinks = renderNavigationGroups(navigation);
    var mobileNav = renderMobileNavigation(navigation);
    var search = '<label class="client-desk-search">' + portalIcon('search') + '<input type="search" data-portal-search placeholder="Search projects" aria-label="Search projects"><kbd>Ctrl / ⌘ K</kbd></label>';
    var notifications = renderNotifications(profile);
    var currentLabel = portalPageTitle(currentPortalPage);
    var accountMenu = '<details class="client-desk-user-menu" id="clientDeskProfile"><summary><span class="client-desk-avatar" aria-hidden="true">' + escapeHtml(initials(profile)) + '</span><span><strong>' + escapeHtml(name) + '</strong><small>' + escapeHtml(role) + '</small></span><span class="client-desk-menu-chevron" aria-hidden="true">⌄</span></summary><div class="client-desk-user-popover"><p>' + escapeHtml(profile.email || '') + '</p><button type="button" data-action="theme">' + portalIcon(portalTheme === 'light' ? 'moon' : 'sun') + (portalTheme === 'light' ? 'Use dark appearance' : 'Use light appearance') + '</button><button type="button" data-action="signout">Sign Out</button></div></details>';
    portalRoot.innerHTML = '<div class="client-desk-app" data-theme="' + portalTheme + '">' + portalHeader + '<nav class="client-desk-workspace-nav" aria-label="Portal sections">' + navLinks + '</nav><div class="client-desk-toolbar">' + search + '<div class="client-desk-top-actions"><div class="client-desk-notification-wrap"><button class="client-desk-icon-button" type="button" data-action="notifications" aria-label="Recent project updates" aria-expanded="false">' + portalIcon('bell') + '<span class="client-desk-notification-count" aria-label="' + recentActivityCount() + ' unread updates">' + (recentActivityCount() || '') + '</span></button>' + notifications + '</div><a class="client-desk-icon-button client-desk-help-button" href="#/contact" aria-label="Contact support">' + portalIcon('help') + '</a>' + accountMenu + '</div></div><div class="client-desk-breadcrumb"><a href="#portal-dashboard" data-portal-page="dashboard" data-back-dashboard' + (currentLabel === 'Dashboard' || currentLabel === 'Overview' ? ' hidden' : '') + '>Back to Dashboard</a><span>Portal</span><span aria-hidden="true">/</span><strong data-current-section>' + escapeHtml(currentLabel) + '</strong></div><main class="client-desk-main-content">' + content + '</main>' + portalFooter() + mobileNav + '</div>';
  }

  function portalFooter() {
    return '<footer class="client-desk-footer"><a href="#/contact">Support</a><a href="#/terms">Privacy Policy &amp; Terms</a><span>' + portalIcon('lock') + ' Secure Portal</span></footer>';
  }

  function showSetupRequired(message) {
    renderShell('<div class="client-desk-form"><p class="client-desk-kicker">Private Workspace</p><h2>Secure Sign-In Is Unavailable</h2>' +
      '<p>The secure sign-in service is not available, and this page does not store client information.</p>' +
      '<div class="client-desk-notice"><div><strong>Contact support for assistance</strong><p>' + escapeHtml(message || 'The portal is not configured for secure access yet.') + ' New requests and payments cannot be submitted until service is restored.</p></div></div>' +
      '<p class="client-desk-footnote">For assistance, use the <a href="#/contact">contact page</a>.</p></div>', null);
  }

  function loadSupabase(done) {
    if (window.supabase && window.supabase.createClient) return done();
    var existing = document.querySelector('script[data-supabase-client]');
    if (existing) {
      existing.addEventListener('load', done, { once: true });
      existing.addEventListener('error', function () { showSetupRequired('Secure sign-in could not be loaded. Check your connection and try again.'); }, { once: true });
      return;
    }
    var script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0';
    script.integrity = 'sha384-gnyZit14c5lnGcarmA166QQjjJXpucw25ogZXuwH3HxxY904zHkBqmxVpelsPorb';
    script.crossOrigin = 'anonymous';
    script.async = true;
    script.dataset.supabaseClient = 'true';
    script.onload = done;
    script.onerror = function () { showSetupRequired('Secure sign-in could not be loaded. Check your connection and try again.'); };
    document.head.appendChild(script);
  }

  function renderSignIn() {
    renderShell('<div class="client-desk-form"><p class="client-desk-kicker">Secure Client Access</p><h2>Sign In</h2>' +
      '<p>Sign in to review your projects, deliverables, and agreed payment details. New clients can create an account below.</p>' +
      '<form class="client-desk-message-form" data-action="signin"><div class="field"><label class="client-desk-label" for="portalEmail">Email address</label><input id="portalEmail" name="email" type="email" autocomplete="email" required maxlength="254" placeholder="you@example.com"></div>' +
      '<div class="field"><label class="client-desk-label" for="portalPassword">Password</label><input id="portalPassword" name="password" type="password" autocomplete="current-password" required></div>' +
      '<button class="btn" type="submit">Sign in</button><p class="client-desk-form-status" data-portal-status aria-live="polite"></p></form>' +
      '<details class="client-desk-card"><summary><strong>New Client? Create an Account</strong></summary><form class="client-desk-message-form" data-action="signup">' +
      '<div class="field"><label class="client-desk-label" for="signupName">Your name</label><input id="signupName" name="name" type="text" autocomplete="name" maxlength="100" required></div>' +
      '<div class="field"><label class="client-desk-label" for="signupEmail">Email address</label><input id="signupEmail" name="email" type="email" autocomplete="email" required maxlength="254" placeholder="you@example.com"></div>' +
      '<div class="field"><label class="client-desk-label" for="signupPassword">Create a password</label><input id="signupPassword" name="password" type="password" autocomplete="new-password" minlength="8" required></div>' +
      '<button class="btn ghost" type="submit">Create client account</button><p class="client-desk-form-status" data-portal-status aria-live="polite"></p></form></details>' +
      '<details class="client-desk-card"><summary><strong>Management Sign-In Assistance</strong></summary><p>Management accounts are created by the project owner. Public registration is for client accounts and cannot grant management access.</p><p class="client-desk-footnote">If you cannot sign in, contact the project owner to confirm your account and access level. For assistance, <a href="#/contact">contact FixerCtrl</a>.</p></details>' +
      '<p class="client-desk-footnote">Project records and files are private to your account. For password or access assistance, <a href="#/contact">contact FixerCtrl</a>.</p></div>', null);
  }

  function buildRequestForm() {
    return '<details class="client-desk-card" data-request-panel><summary><strong>Submit a Project Request</strong><span class="client-desk-status" data-status="received">Request Received</span></summary>' +
      '<form class="client-desk-message-form" data-action="request"><div class="client-desk-field-grid">' +
      '<div class="field"><label class="client-desk-label" for="requestTitle">Project title</label><input id="requestTitle" name="title" type="text" maxlength="120" required placeholder="e.g. Small business website"></div>' +
      '<div class="field"><label class="client-desk-label" for="requestCategory">Service</label><select id="requestCategory" name="service" required>' + categories.map(function (item) { return '<option value="' + item[0] + '">' + item[1] + '</option>'; }).join('') + '</select></div></div>' +
      '<div class="field"><label class="client-desk-label" for="requestDescription">Project Requirements</label><textarea id="requestDescription" name="description" maxlength="5000" required placeholder="Describe your objectives, preferred deadline, and any materials already available."></textarea></div>' +
      '<div class="field"><label class="client-desk-label" for="requestDue">Preferred Deadline (Optional)</label><input id="requestDue" name="preferred_date" type="date"></div>' +
      '<button class="btn" type="submit">Submit project request</button><p class="client-desk-form-status" data-portal-status aria-live="polite"></p></form></details>';
  }

  function projectEvents(projectId) {
    return (relatedData.events || []).filter(function (row) { return row.project_id === projectId; });
  }

  function projectChecklist(projectId) {
    return (relatedData.checklist || []).filter(function (row) { return row.project_id === projectId; });
  }

  function projectMessages(projectId) {
    return (relatedData.messages || []).filter(function (row) { return row.project_id === projectId; });
  }

  function projectInvoices(projectId) {
    return (relatedData.invoices || []).filter(function (row) { return row.project_id === projectId; });
  }

  function projectQuotes(projectId) {
    return (relatedData.quotes || []).filter(function (row) { return row.project_id === projectId; });
  }

  function projectStages(projectId) {
    return (relatedData.stages || []).filter(function (row) { return row.project_id === projectId; });
  }

  function stageSteps(stageId) {
    return (relatedData.steps || []).filter(function (row) { return row.stage_id === stageId; });
  }

  function stepStatusLabel(status) {
    var match = stepStatuses.find(function (entry) { return entry[0] === status; });
    return match ? match[1] : 'Not Started';
  }

  function displayStatus(status, recordType) {
    var labels = {
      sent: 'Awaiting Approval',
      accepted: 'Approved',
      paid: 'Paid',
      scheduled: 'Scheduled',
      overdue: 'Overdue',
      failed: 'Action Required',
      draft: 'Draft',
      cancelled: 'Cancelled',
      rejected: 'Declined',
      pending: 'Awaiting Approval'
    };
    if (status === 'sent' && recordType === 'invoice') return 'Awaiting Payment';
    if (labels[status]) return labels[status];
    return String(status || 'Pending').replace(/[_-]+/g, ' ').replace(/\b\w/g, function (letter) { return letter.toUpperCase(); });
  }

  function stageProgress(stage) {
    var steps = stageSteps(stage.id);
    if (!steps.length) return 0;
    return Math.round(steps.filter(function (step) { return step.status === 'done'; }).length / steps.length * 100);
  }

  function projectProgress(projectId) {
    var stages = projectStages(projectId);
    if (!stages.length) return 0;
    return Math.round(stages.reduce(function (total, stage) { return total + stageProgress(stage); }, 0) / stages.length);
  }

  function renderProgressBar(value, label) {
    return '<div class="client-desk-progress" role="progressbar" aria-label="' + escapeHtml(label) + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + value + '"><span style="width:' + value + '%"></span></div>';
  }

  function projectOverview(project) {
    var allSteps = (relatedData.steps || []).filter(function (step) { return step.project_id === project.id; });
    var stages = projectStages(project.id);
    allSteps.sort(function (left, right) {
      var leftStage = stages.findIndex(function (stage) { return stage.id === left.stage_id; });
      var rightStage = stages.findIndex(function (stage) { return stage.id === right.stage_id; });
      return leftStage - rightStage || left.position - right.position;
    });
    var reviewStep = allSteps.find(function (step) { return step.status === 'in_review'; });
    var nextStep = allSteps.find(function (step) { return step.status !== 'done'; });
    var customerItem = projectChecklist(project.id).find(function (item) { return item.owner_kind === 'customer' && !item.completed_at; });
    var lastEvent = projectEvents(project.id).slice(-1)[0];
    return {
      clientAction: customerItem ? customerItem.title : reviewStep ? 'Review ' + reviewStep.title : 'No action needed from you',
      nextMilestone: nextStep ? nextStep.title : 'All project steps complete',
      lastEvent: lastEvent
    };
  }

  function renderProjectProgress(project) {
    var stages = projectStages(project.id);
    var overview = projectOverview(project);
    var projectFreelancers = (relatedData.teamAssignments || []).filter(function (assignment) {
      return assignment.project_id === project.id;
    }).map(function (assignment) { return assignment.user_id; });
    var stagesMarkup = stages.map(function (stage) {
      var steps = stageSteps(stage.id);
      var percent = stageProgress(stage);
      var stepMarkup = steps.map(function (step) {
        var ownerProfile = step.owner_id && (relatedData.profiles || []).find(function (profile) { return profile.id === step.owner_id; });
        var owner = step.owner_id === activeProfile.id ? 'You' : step.owner_display_name || (ownerProfile && ownerProfile.display_name) || (step.owner_id ? 'Assigned team member' : 'FixerCtrl team');
        var details = owner + (step.due_at ? ' / Due ' + dateLabel(step.due_at) : '') + (step.completed_at ? ' / Completed ' + dateLabel(step.completed_at) : '');
        var staffControls = activeProfile.role === 'owner' || (activeProfile.role === 'freelancer' && step.status !== 'done')
          ? '<label class="client-desk-step-control"><span class="client-desk-label">Update Status</span><select data-action="step-status" data-step="' + escapeHtml(step.id) + '" data-current-status="' + escapeHtml(step.status) + '">' + stepStatuses.filter(function (entry) { return activeProfile.role === 'owner' || entry[0] !== 'done'; }).map(function (entry) {
            return '<option value="' + entry[0] + '" ' + (entry[0] === step.status ? 'selected' : '') + '>' + entry[1] + '</option>';
          }).join('') + '</select></label>'
          : '';
        var assignedFreelancers = projectFreelancers.map(function (userId) {
          return (relatedData.freelancers || []).find(function (profile) { return profile.id === userId; });
        }).filter(Boolean);
        var ownerOptions = assignedFreelancers.map(function (profile) {
          return '<option value="' + escapeHtml(profile.id) + '" ' + (profile.id === step.owner_id ? 'selected' : '') + '>' + escapeHtml(profile.display_name || profile.email) + '</option>';
        }).join('');
        if (step.owner_id && !assignedFreelancers.some(function (profile) { return profile.id === step.owner_id; })) {
          ownerOptions = '<option value="' + escapeHtml(step.owner_id) + '" selected>Reassignment needed</option>' + ownerOptions;
        }
        var ownerControls = activeProfile.role === 'owner'
          ? '<div class="client-desk-step-assignment"><label class="client-desk-step-control"><span class="client-desk-label">Assigned Team Member</span><select data-step-owner="' + escapeHtml(step.id) + '"><option value="">Unassigned</option>' + ownerOptions + '</select></label><label class="client-desk-step-control"><span class="client-desk-label">Due Date</span><input type="date" data-step-due="' + escapeHtml(step.id) + '" value="' + escapeHtml(step.due_at ? new Date(step.due_at).toISOString().slice(0, 10) : '') + '"></label><button class="btn ghost" type="button" data-action="assign-step" data-step="' + escapeHtml(step.id) + '">Save Assignment</button></div>'
          : '';
        var clientReview = activeProfile.role === 'customer' && step.status === 'in_review'
          ? '<div class="client-desk-step-review"><label class="client-desk-label" for="feedback-' + escapeHtml(step.id) + '">Revision notes (optional)</label><textarea id="feedback-' + escapeHtml(step.id) + '" data-review-feedback="' + escapeHtml(step.id) + '" maxlength="1000" placeholder="Describe any changes required before requesting a revision."></textarea><div class="client-desk-owner-tools"><button class="btn" type="button" data-action="step-review" data-step="' + escapeHtml(step.id) + '" data-status="done">Approve deliverable</button><button class="btn ghost" type="button" data-action="step-review" data-step="' + escapeHtml(step.id) + '" data-status="in_progress">Request revision</button></div></div>'
          : '';
        return '<li class="client-desk-step" id="projectStep-' + escapeHtml(step.id) + '" data-step-id="' + escapeHtml(step.id) + '"><div class="client-desk-step-copy"><span class="client-desk-step-state" data-status="' + escapeHtml(step.status) + '">' + escapeHtml(stepStatusLabel(step.status)) + '</span><strong>' + escapeHtml(step.title) + '</strong><small>' + escapeHtml(details) + '</small></div>' + staffControls + ownerControls + clientReview + '</li>';
      }).join('');
      return '<section class="client-desk-stage"><div class="client-desk-stage-head"><div><h3>' + escapeHtml(stage.title) + '</h3><span>' + percent + '% complete</span></div>' + renderProgressBar(percent, stage.title + ' progress') + '</div><ol class="client-desk-steps">' + stepMarkup + '</ol></section>';
    }).join('');
    return '<details class="client-desk-project-section" data-project-section="deliverables" data-ui-state="project-' + escapeHtml(project.id) + '-deliverables" open><summary>Project Timeline &amp; Deliverables</summary><section class="client-desk-progress-panel" data-portal-section="deliverables" aria-label="Deliverables and approvals"><div class="client-desk-project-summary"><div><span class="client-desk-label">Overall Progress</span><strong>' + projectProgress(project.id) + '%</strong>' + renderProgressBar(projectProgress(project.id), 'Overall project progress') + '</div><div><span class="client-desk-label">Next Milestone</span><strong>' + escapeHtml(overview.nextMilestone) + '</strong></div><div><span class="client-desk-label">Next Action for You</span><strong>' + escapeHtml(overview.clientAction) + '</strong></div><div><span class="client-desk-label">Last Update</span><strong>' + escapeHtml(overview.lastEvent ? overview.lastEvent.title : 'No updates yet') + '</strong><small>' + escapeHtml(overview.lastEvent ? dateLabel(overview.lastEvent.created_at) : 'Updates will appear here') + '</small>' + (overview.lastEvent && overview.lastEvent.description ? '<p class="client-desk-footnote">' + escapeHtml(overview.lastEvent.description) + '</p>' : '') + '</div></div><h3>Project Stages</h3>' + (stagesMarkup || '<p class="client-desk-footnote">Project stages will appear here when available.</p>') + '</section></details>';
  }

  function renderTimeline(project) {
    var events = projectEvents(project.id);
    if (!events.length) return '<section data-portal-section="timeline"><h3>Project Timeline</h3><p class="client-desk-footnote">Project updates will appear here as work progresses.</p></section>';
    return '<section data-portal-section="timeline"><h3>Project Timeline</h3><ol class="client-desk-timeline">' + events.map(function (event, index) {
      return '<li class="' + (index === events.length - 1 ? 'is-current' : 'is-done') + '"><strong>' + escapeHtml(event.title) + '</strong><br>' + escapeHtml(event.description || '') + '<br><small>' + escapeHtml(dateLabel(event.created_at)) + '</small></li>';
    }).join('') + '</ol></section>';
  }

  function renderChecklist(project) {
    var items = projectChecklist(project.id);
    if (!items.length) return '<p class="client-desk-footnote">There are no outstanding checklist items.</p>';
    return '<ul class="client-desk-checklist">' + items.map(function (item) {
      var owner = item.owner_kind === 'customer' ? (activeProfile.role === 'freelancer' ? 'Client' : 'You') : 'FixerCtrl';
      var canComplete = activeProfile.role === 'customer' && item.owner_kind === 'customer' && !item.completed_at;
      return '<li><input type="checkbox" data-action="checklist" data-id="' + escapeHtml(item.id) + '" ' + (item.completed_at ? 'checked disabled' : canComplete ? '' : 'disabled') + ' aria-label="' + escapeHtml(owner + ': ' + item.title) + '"><span><strong>' + escapeHtml(owner) + ':</strong> ' + escapeHtml(item.title) + (item.due_at ? '<br><small>Due ' + escapeHtml(dateLabel(item.due_at)) + '</small>' : '') + '</span></li>';
    }).join('') + '</ul>';
  }

  function renderMessages(project) {
    var messages = projectMessages(project.id);
    return '<ul class="client-desk-message-list">' + (messages.length ? messages.map(function (message) {
      var author = 'FixerCtrl';
      if (message.author_id === activeProfile.id) author = activeProfile.role === 'owner' ? 'FixerCtrl' : 'You';
      else if (activeProfile.role === 'freelancer') author = 'Project update';
      else if (activeProfile.role === 'owner') {
        var authorProfile = (relatedData.profiles || []).find(function (profile) { return profile.id === message.author_id; });
        author = authorProfile ? (authorProfile.display_name || authorProfile.email) : 'Customer';
      }
      return '<li class="client-desk-message"><small>' + escapeHtml(author) + (message.is_internal ? ' / PRIVATE NOTE' : '') + ' / ' + escapeHtml(dateLabel(message.created_at)) + '</small><p>' + escapeHtml(message.body) + '</p></li>';
    }).join('') : '<li class="client-desk-footnote">No messages have been exchanged yet.</li>') + '</ul>' +
      '<form class="client-desk-message-form" data-action="message" data-project="' + escapeHtml(project.id) + '"><label class="client-desk-label" for="message-' + escapeHtml(project.id) + '">' + (activeProfile.role === 'owner' ? 'Reply to client' : 'Message FixerCtrl') + '</label><textarea id="message-' + escapeHtml(project.id) + '" name="body" required maxlength="5000" placeholder="Write a project update or ask a question."></textarea>' + (activeProfile.role === 'owner' ? '<label class="client-desk-checkline"><input name="internal" type="checkbox"><span>Private note (visible to management only)</span></label>' : '') + '<button class="btn" type="submit">Send message</button><p class="client-desk-footnote">Email notifications will be sent when delivery is configured.</p></form>';
  }

  function renderFiles(project) {
    var files = (relatedData.files || []).filter(function (file) { return file.project_id === project.id; });
    return '<section data-portal-section="files"><div class="client-desk-section-head"><h2>Documents</h2></div>' +
      (files.length ? '<ul class="client-desk-checklist">' + files.map(function (file) {
        return '<li><span aria-hidden="true">FILE</span><span><a href="' + escapeHtml(file.signed_url || '#') + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(file.file_name) + '</a> / ' + escapeHtml(dateLabel(file.created_at)) + (file.is_internal ? ' / PRIVATE' : '') + '</span></li>';
      }).join('') + '</ul>' : '<p class="client-desk-footnote">No documents have been shared yet.</p>') +
      '<form class="client-desk-message-form" data-action="upload" data-project="' + escapeHtml(project.id) + '"><label class="client-desk-label" for="upload-' + escapeHtml(project.id) + '">Upload a document (JPG, PNG, WebP, or PDF; maximum 10 MB)</label><input id="upload-' + escapeHtml(project.id) + '" name="file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required>' + (activeProfile.role === 'owner' ? '<label class="client-desk-checkline"><input name="internal" type="checkbox"><span>Private document (visible to management only)</span></label>' : '') + '<button class="btn ghost" type="submit">Upload document</button></form></section>';
  }

  function renderInvoices(project) {
    var invoices = projectInvoices(project.id);
    var providers = relatedData.providers || [];
    var paymentGuidance = '<details class="client-desk-payment-guidance"><summary>About invoices and payments</summary><p>Quotes confirm the agreed scope, total, due conditions, and third-party costs. Invoices follow the agreed schedule; project status changes do not initiate payment. Payments are processed by the selected provider, and FixerCtrl does not store card details.</p></details>';
    if (!invoices.length) return '<p class="client-desk-footnote">No invoices currently require payment. Approved pricing and the payment schedule will appear here before payment is requested.</p>' + paymentGuidance;
    return '<div class="client-desk-payment-list">' + invoices.map(function (invoice) {
      var payable = ['sent', 'overdue'].indexOf(invoice.status) !== -1;
      var available = activeProfile.role === 'owner' ? [] : providers.filter(function (provider) { return provider.is_enabled; });
        var emailState = activeProfile.role === 'owner' ? '<p class="client-desk-footnote">Invoice email status: ' + escapeHtml(displayStatus(invoice.email_state)) + ' / scheduled ' + escapeHtml(dateLabel(invoice.email_send_at)) + (invoice.email_last_error ? '<br>' + escapeHtml(invoice.email_last_error) : '') + '</p>' + (invoice.email_state === 'failed' ? '<button class="btn ghost" type="button" data-action="retry-invoice" data-invoice="' + escapeHtml(invoice.id) + '">Retry invoice email</button>' : '') : '';
        return '<div class="client-desk-payment"><div><span class="client-desk-label">' + escapeHtml(invoice.invoice_number || 'Invoice') + ' / ' + escapeHtml(displayStatus(invoice.status, 'invoice')) + '</span><p class="client-desk-money">' + escapeHtml(money(invoice.amount_minor, invoice.currency)) + '</p><p>Due ' + escapeHtml(dateLabel(invoice.due_at)) + (invoice.description ? ' / ' + escapeHtml(invoice.description) : '') + '</p></div>' +
        emailState +
        (payable ? '<div class="client-desk-checkout-options">' + available.map(function (provider) {
          return '<button class="btn ghost" type="button" data-action="pay" data-invoice="' + escapeHtml(invoice.id) + '" data-provider="' + escapeHtml(provider.provider) + '">' + escapeHtml(provider.label) + '</button>';
        }).join('') + '</div>' : '<span class="client-desk-status" data-status="' + escapeHtml(invoice.status) + '">' + escapeHtml(displayStatus(invoice.status, 'invoice')) + (invoice.status === 'scheduled' ? ' / Email ' + escapeHtml(dateLabel(invoice.email_send_at)) : '') + '</span>') +
        (payable && activeProfile.role === 'owner' ? '<form class="client-desk-message-form" data-action="manual-paid" data-invoice="' + escapeHtml(invoice.id) + '"><label class="client-desk-checkline"><input name="verified" type="checkbox" required><span>I have confirmed receipt of this bank transfer.</span></label><button class="btn ghost" type="submit">Record payment</button></form>' : '') + '</div>';
    }).join('') + '</div>' + paymentGuidance;
  }

  function renderQuotes(project) {
    var quotes = projectQuotes(project.id);
    if (!quotes.length) return '<p class="client-desk-footnote">A written quote will appear here before work begins or payment is requested.</p>';
    return quotes.map(function (quote) {
      var accept = quote.status === 'sent';
      return '<article class="client-desk-card"><div class="client-desk-card-meta"><span>Quote v' + escapeHtml(quote.version) + '</span><span class="client-desk-status" data-status="' + escapeHtml(quote.status) + '">' + escapeHtml(displayStatus(quote.status, 'quote')) + '</span></div><p class="client-desk-money">' + escapeHtml(money(quote.total_minor, quote.currency)) + '</p><p><strong>Scope</strong><br>' + escapeHtml(quote.scope) + '</p><p><strong>Deliverables</strong><br>' + escapeHtml(quote.deliverables) + '</p>' + (quote.exclusions ? '<p><strong>Not Included</strong><br>' + escapeHtml(quote.exclusions) + '</p>' : '') + '<p class="client-desk-footnote">Valid until ' + escapeHtml(dateLabel(quote.valid_until)) + '</p>' + (accept ? '<button class="btn" type="button" data-action="accept-quote" data-quote="' + escapeHtml(quote.id) + '">Approve quote</button>' : '') + '</article>';
    }).join('');
  }

  function renderOwnerTools(project) {
    if (activeProfile.role !== 'owner') return '';
    return '<div class="client-desk-card" data-portal-section="management"><h3>Project Management</h3><p class="client-desk-footnote">For a new client request, assign project access under Project Team, then assign each step from Project Timeline &amp; Deliverables.</p><div class="client-desk-field-grid"><div class="field"><label class="client-desk-label" for="status-' + escapeHtml(project.id) + '">Project Status</label><select id="status-' + escapeHtml(project.id) + '" data-action="set-status" data-project="' + escapeHtml(project.id) + '">' + statuses.map(function (entry) { return '<option value="' + entry[0] + '" ' + (project.status === entry[0] ? 'selected' : '') + '>' + entry[1] + '</option>'; }).join('') + '</select></div><div class="field"><label class="client-desk-label" for="next-' + escapeHtml(project.id) + '">Next Action</label><input id="next-' + escapeHtml(project.id) + '" data-action="set-next" data-project="' + escapeHtml(project.id) + '" type="text" maxlength="240" value="' + escapeHtml(project.next_action || '') + '" placeholder="For example: Review the homepage design"></div></div><button class="btn ghost" type="button" data-action="save-project" data-project="' + escapeHtml(project.id) + '">Save project update</button>' +
      '<details><summary>Manage Client Checklist</summary><form class="client-desk-message-form" data-action="checklist-add" data-project="' + escapeHtml(project.id) + '"><label class="client-desk-label">Checklist item</label><input name="title" type="text" required maxlength="240" placeholder="For example: Upload the company logo"><div class="client-desk-field-grid"><div class="field"><label class="client-desk-label">Assigned to</label><select name="owner_kind"><option value="customer">Client</option><option value="owner">FixerCtrl</option></select></div><div class="field"><label class="client-desk-label">Due date (optional)</label><input name="due_at" type="date"></div></div><label class="client-desk-checkline"><input name="internal" type="checkbox"><span>Private management-only item</span></label><button class="btn ghost" type="submit">Add checklist item</button></form></details>' +
      renderQuoteBuilder(project) + '</div>' + renderTeamTools(project);
  }

  function renderTeamTools(project) {
    if (activeProfile.role !== 'owner') return '';
    var freelancers = relatedData.freelancers || [];
    var assignments = (relatedData.teamAssignments || []).filter(function (assignment) { return assignment.project_id === project.id; });
    var assignedIds = assignments.map(function (assignment) { return assignment.user_id; });
    return '<details class="client-desk-card"><summary><strong>Project Team</strong></summary><p class="client-desk-footnote">Assigned staff can view this project, share client-facing updates, and add project files. They cannot view private notes, quotes, or invoices.</p>' +
      (freelancers.length ? '<form class="client-desk-message-form" data-action="team" data-project="' + escapeHtml(project.id) + '"><fieldset><legend class="client-desk-label">Freelancers with access</legend>' + freelancers.map(function (freelancer) {
        var displayName = freelancer.display_name || freelancer.email;
        return '<label class="client-desk-checkline"><input type="checkbox" name="freelancer" value="' + escapeHtml(freelancer.id) + '" ' + (assignedIds.indexOf(freelancer.id) !== -1 ? 'checked' : '') + '><span>' + escapeHtml(displayName) + ' / ' + escapeHtml(freelancer.email) + '</span></label>';
      }).join('') + '</fieldset><button class="btn ghost" type="submit">Save project team</button></form>' : '<p class="client-desk-footnote">No staff accounts are available. Create an account and grant staff access before assigning project work.</p>') + '</details>';
  }

  function renderFreelancerTools(project) {
    if (activeProfile.role !== 'freelancer') return '';
    return '<div class="client-desk-card"><h3>Client Progress Update</h3><p class="client-desk-footnote">Saving a status or next step adds a dated update to the client’s project timeline.</p><div class="client-desk-field-grid"><div class="field"><label class="client-desk-label" for="status-' + escapeHtml(project.id) + '">Project Status</label><select id="status-' + escapeHtml(project.id) + '" data-action="set-status" data-project="' + escapeHtml(project.id) + '">' + statuses.map(function (entry) { return '<option value="' + entry[0] + '" ' + (project.status === entry[0] ? 'selected' : '') + '>' + entry[1] + '</option>'; }).join('') + '</select></div><div class="field"><label class="client-desk-label" for="next-' + escapeHtml(project.id) + '">Next Action</label><input id="next-' + escapeHtml(project.id) + '" data-action="set-next" data-project="' + escapeHtml(project.id) + '" type="text" maxlength="240" value="' + escapeHtml(project.next_action || '') + '" placeholder="For example: Test the updated checkout"></div></div><button class="btn ghost" type="button" data-action="save-project" data-project="' + escapeHtml(project.id) + '">Save progress update</button></div>';
  }

  function renderProject(project) {
    var status = statuses.find(function (entry) { return entry[0] === project.status; });
    var freelancer = activeProfile.role === 'freelancer';
    var overview = projectOverview(project);
    return '<details class="client-desk-project" id="clientDeskProject-' + escapeHtml(project.id) + '" data-project-details data-project-id="' + escapeHtml(project.id) + '"><summary><span class="client-desk-project-heading"><span class="client-desk-label">' + escapeHtml(project.reference || project.id.slice(0, 8)) + ' / ' + escapeHtml(project.service_category.replace('_', ' ')) + '</span><strong>' + escapeHtml(project.title) + '</strong><small>Next step: ' + escapeHtml(overview.nextMilestone) + '</small></span><div class="client-desk-project-summary-status"><span class="client-desk-status" data-status="' + escapeHtml(project.status) + '">' + escapeHtml(status ? status[1] : displayStatus(project.status)) + '</span><span class="client-desk-project-percent">' + projectProgress(project.id) + '% Complete</span>' + renderProgressBar(projectProgress(project.id), project.title + ' progress') + '</div></summary>' +
      '<div class="client-desk-project-body">' + renderProjectProgress(project) +
      '<details class="client-desk-project-section" data-ui-state="project-' + escapeHtml(project.id) + '-timeline"><summary>Timeline &amp; Activity</summary><div><p class="client-desk-footnote">Updated ' + escapeHtml(dateLabel(project.updated_at)) + '</p>' + (project.next_action ? '<div class="client-desk-notice"><div><strong>Next Step</strong><p>' + escapeHtml(project.next_action) + '</p></div></div>' : '') + renderTimeline(project) + '</div></details>' +
      '<details class="client-desk-project-section" data-ui-state="project-' + escapeHtml(project.id) + '-messages"><summary>Messages</summary><section data-portal-section="messages">' + renderMessages(project) + '</section></details>' +
      '<details class="client-desk-project-section" data-ui-state="project-' + escapeHtml(project.id) + '-checklist"><summary>Outstanding Items</summary>' + renderChecklist(project) + '</details><details class="client-desk-project-section" data-ui-state="project-' + escapeHtml(project.id) + '-files"><summary>Documents</summary>' + renderFiles(project) + '</details>' +
      (freelancer ? '' : '<details class="client-desk-project-section" data-ui-state="project-' + escapeHtml(project.id) + '-billing"><summary>Quotes, Invoices &amp; Payments</summary><section data-portal-section="billing"><div class="client-desk-section-head"><h2>Quotes</h2></div>' + renderQuotes(project) + '<div class="client-desk-section-head"><h2>Invoices &amp; Payments</h2></div>' + renderInvoices(project) + '</section></details>') +
      (activeProfile.role === 'owner' || freelancer ? '<details class="client-desk-project-section" data-ui-state="project-' + escapeHtml(project.id) + '-management"><summary>Project Management</summary>' + renderOwnerTools(project) + renderFreelancerTools(project) + '</details>' : '') + '</div></details>';
  }

  function renderFreelancerAccounts() {
    if (activeProfile.role !== 'owner') return '';
    var profiles = (relatedData.profiles || []).filter(function (profile) { return profile.role === 'customer' || profile.role === 'freelancer'; });
    return '<section class="client-desk-card" id="clientDeskTeam" data-portal-section="team"><h3>Staff Access</h3><p class="client-desk-footnote">Set a registered account as Staff, or return it to Client access. Staff can view only projects assigned to them.</p>' +
      (profiles.length ? profiles.map(function (profile) {
        return '<form class="client-desk-account-role" data-action="freelancer-role"><div><strong>' + escapeHtml(profile.display_name || profile.email) + '</strong><span class="client-desk-footnote">' + escapeHtml(profile.email) + '</span></div><label class="client-desk-label" for="role-' + escapeHtml(profile.id) + '">Portal access</label><select id="role-' + escapeHtml(profile.id) + '" name="role"><option value="customer" ' + (profile.role === 'customer' ? 'selected' : '') + '>Client</option><option value="freelancer" ' + (profile.role === 'freelancer' ? 'selected' : '') + '>Staff</option></select><input name="user_id" type="hidden" value="' + escapeHtml(profile.id) + '"><button class="btn ghost" type="submit">Save access</button></form>';
      }).join('') : '<p class="client-desk-footnote">No staff accounts are available yet.</p>') + '</section>';
  }

  function renderAccountDeletion() {
    if (activeProfile.role !== 'customer') return '';
    return '<details class="client-desk-card"><summary><strong>Delete Client Account</strong></summary>' +
      '<p>This permanently removes your sign-in and replaces your name and email with anonymized details. Project history, messages, shared files, quotes, and invoice records are retained for business records, but will no longer be linked to your identity. This cannot be undone.</p>' +
      '<form class="client-desk-message-form" data-action="delete-profile"><div class="field"><label class="client-desk-label" for="deleteAccountPassword">Confirm with your current password</label><input id="deleteAccountPassword" name="password" type="password" autocomplete="current-password" required></div><label class="client-desk-checkline"><input type="checkbox" name="confirm" required><span>I understand that my sign-in will be removed and project records will remain anonymized.</span></label><button class="btn ghost client-desk-danger" type="submit">Delete account</button><p class="client-desk-form-status" data-portal-status aria-live="polite"></p></form></details>';
  }

  function renderPendingDeletion() {
    renderShell('<div class="client-desk-notice"><div><strong>Account Removal in Progress</strong><p>Your profile has been anonymized and portal access is disabled. Finish removing the sign-in below. If the operation continues to fail, contact FixerCtrl for assistance.</p>' +
      '<form class="client-desk-message-form" data-action="delete-profile"><div class="field"><label class="client-desk-label" for="finishDeletionPassword">Confirm with your current password</label><input id="finishDeletionPassword" name="password" type="password" autocomplete="current-password" required></div><label class="client-desk-checkline"><input type="checkbox" name="confirm" required><span>Continue removing this sign-in.</span></label><button class="btn ghost client-desk-danger" type="submit">Finish account deletion</button><p class="client-desk-form-status" data-portal-status aria-live="polite"></p></form></div></div>', activeProfile);
  }

  function renderPaymentSettings() {
    if (activeProfile.role !== 'owner') return '';
    var providers = relatedData.providers || [];
    return '<section class="client-desk-card" id="clientDeskFinance" data-portal-section="finance"><h3>Payment Settings</h3><p class="client-desk-footnote">Payment provider credentials are managed in the secure project settings. Enable a provider here only after its merchant account and server settings are configured.</p><form class="client-desk-message-form" data-action="payment-settings">' +
      providers.map(function (provider) {
        return '<label class="client-desk-checkline"><input type="checkbox" name="provider_' + escapeHtml(provider.provider) + '" ' + (provider.is_enabled ? 'checked' : '') + '><span><strong>' + escapeHtml(provider.label) + '</strong> / ' + (provider.is_enabled ? 'Available to customers' : 'Hidden from customers') + '</span></label>';
      }).join('') +
      '<div class="field"><label class="client-desk-label" for="eftInstructions">Bank transfer instructions (shown to clients)</label><textarea id="eftInstructions" name="eft_instructions" maxlength="1500">' + escapeHtml((providers.find(function (provider) { return provider.provider === 'eft'; }) || {}).public_instructions || '') + '</textarea></div><button class="btn ghost" type="submit">Save payment settings</button></form></section>';
  }

  function renderAutomaticAssignmentSettings() {
    if (activeProfile.role !== 'owner') return '';
    var enabled = Boolean(relatedData.automaticAssignmentEnabled);
    return '<section class="client-desk-card" id="clientDeskManagementSettings" data-portal-section="settings"><h3>Automatic Request Assignment</h3><p>When enabled, client requests that remain unassigned for 24 hours are checked hourly and assigned to a staff member with the fewest open tasks. Ties go to the person assigned least recently. The system assigns the first project step and records the assignment in the activity log. Assignment stays manual by default.</p><form class="client-desk-message-form" data-action="automatic-assignment"><label class="client-desk-checkline"><input type="checkbox" name="enabled" ' + (enabled ? 'checked' : '') + '><span>Enable the 24-hour fair assignment fallback</span></label><p class="client-desk-footnote">' + (enabled ? 'Automatic assignment is enabled.' : 'Automatic assignment is disabled. Supabase scheduled jobs must be available before enabling it.') + '</p><button class="btn ghost" type="submit">Save Assignment Setting</button><p class="client-desk-form-status" data-portal-status aria-live="polite"></p></form></section>';
  }

  function renderQuoteBuilder(project) {
    return '<details><summary>Prepare Quote and Payment Schedule</summary><form class="client-desk-message-form" data-action="quote" data-project="' + escapeHtml(project.id) + '"><div class="field"><label class="client-desk-label">Scope</label><textarea name="scope" required maxlength="5000"></textarea></div><div class="field"><label class="client-desk-label">Deliverables</label><textarea name="deliverables" required maxlength="3000"></textarea></div><div class="field"><label class="client-desk-label">Exclusions and third-party costs</label><textarea name="exclusions" maxlength="3000"></textarea></div><div class="client-desk-field-grid"><div class="field"><label class="client-desk-label">Quote total (ZAR)</label><input name="total" type="number" min="0.01" step="0.01" required></div><div class="field"><label class="client-desk-label">Quote valid until</label><input name="valid_until" type="date" required></div></div><h4>Payment milestones</h4><div data-milestone-list><div class="client-desk-field-grid" data-milestone-row><div class="field"><label class="client-desk-label">Milestone name</label><input name="milestone_description" required maxlength="240" placeholder="For example: Project deposit"></div><div class="field"><label class="client-desk-label">Amount (ZAR)</label><input name="milestone_amount" type="number" min="0.01" step="0.01" required></div><div class="field"><label class="client-desk-label">Payment due</label><input name="milestone_due" type="date" required></div><div class="field"><label class="client-desk-label">Schedule invoice email</label><input name="milestone_send" type="datetime-local" required></div><button class="btn ghost" type="button" data-action="remove-milestone" aria-label="Remove payment milestone">Remove</button></div></div><button class="btn ghost" type="button" data-action="add-milestone">Add payment milestone</button><label class="client-desk-checkline"><input name="confirm" type="checkbox" required><span>Confirm that the scope, total, dates, and payment milestones are clear and add up to the quoted total.</span></label><button class="btn" type="submit">Send quote for client approval</button></form></details>';
  }

  function queueProgressRefresh() {
    if (!activeProfile) return;
    window.clearTimeout(progressRefreshTimer);
    progressRefreshTimer = window.setTimeout(async function () {
      progressRefreshTimer = null;
      try {
        await loadWorkspace();
      } catch (error) {
        setStatus(error.message || 'Live project updates could not be loaded. Refresh to try again.', true);
      }
    }, 250);
  }

  function subscribeProgressUpdates() {
    if (!client || progressChannel) return;
    progressChannel = client.channel('client-desk-progress')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_steps' }, queueProgressRefresh)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'project_events' }, queueProgressRefresh)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'team_messages' }, queueProgressRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'staff_payment_disputes' }, queueProgressRefresh)
      .subscribe(function (status) {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setStatus('Live updates are temporarily unavailable. Use Refresh to check for project changes.', true);
        }
      });
  }

  function unsubscribeProgressUpdates() {
    window.clearTimeout(progressRefreshTimer);
    progressRefreshTimer = null;
    if (client && progressChannel) client.removeChannel(progressChannel);
    progressChannel = null;
  }

  async function loadWorkspace() {
    var profileResult = await client.from('client_profiles').select('id,display_name,role').eq('id', activeProfile.id).single();
    if (profileResult.error) throw profileResult.error;
    activeProfile = Object.assign({}, profileResult.data, { email: activeProfile.email });
    if (activeProfile.role === 'deleted') {
      renderPendingDeletion();
      return;
    }
    var requestedPage = new URLSearchParams(window.location.search).get('portalPage');
    currentPortalPage = portalPageAllowed(requestedPage, activeProfile.role) ? requestedPage : 'dashboard';
    var projectResult = await client.from('projects').select('*').order('updated_at', { ascending: false });
    if (projectResult.error) throw projectResult.error;
    projectCache = projectResult.data || [];
    var ids = projectCache.map(function (project) { return project.id; });
    relatedData = { checklist: [], messages: [], teamMessages: [], teamAttachments: [], teamMentions: [], paymentDisputes: [], invoices: [], quotes: [], events: [], files: [], profiles: [], providers: [], freelancers: [], teamAssignments: [], stages: [], steps: [], automaticAssignmentEnabled: false };
    if (ids.length) {
      var queries = await Promise.all([
        client.from('project_checklist').select('*').in('project_id', ids).order('position'),
        client.from('project_messages').select('*').in('project_id', ids).order('created_at'),
        client.from('invoices').select('*').in('project_id', ids).order('created_at'),
        client.from('quotes').select('*').in('project_id', ids).order('version', { ascending: false }),
        client.from('project_events').select('*').in('project_id', ids).order('created_at'),
        client.from('project_files').select('*').in('project_id', ids).order('created_at'),
        client.from('project_team_members').select('project_id,user_id').in('project_id', ids),
        client.from('project_stages').select('*').in('project_id', ids).order('position'),
        client.from('project_steps').select('*').in('project_id', ids).order('position')
      ]);
      var names = ['checklist', 'messages', 'invoices', 'quotes', 'events', 'files', 'teamAssignments', 'stages', 'steps'];
      queries.forEach(function (result, index) {
        if (result.error) throw result.error;
        relatedData[names[index]] = result.data || [];
      });
      await Promise.all(relatedData.files.map(async function (file) {
        var signed = await client.storage.from('client-project-files').createSignedUrl(file.storage_path, 300);
        file.signed_url = signed.error ? '' : signed.data.signedUrl;
      }));
    }
    if (activeProfile.role === 'owner') {
      var profiles = await client.from('client_profiles').select('id,email,display_name,role,created_at');
      if (profiles.error) throw profiles.error;
      relatedData.profiles = profiles.data || [];
      relatedData.freelancers = relatedData.profiles.filter(function (profile) { return profile.role === 'freelancer'; });
      var setting = await client.from('client_desk_settings').select('automatic_assignment_enabled').eq('setting_key', 'portal').single();
      if (setting.error) throw setting.error;
      relatedData.automaticAssignmentEnabled = setting.data.automatic_assignment_enabled;
    }
    if (activeProfile.role === 'owner' || activeProfile.role === 'freelancer') {
      var directory = await client.rpc('get_team_directory');
      if (directory.error) throw directory.error;
      relatedData.teamDirectory = directory.data || [];
      var teamMessages = await client.from('team_messages').select('id,author_id,recipient_id,author_display_name,body,created_at').order('created_at', { ascending: false }).limit(200);
      if (teamMessages.error) throw teamMessages.error;
      relatedData.teamMessages = (teamMessages.data || []).reverse();
      var mentions = await client.from('team_message_mentions').select('id,message_id,author_display_name,message_preview,created_at,read_at').order('created_at', { ascending: false }).limit(100);
      if (mentions.error) throw mentions.error;
      relatedData.teamMentions = mentions.data || [];
      var disputes = await client.from('staff_payment_disputes').select('*').order('created_at', { ascending: false }).limit(100);
      if (disputes.error) throw disputes.error;
      relatedData.paymentDisputes = disputes.data || [];
      var messageIds = relatedData.teamMessages.map(function (message) { return message.id; });
      if (messageIds.length) {
        var attachments = await client.from('team_message_attachments').select('id,message_id,storage_path,file_name,content_type,size_bytes,expires_at').in('message_id', messageIds).gt('expires_at', new Date().toISOString()).order('created_at');
        if (attachments.error) throw attachments.error;
        relatedData.teamAttachments = attachments.data || [];
        await Promise.all(relatedData.teamAttachments.map(async function (attachment) {
          var remainingSeconds = Math.floor((new Date(attachment.expires_at).getTime() - Date.now()) / 1000);
          if (remainingSeconds < 1) return;
          var signed = await client.storage.from('team-message-attachments').createSignedUrl(attachment.storage_path, Math.min(300, remainingSeconds));
          if (signed.error) throw signed.error;
          attachment.signed_url = signed.data.signedUrl;
        }));
      }
    }
    var providersQuery = client.from('payment_providers').select('provider,label,is_enabled,public_instructions');
    if (activeProfile.role !== 'owner') providersQuery = providersQuery.eq('is_enabled', true);
    var providers = await providersQuery;
    if (!providers.error) relatedData.providers = providers.data || [];
    renderDashboard();
  }

  function currentWeekStart() {
    var start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (start.getDay() + 6) % 7);
    return start;
  }

  function staffActivityMetrics(userId) {
    var steps = (relatedData.steps || []).filter(function (step) { return step.owner_id === userId; });
    var completed = steps.filter(function (step) { return step.status === 'done' && step.completed_at; });
    var weekStart = currentWeekStart();
    var completedThisWeek = completed.filter(function (step) { return new Date(step.completed_at) >= weekStart; });
    var tasksWithDueDate = completed.filter(function (step) { return step.due_at; });
    var onTime = tasksWithDueDate.filter(function (step) { return new Date(step.completed_at) <= new Date(step.due_at); });
    return {
      assigned: steps.length,
      open: steps.filter(function (step) { return step.status !== 'done'; }),
      inReview: steps.filter(function (step) { return step.status === 'in_review'; }).length,
      overdue: steps.filter(function (step) { return step.status !== 'done' && step.due_at && new Date(step.due_at) < new Date(); }).length,
      completedThisWeek: completedThisWeek.length,
      onTimeRate: tasksWithDueDate.length ? Math.round(onTime.length / tasksWithDueDate.length * 100) : null,
      revisionFeedback: steps.filter(function (step) { return step.status !== 'done' && Boolean(step.review_feedback); }).length
    };
  }

  function renderPaymentDisputeForm() {
    return '<section class="client-desk-card"><h3>Raise a Payment Query</h3><p class="client-desk-footnote">Record the payment period, reference, amount in question, and details. This logs a query for management; it does not calculate or change pay.</p><form class="client-desk-message-form" data-action="payment-dispute"><div class="client-desk-field-grid"><div class="field"><label class="client-desk-label" for="dispute-period-start">Period start</label><input id="dispute-period-start" name="period_start" type="date" required></div><div class="field"><label class="client-desk-label" for="dispute-period-end">Period end</label><input id="dispute-period-end" name="period_end" type="date" required></div><div class="field"><label class="client-desk-label" for="dispute-reference">Payment reference (optional)</label><input id="dispute-reference" name="payment_reference" maxlength="120"></div><div class="field"><label class="client-desk-label" for="dispute-amount">Amount in question (ZAR, optional)</label><input id="dispute-amount" name="amount" type="number" min="0.01" step="0.01"></div></div><label class="client-desk-label" for="dispute-details">What should management review?</label><textarea id="dispute-details" name="issue_details" maxlength="3000" required></textarea><button class="btn" type="submit">Submit Payment Query</button><p class="client-desk-form-status" data-portal-status aria-live="polite"></p></form></section>';
  }

  function renderPaymentDisputes(owner) {
    var disputes = relatedData.paymentDisputes || [];
    if (!disputes.length) return '<p class="client-desk-empty">There are no payment queries on record.</p>';
    return disputes.map(function (dispute) {
      var staff = (relatedData.profiles || []).find(function (profile) { return profile.id === dispute.employee_id; });
      var displayName = owner ? (staff ? staff.display_name || staff.email : 'Staff member') : 'Your payment query';
      var amount = dispute.amount_claimed_minor == null ? 'Not specified' : escapeHtml(money(dispute.amount_claimed_minor, dispute.currency));
      var resolution = dispute.resolution_note ? '<p><strong>Management note:</strong> ' + escapeHtml(dispute.resolution_note) + '</p>' : '';
      var ownerTools = owner && dispute.status !== 'resolved'
        ? '<form class="client-desk-message-form" data-action="payment-dispute-review" data-dispute="' + escapeHtml(dispute.id) + '"><label class="client-desk-label" for="dispute-note-' + escapeHtml(dispute.id) + '">Management note</label><textarea id="dispute-note-' + escapeHtml(dispute.id) + '" name="resolution_note" maxlength="2000" required></textarea><label class="client-desk-label" for="dispute-status-' + escapeHtml(dispute.id) + '">Update status</label><select id="dispute-status-' + escapeHtml(dispute.id) + '" name="status"><option value="under_review">Under Review</option><option value="resolved">Resolved</option></select><button class="btn ghost" type="submit">Save Review</button></form>'
        : '';
      return '<article class="client-desk-card client-desk-dispute"><div class="client-desk-section-head"><h4>' + escapeHtml(displayName) + '</h4><span class="client-desk-status" data-status="' + escapeHtml(dispute.status) + '">' + escapeHtml(dispute.status === 'under_review' ? 'Under Review' : dispute.status === 'resolved' ? 'Resolved' : 'Open') + '</span></div><p><strong>Payment period:</strong> ' + escapeHtml(dateLabel(dispute.period_start)) + ' – ' + escapeHtml(dateLabel(dispute.period_end)) + '</p><p><strong>Reference:</strong> ' + escapeHtml(dispute.payment_reference || 'Not provided') + ' / <strong>Amount in question:</strong> ' + amount + '</p><p>' + escapeHtml(dispute.issue_details) + '</p>' + resolution + '<p class="client-desk-footnote">Submitted ' + escapeHtml(dateLabel(dispute.created_at)) + (dispute.updated_at !== dispute.created_at ? ' / Updated ' + escapeHtml(dateLabel(dispute.updated_at)) : '') + '</p>' + ownerTools + '</article>';
    }).join('');
  }

  function renderStaffAnalytics() {
    var metrics = staffActivityMetrics(activeProfile.id);
    var activity = (relatedData.events || []).filter(function (item) {
      return item.actor_id === activeProfile.id;
    }).sort(function (left, right) { return new Date(right.created_at) - new Date(left.created_at); }).slice(0, 10);
    var activityMarkup = activity.length
      ? '<ol class="client-desk-timeline">' + activity.map(function (item) {
        return '<li><strong>' + escapeHtml(item.title) + '</strong><br>' + escapeHtml(item.description || '') + '<br><small>' + escapeHtml(dateLabel(item.created_at)) + '</small></li>';
      }).join('') + '</ol>'
      : '<p class="client-desk-footnote">Your project activity will appear here as you update assigned work.</p>';
    var disputeCount = (relatedData.paymentDisputes || []).filter(function (dispute) { return dispute.status !== 'resolved'; }).length;
    return '<div class="client-desk-page-heading"><div><p class="client-desk-kicker">Your work and records</p><h2>Performance</h2><p class="client-desk-footnote">A factual summary of assigned steps and recorded project activity. Pay is not calculated in this portal yet.</p></div></div><div class="client-desk-summary-strip"><div><span>Open Tasks</span><strong>' + metrics.open.length + '</strong></div><div><span>Completed This Week</span><strong>' + metrics.completedThisWeek + '</strong></div><div><span>On-Time Rate</span><strong>' + (metrics.onTimeRate == null ? 'Not available' : metrics.onTimeRate + '%') + '</strong></div><div><span>Overdue Tasks</span><strong>' + metrics.overdue + '</strong></div></div><section class="client-desk-card"><h3>Your Recorded Activity</h3>' + activityMarkup + '<p class="client-desk-footnote">' + metrics.inReview + ' steps under review / ' + metrics.revisionFeedback + ' active steps with revision feedback.</p></section><section class="client-desk-card"><h3>Payment Queries</h3><p class="client-desk-footnote">' + disputeCount + ' unresolved ' + (disputeCount === 1 ? 'query' : 'queries') + '.</p>' + renderPaymentDisputeForm() + renderPaymentDisputes(false) + '</section>';
  }

  function renderManagementAnalytics() {
    var profiles = relatedData.profiles || [];
    var staff = (relatedData.freelancers || []).map(function (profile) {
      return { profile: profile, metrics: staffActivityMetrics(profile.id) };
    }).sort(function (left, right) {
      return right.metrics.completedThisWeek - left.metrics.completedThisWeek
        || (right.metrics.onTimeRate || 0) - (left.metrics.onTimeRate || 0);
    });
    var now = new Date();
    var thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);
    var customers = profiles.filter(function (profile) { return profile.role === 'customer'; });
    var newCustomers = customers.filter(function (profile) { return new Date(profile.created_at) >= thirtyDaysAgo; }).length;
    var invoices = relatedData.invoices || [];
    var paid = invoices.filter(function (invoice) { return invoice.status === 'paid'; });
    var outstanding = invoices.filter(function (invoice) { return invoice.status === 'sent' || invoice.status === 'overdue'; });
    function currencyTotals(rows) {
      return rows.reduce(function (totals, invoice) {
        var currency = String(invoice.currency || 'ZAR').toUpperCase();
        totals[currency] = (totals[currency] || 0) + Number(invoice.amount_minor || 0);
        return totals;
      }, {});
    }
    function formatCurrencyTotals(totals) {
      var currencies = Object.keys(totals).sort();
      return currencies.length ? currencies.map(function (currency) { return money(totals[currency], currency); }).join(' / ') : money(0, 'ZAR');
    }
    var paidTotal = currencyTotals(paid);
    var outstandingTotal = currencyTotals(outstanding);
    var quotes = relatedData.quotes || [];
    var pendingQuotes = quotes.filter(function (quote) { return quote.status === 'sent'; }).length;
    var decidedQuotes = quotes.filter(function (quote) { return quote.status === 'accepted' || quote.status === 'declined'; });
    var quoteAcceptance = decidedQuotes.length
      ? Math.round(decidedQuotes.filter(function (quote) { return quote.status === 'accepted'; }).length / decidedQuotes.length * 100)
      : null;
    var weeklyCompletions = (relatedData.steps || []).filter(function (step) {
      return step.status === 'done' && step.completed_at && new Date(step.completed_at) >= currentWeekStart();
    }).length;
    var openSteps = (relatedData.steps || []).filter(function (step) { return step.status !== 'done'; });
    var unassigned = openSteps.filter(function (step) { return !step.owner_id; }).length;
    var overdueInvoices = outstanding.filter(function (invoice) { return invoice.status === 'overdue'; }).length;
    var unresolvedDisputes = (relatedData.paymentDisputes || []).filter(function (dispute) { return dispute.status !== 'resolved'; }).length;
    var leaders = staff.length
      ? '<div class="client-desk-table-wrap"><table class="client-desk-table"><thead><tr><th>Staff Member</th><th>Completed This Week</th><th>On-Time Rate</th><th>Open Tasks</th><th>Overdue</th><th>Payment Queries</th></tr></thead><tbody>' + staff.map(function (entry, index) {
        var unresolved = (relatedData.paymentDisputes || []).filter(function (dispute) { return dispute.employee_id === entry.profile.id && dispute.status !== 'resolved'; }).length;
        return '<tr><td>' + escapeHtml(entry.profile.display_name || entry.profile.email) + (index === 0 && entry.metrics.completedThisWeek > 0 ? '<br><small>Highest completed task count this week</small>' : '') + '</td><td>' + entry.metrics.completedThisWeek + '</td><td>' + (entry.metrics.onTimeRate == null ? 'Not available' : entry.metrics.onTimeRate + '%') + '</td><td>' + entry.metrics.open.length + '</td><td>' + entry.metrics.overdue + '</td><td>' + unresolved + '</td></tr>';
      }).join('') + '</tbody></table></div>'
      : '<p class="client-desk-empty">No staff members are available for this report.</p>';
    var suggestions = [];
    if (overdueInvoices) suggestions.push(overdueInvoices + ' invoice' + (overdueInvoices === 1 ? ' is' : 's are') + ' overdue. Follow up with the client to protect cash flow.');
    if (pendingQuotes >= 3) suggestions.push(pendingQuotes + ' quotes are awaiting a decision. Schedule follow-ups before increasing advertising spend.');
    if (unassigned >= 3) suggestions.push(unassigned + ' active steps are unassigned. Assign available staff; if this remains the pattern, consider adding freelancer capacity.');
    if (newCustomers < 3) suggestions.push('Only ' + newCustomers + ' new client account' + (newCustomers === 1 ? ' was' : 's were') + ' recorded in the last 30 days. Consider a small, measurable advertising test. Lead sources are not tracked, so compare enquiries and paid invoices manually.');
    if (!suggestions.length) suggestions.push('Current workload and invoice signals are within the configured thresholds. Review these figures weekly.');
    var staffDetails = staff.map(function (entry) {
      var tasks = (relatedData.steps || []).filter(function (step) { return step.owner_id === entry.profile.id; });
      var taskList = tasks.length
        ? '<ul class="client-desk-checklist">' + tasks.map(function (step) {
          var project = projectCache.find(function (item) { return item.id === step.project_id; });
          return '<li><span><strong>' + escapeHtml(step.title) + '</strong><br>' + escapeHtml(project ? project.title : 'Project') + ' / ' + escapeHtml(stepStatusLabel(step.status)) + (step.due_at ? ' / Due ' + escapeHtml(dateLabel(step.due_at)) : '') + '</span></li>';
        }).join('') + '</ul>'
        : '<p class="client-desk-footnote">No project steps are currently assigned.</p>';
      return '<details class="client-desk-card"><summary><strong>' + escapeHtml(entry.profile.display_name || entry.profile.email) + '</strong> / ' + entry.metrics.completedThisWeek + ' completed this week</summary><div class="client-desk-summary-strip"><div><span>Assigned</span><strong>' + entry.metrics.assigned + '</strong></div><div><span>Active</span><strong>' + entry.metrics.open.length + '</strong></div><div><span>Under Review</span><strong>' + entry.metrics.inReview + '</strong></div><div><span>Revision Feedback</span><strong>' + entry.metrics.revisionFeedback + '</strong></div></div>' + taskList + '</details>';
    }).join('');
    var staffRows = '<section class="client-desk-card"><h3>Staff Delivery Activity</h3><p class="client-desk-footnote">Ranked by completed task count this week, then on-time rate across completed assigned tasks. This is a delivery signal, not a complete employee rating or pay calculation.</p>' + leaders + '</section><section class="client-desk-card"><h3>Individual Staff Activity</h3>' + (staffDetails || '<p class="client-desk-footnote">Individual activity will appear when staff are assigned project steps.</p>') + '</section>';
    return '<div class="client-desk-page-heading"><div><p class="client-desk-kicker">Business performance</p><h2>Analytics &amp; Reports</h2><p class="client-desk-footnote">Figures are calculated from current project, invoice, quote, and account records. Revenue is not attributed to individual employees.</p></div></div><div class="client-desk-summary-strip"><div><span>Client Accounts</span><strong>' + customers.length + '</strong></div><div><span>New Clients (30 Days)</span><strong>' + newCustomers + '</strong></div><div><span>Tasks Completed This Week</span><strong>' + weeklyCompletions + '</strong></div><div><span>Active Projects</span><strong>' + projectCache.filter(function (project) { return ['complete', 'paused'].indexOf(project.status) === -1; }).length + '</strong></div></div><div class="client-desk-summary-strip"><div><span>Payments Received</span><strong>' + escapeHtml(formatCurrencyTotals(paidTotal)) + '</strong></div><div><span>Outstanding Invoices</span><strong>' + escapeHtml(formatCurrencyTotals(outstandingTotal)) + '</strong></div><div><span>Overdue Invoices</span><strong>' + overdueInvoices + '</strong></div><div><span>Quote Acceptance</span><strong>' + (quoteAcceptance == null ? 'Not available' : quoteAcceptance + '%') + '</strong></div></div><section class="client-desk-card"><h3>Suggested Actions</h3><ul>' + suggestions.map(function (suggestion) { return '<li>' + escapeHtml(suggestion) + '</li>'; }).join('') + '</ul></section>' + staffRows + '<section class="client-desk-card"><h3>Employee Payment Queries</h3><p class="client-desk-footnote">' + unresolvedDisputes + ' unresolved ' + (unresolvedDisputes === 1 ? 'query' : 'queries') + '. Review each claim and record a written decision.</p>' + renderPaymentDisputes(true) + '</section>';
  }

  function renderDashboard() {
    var openProjectIds = Array.prototype.map.call(portalRoot.querySelectorAll('details[data-project-details][open]'), function (element) {
      return element.dataset.projectId;
    });
    var openUiStates = Array.prototype.map.call(portalRoot.querySelectorAll('details[data-ui-state][open]'), function (element) {
      return element.dataset.uiState;
    });
    var owner = activeProfile.role === 'owner';
    var freelancer = activeProfile.role === 'freelancer';
    var emptyHeading = owner ? 'No Projects Require Review' : freelancer ? 'No Projects Assigned' : 'No Active Projects';
    var emptyMessage = owner ? 'New client requests will appear here for review.' : freelancer ? 'Projects assigned to you will appear here.' : 'Submit a project request to begin a conversation with FixerCtrl.';
    var displayName = activeProfile.display_name || activeProfile.email || 'Client';
    var attention = renderAttentionPanel();
    var clientWidget = !owner && !freelancer
      ? '<section class="client-desk-dashboard-widget" data-dashboard-widget="project-progress"><div class="client-desk-section-head"><h2>Project Progress</h2><a href="#portal-projects" data-portal-page="projects">View Projects</a></div>' + (projectCache.length ? projectCache.slice(0, 1).map(function (project) {
        var overview = projectOverview(project);
        return '<p><strong>' + escapeHtml(project.title) + '</strong> / ' + projectProgress(project.id) + '% complete</p><p class="client-desk-footnote">Next milestone: ' + escapeHtml(overview.nextMilestone) + '</p><a href="#portal-projects" data-portal-page="projects" data-open-project="' + escapeHtml(project.id) + '" data-open-section="deliverables">View project tracker</a>';
      }).join('') : '<p class="client-desk-footnote">Your project updates will appear here.</p>') + '</section>'
      : '';
    var clientApprovals = !owner && !freelancer
      ? (relatedData.steps || []).filter(function (step) { return step.status === 'in_review'; }).slice(0, 2).map(function (step) {
        return '<p>' + escapeHtml(step.title) + ' <a href="#portal-projects" data-portal-page="projects" data-open-project="' + escapeHtml(step.project_id) + '" data-open-section="deliverables" data-open-step="' + escapeHtml(step.id) + '">Review deliverable</a></p>';
      }).join('')
      : '';
    var latestEvent = notificationEvents()[0];
    var latestProject = latestEvent && projectCache.find(function (project) { return project.id === latestEvent.project_id; });
    var clientUpdates = !owner && !freelancer
      ? '<section class="client-desk-dashboard-widget" data-dashboard-widget="latest-update"><h2>Latest Update</h2>' + (latestEvent && latestProject ? '<p><strong>' + escapeHtml(latestEvent.title) + '</strong></p><p class="client-desk-footnote">' + escapeHtml(latestProject.title) + ' / ' + escapeHtml(dateLabel(latestEvent.created_at)) + '</p><a href="#portal-projects" data-portal-page="projects" data-open-project="' + escapeHtml(latestProject.id) + '" data-open-section="deliverables">View project tracker</a>' : '<p class="client-desk-footnote">Project updates will appear here.</p>') + '</section>'
      : '';
    var clientApprovalWidget = !owner && !freelancer
      ? '<section class="client-desk-dashboard-widget" data-dashboard-widget="upcoming-approvals"><div class="client-desk-section-head"><h2>Upcoming Approvals</h2><a href="#portal-projects" data-portal-page="projects">View</a></div>' + (clientApprovals || '<p class="client-desk-footnote">No approvals are waiting for you.</p>') + '</section>'
      : '';
    var staffWidget = freelancer
      ? '<section class="client-desk-dashboard-widget" data-dashboard-widget="today-tasks"><div class="client-desk-section-head"><h2>Today’s Tasks</h2><a href="#portal-tasks" data-portal-page="tasks">View Tasks</a></div><p>' + (relatedData.steps || []).filter(function (step) { return step.owner_id === activeProfile.id && step.status !== 'done' && step.due_at && new Date(step.due_at).toDateString() === new Date().toDateString(); }).length + ' tasks due today</p><p class="client-desk-footnote">Assigned tasks are listed in My Tasks.</p></section>' +
        '<section class="client-desk-dashboard-widget" data-dashboard-widget="deadlines-week"><h2>Deadlines This Week</h2><p>' + (relatedData.steps || []).filter(function (step) {
          if (step.owner_id !== activeProfile.id || step.status === 'done' || !step.due_at) return false;
          var days = (new Date(step.due_at).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86400000;
          return days >= 0 && days < 7;
        }).length + ' assigned tasks</p></section>' +
        '<section class="client-desk-dashboard-widget" data-dashboard-widget="earnings-period"><h2>Earnings This Period</h2><p class="client-desk-footnote">Earnings are not available in the portal yet.</p></section>'
      : '';
    var ownerWidget = owner
      ? '<section class="client-desk-dashboard-widget" data-dashboard-widget="invoice-overview"><h2>Invoice Overview</h2><p>' + (relatedData.invoices || []).filter(function (invoice) { return ['sent', 'overdue'].indexOf(invoice.status) !== -1; }).length + ' invoices awaiting payment</p><p class="client-desk-footnote">Expense and cash-flow data are not available in the portal yet.</p></section>' +
        '<section class="client-desk-dashboard-widget" data-dashboard-widget="team-workload"><div class="client-desk-section-head"><h2>Team Workload</h2><a href="#portal-team" data-portal-page="team">View Team</a></div><p>' + (relatedData.teamAssignments || []).length + ' project assignments</p></section>'
      : '';
    var clientTools = !owner && !freelancer
      ? renderAccountDeletion()
      : '';
    var roleGuidance = freelancer
      ? '<details class="client-desk-dashboard-tools"><summary>Access and Permissions</summary><p>You can view assigned projects, share client-visible progress updates, and add project files. Invoices, payment settings, private notes, and unassigned projects are not available to staff accounts.</p></details>'
      : !owner
        ? '<details class="client-desk-dashboard-tools"><summary>Service Price Guide</summary><ul><li>Landing page: R1,500–R3,000</li><li>Up to five website pages: R3,500–R7,500</li><li>Website updates: R250 per hour</li><li>Setup: from R500</li><li>Features: from R800</li></ul><p class="client-desk-footnote">IT and security work is quoted after review. These prices are estimates, not a quote. <a href="#/freelancer">View service details</a></p></details>'
        : '';
    var dashboardContent = '<div class="client-desk-dashboard-heading"><div><h2>Welcome back, ' + escapeHtml(displayName) + '</h2><p class="client-desk-footnote">' + escapeHtml(activeProfile.email) + '</p></div><button class="btn ghost" type="button" data-action="refresh" aria-label="Refresh workspace" title="Refresh workspace">Refresh</button></div>' +
      attention + renderSummaryStrip() + '<div class="client-desk-dashboard-widgets">' + clientWidget + clientApprovalWidget + clientUpdates + staffWidget + ownerWidget + '</div>' +
      (freelancer ? '<a class="btn" href="#portal-tasks" data-portal-page="tasks">Open My Tasks</a>' : owner ? '<a class="btn" href="#portal-projects" data-portal-page="projects">Review Projects</a>' : '<button class="btn" type="button" data-action="new-request">Submit Project Request</button><div class="client-desk-dashboard-tools">' + buildRequestForm() + '</div>') +
      '<p class="client-desk-form-status" data-portal-status aria-live="polite"></p>';
    var projectPageContent = '<div class="client-desk-page-heading"><div><p class="client-desk-kicker">' + (freelancer ? 'Assigned work' : 'Project workspace') + '</p><h2>' + (freelancer ? 'My Tasks' : 'Projects') + '</h2><p class="client-desk-footnote">' + (freelancer ? 'Open an assigned project to update work, due dates, and client progress.' : owner ? 'Review incoming requests, coordinate delivery, and keep each client informed.' : 'Track progress, open deliverables, and find your project updates.') + '</p></div>' + (!owner && !freelancer ? '<button class="btn" type="button" data-action="new-request">Submit Project Request</button>' : '') + '</div><p class="client-desk-form-status" data-portal-status aria-live="polite"></p><div id="clientDeskProjects">' + (projectCache.length ? projectCache.map(renderProject).join('') : '<div class="client-desk-empty"><h3>' + emptyHeading + '</h3><p>' + emptyMessage + '</p></div>') + '</div><p class="client-desk-search-empty" data-portal-search-empty hidden>No matching projects. Try another search.</p>';
    var pageContent = dashboardContent;
    if (currentPortalPage === 'projects' || currentPortalPage === 'tasks') pageContent = projectPageContent;
    else if (currentPortalPage === 'communication') pageContent = '<div class="client-desk-page-heading"><div><p class="client-desk-kicker">Staff workspace</p><h2>Team Communication</h2><p class="client-desk-footnote">Coordinate work in the group channel or continue a private conversation with a colleague.</p></div></div>' + renderTeamCommunication();
    else if (currentPortalPage === 'calendar') pageContent = '<div class="client-desk-page-heading"><div><p class="client-desk-kicker">Delivery schedule</p><h2>Calendar</h2><p class="client-desk-footnote">Due dates from scheduled project steps, in one place.</p></div></div>' + renderCalendar();
    else if (currentPortalPage === 'team' && owner) pageContent = '<div class="client-desk-page-heading"><div><p class="client-desk-kicker">People and access</p><h2>Team Management</h2><p class="client-desk-footnote">Manage staff portal access and assign people to project teams.</p></div></div>' + renderFreelancerAccounts() + '<p><a href="#portal-communication" data-portal-page="communication">Open Team Communication</a></p>';
    else if (currentPortalPage === 'clients' && owner) pageContent = '<div class="client-desk-page-heading"><div><p class="client-desk-kicker">Client relationships</p><h2>Clients</h2><p class="client-desk-footnote">Find a client and open their project workspace.</p></div></div>' + ((relatedData.profiles || []).filter(function (profile) { return profile.role === 'customer'; }).map(function (profile) {
      var projects = projectCache.filter(function (project) { return project.customer_id === profile.id; });
      return '<article class="client-desk-card"><h3>' + escapeHtml(profile.display_name || profile.email) + '</h3><p class="client-desk-footnote">' + escapeHtml(profile.email) + ' / ' + projects.length + ' projects</p>' + projects.map(function (project) { return '<a href="#portal-projects" data-portal-page="projects" data-open-project="' + escapeHtml(project.id) + '">' + escapeHtml(project.title) + '</a>'; }).join('<br>') + '</article>';
    }).join('') || '<p class="client-desk-empty">Client accounts and projects will appear here.</p>');
    else if (currentPortalPage === 'finance' && owner) pageContent = '<div class="client-desk-page-heading"><div><p class="client-desk-kicker">Payments and invoices</p><h2>Finance</h2><p class="client-desk-footnote">Review outstanding invoices and payment-provider settings.</p></div></div>' + renderPaymentSettings() + '<section class="client-desk-finance-list"><h3>Project Invoices</h3>' + projectCache.map(function (project) { return '<article class="client-desk-card"><h4>' + escapeHtml(project.title) + '</h4>' + renderInvoices(project) + '</article>'; }).join('') + '</section>';
    else if (currentPortalPage === 'analytics' && owner) pageContent = renderManagementAnalytics();
    else if (currentPortalPage === 'performance' && freelancer) pageContent = renderStaffAnalytics();
    else if (currentPortalPage === 'settings' && owner) pageContent = '<div class="client-desk-page-heading"><div><p class="client-desk-kicker">Workspace preferences</p><h2>Settings</h2><p class="client-desk-footnote">Control when the system may assign unclaimed requests automatically.</p></div></div>' + renderAutomaticAssignmentSettings() + renderDashboardCustomization();
    else if (currentPortalPage === 'documents') pageContent = '<div class="client-desk-page-heading"><div><p class="client-desk-kicker">Shared files</p><h2>Documents</h2><p class="client-desk-footnote">Files shared on your projects.</p></div></div>' + projectCache.map(function (project) { return '<article class="client-desk-card"><h3>' + escapeHtml(project.title) + '</h3>' + renderFiles(project) + '</article>'; }).join('') || '<p class="client-desk-empty">No project documents are available yet.</p>';
    else if (currentPortalPage === 'messages' && !owner && !freelancer) pageContent = '<div class="client-desk-page-heading"><div><p class="client-desk-kicker">Project conversations</p><h2>Messages</h2><p class="client-desk-footnote">Messages are kept with the project they relate to.</p></div></div>' + projectCache.map(function (project) { return '<article class="client-desk-card"><h3>' + escapeHtml(project.title) + '</h3>' + renderMessages(project) + '</article>'; }).join('') || '<p class="client-desk-empty">Project messages will appear here when available.</p>';
    else if (currentPortalPage === 'billing' && !owner && !freelancer) pageContent = '<div class="client-desk-page-heading"><div><p class="client-desk-kicker">Payment clarity</p><h2>Invoices &amp; Payments</h2><p class="client-desk-footnote">Review approved quotes, payment dates, and invoice status.</p></div></div>' + projectCache.map(function (project) { return '<article class="client-desk-card"><h3>' + escapeHtml(project.title) + '</h3>' + renderQuotes(project) + renderInvoices(project) + '</article>'; }).join('') || '<p class="client-desk-empty">Quotes and invoices will appear here.</p>';
    else if (currentPortalPage === 'profile') pageContent = '<div class="client-desk-page-heading"><div><p class="client-desk-kicker">Account</p><h2>Profile</h2><p class="client-desk-footnote">' + escapeHtml(activeProfile.display_name || activeProfile.email) + ' / ' + escapeHtml(activeProfile.email) + '</p></div></div>' + renderDashboardCustomization() + roleGuidance + clientTools;
    var content = '<div id="clientDeskHome" class="client-desk-workspace"><div class="client-desk-main">' + pageContent + '</div></div>';
    renderShell(content, activeProfile);
    applyDashboardPreferences();
    openProjectIds.forEach(function (projectId) {
      var details = Array.prototype.find.call(portalRoot.querySelectorAll('details[data-project-details]'), function (element) {
        return element.dataset.projectId === projectId;
      });
      if (details) details.open = true;
    });
    openUiStates.forEach(function (state) {
      var details = Array.prototype.find.call(portalRoot.querySelectorAll('details[data-ui-state]'), function (element) {
        return element.dataset.uiState === state;
      });
      if (details) details.open = true;
    });
    if (pendingProjectOpen) {
      var selectedProject = portalRoot.querySelector('[data-project-id="' + pendingProjectOpen + '"]');
      if (selectedProject) {
        selectedProject.open = true;
        if (pendingProjectSection) {
          var selectedSection = selectedProject.querySelector('[data-ui-state="project-' + pendingProjectOpen + '-' + pendingProjectSection + '"]');
          if (selectedSection) selectedSection.open = true;
        }
        if (pendingProjectStep) {
          var selectedStep = selectedProject.querySelector('[data-step-id="' + pendingProjectStep + '"]');
          if (selectedStep) selectedStep.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else selectedProject.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      pendingProjectOpen = '';
      pendingProjectSection = '';
      pendingProjectStep = '';
    }
    if (pendingTeamMessageOpen) {
      var selectedMessage = portalRoot.querySelector('#teamMessage-' + CSS.escape(pendingTeamMessageOpen));
      if (selectedMessage) selectedMessage.scrollIntoView({ behavior: 'smooth', block: 'center' });
      pendingTeamMessageOpen = '';
    }
    if (currentPortalPage === 'communication') {
      var messageList = portalRoot.querySelector('.client-desk-team-message-list');
      if (messageList) messageList.scrollTop = messageList.scrollHeight;
    }
  }

  async function submitRequest(form) {
    var data = new FormData(form);
    var result = await client.rpc('submit_project', {
      p_title: String(data.get('title')).trim(),
      p_service_category: String(data.get('service')),
      p_description: String(data.get('description')).trim(),
      p_preferred_date: data.get('preferred_date') || null
    });
    if (result.error) throw result.error;
    await loadWorkspace();
    setStatus('Your project request has been received. FixerCtrl will review it and follow up here.', false);
  }

  async function submitMessage(form) {
    var data = new FormData(form);
    var result = await client.from('project_messages').insert({
      project_id: form.dataset.project,
      body: String(data.get('body')).trim(),
      is_internal: activeProfile.role === 'owner' && form.querySelector('[name="internal"]') ? form.querySelector('[name="internal"]').checked : false
    });
    if (result.error) throw result.error;
    await loadWorkspace();
    setStatus('Your message has been sent.', false);
  }

  async function submitChecklistItem(form) {
    var data = new FormData(form);
    var result = await client.from('project_checklist').insert({
      project_id: form.dataset.project,
      title: String(data.get('title')).trim(),
      owner_kind: String(data.get('owner_kind')),
      is_internal: Boolean(data.get('internal')),
      due_at: data.get('due_at') ? new Date(String(data.get('due_at')) + 'T23:59:00').toISOString() : null
    });
    if (result.error) throw result.error;
    await loadWorkspace();
    setStatus('The checklist has been updated.', false);
  }

  async function submitPaymentSettings(form) {
    if (activeProfile.role !== 'owner') throw new Error('Management access is required.');
    var data = new FormData(form);
    var eftInstructions = String(data.get('eft_instructions') || '').trim();
    for (var index = 0; index < relatedData.providers.length; index++) {
      var provider = relatedData.providers[index];
      var enabled = data.has('provider_' + provider.provider);
      if (provider.provider === 'eft' && enabled && !eftInstructions) throw new Error('Enter bank transfer instructions before enabling this payment option.');
      var update = await client.from('payment_providers').update({
        is_enabled: enabled,
        public_instructions: provider.provider === 'eft' ? eftInstructions : provider.public_instructions
      }).eq('provider', provider.provider);
      if (update.error) throw update.error;
    }
    await loadWorkspace();
    setStatus('Payment settings saved.', false);
  }

  async function submitFreelancerRole(form) {
    if (activeProfile.role !== 'owner') throw new Error('Management access is required.');
    var data = new FormData(form);
    var result = await client.rpc('owner_set_freelancer_role', {
      p_user_id: data.get('user_id'),
      p_role: data.get('role')
    });
    if (result.error) throw result.error;
    await loadWorkspace();
    setStatus('Account access saved.', false);
  }

  async function submitProjectTeam(form) {
    if (activeProfile.role !== 'owner') throw new Error('Management access is required.');
    var result = await client.rpc('owner_set_project_team', {
      p_project_id: form.dataset.project,
      p_freelancer_ids: new FormData(form).getAll('freelancer')
    });
    if (result.error) throw result.error;
    await loadWorkspace();
    setStatus('Project team saved.', false);
  }

  async function submitPaymentDispute(form) {
    if (activeProfile.role !== 'freelancer') throw new Error('Staff access is required to submit a payment query.');
    var data = new FormData(form);
    var periodStart = String(data.get('period_start') || '');
    var periodEnd = String(data.get('period_end') || '');
    if (!periodStart || !periodEnd || periodEnd < periodStart) throw new Error('Enter a valid payment period.');
    var amount = String(data.get('amount') || '').trim();
    var amountMinor = amount ? Math.round(Number(amount) * 100) : null;
    if (amount && (!Number.isSafeInteger(amountMinor) || amountMinor < 1)) throw new Error('Enter a valid amount or leave it blank.');
    var result = await client.from('staff_payment_disputes').insert({
      employee_id: activeProfile.id,
      payment_reference: String(data.get('payment_reference') || '').trim() || null,
      period_start: periodStart,
      period_end: periodEnd,
      amount_claimed_minor: amountMinor,
      currency: 'ZAR',
      issue_details: String(data.get('issue_details') || '').trim()
    });
    if (result.error) throw result.error;
    await loadWorkspace();
    setStatus('Your payment query has been recorded for management review.', false);
  }

  async function reviewPaymentDispute(form) {
    if (activeProfile.role !== 'owner') throw new Error('Management access is required.');
    var data = new FormData(form);
    var result = await client.rpc('owner_review_staff_payment_dispute', {
      p_dispute_id: form.dataset.dispute,
      p_status: String(data.get('status')),
      p_resolution_note: String(data.get('resolution_note') || '').trim()
    });
    if (result.error) throw result.error;
    await loadWorkspace();
    setStatus('The payment query review has been saved and logged.', false);
  }

  async function submitTeamMessage(form) {
    if (activeProfile.role !== 'owner' && activeProfile.role !== 'freelancer') {
      throw new Error('Staff access is required to send a team message.');
    }
    var data = new FormData(form);
    var body = String(data.get('body') || '').trim();
    var file = data.get('attachment');
    var extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
    if (!body && (!file || !file.size)) throw new Error('Write a message or attach a file before sending.');
    if (file && file.size) {
      if (!extensions[file.type]) throw new Error('Choose a JPG, PNG, WebP, or PDF attachment.');
      if (file.size > 10485760) throw new Error('Choose an attachment no larger than 10 MB.');
    }
    var messageId = crypto.randomUUID();
    var path = '';
    var result = await client.from('team_messages').insert({
      id: messageId,
      author_id: activeProfile.id,
      recipient_id: form.dataset.recipient || null,
      mentioned_user_ids: form.dataset.recipient ? [] : data.getAll('mentioned_user_ids'),
      body: body || '(Attachment)'
    });
    if (result.error) throw result.error;
    if (file && file.size) {
      path = activeProfile.id + '/' + messageId + '/' + crypto.randomUUID() + '.' + extensions[file.type];
      var uploaded = await client.storage.from('team-message-attachments').upload(path, file, { contentType: file.type, upsert: false });
      if (uploaded.error) {
        await loadWorkspace();
        setStatus('Your message was sent, but the attachment could not be uploaded: ' + uploaded.error.message, true);
        return;
      }
    }
    if (path) {
      var attachment = await client.from('team_message_attachments').insert({
        message_id: messageId,
        uploaded_by: activeProfile.id,
        storage_path: path,
        file_name: file.name.slice(0, 255),
        content_type: file.type,
        size_bytes: file.size
      });
      if (attachment.error) {
        var cleanup = await client.storage.from('team-message-attachments').remove([path]);
        await loadWorkspace();
        setStatus('Your message was sent, but the attachment could not be shared.' + (cleanup.error ? ' The temporary upload also could not be removed; contact support.' : ''), true);
        return;
      }
    }
    await loadWorkspace();
    setStatus(form.dataset.recipient ? 'Your private message has been sent.' : 'Your update has been shared with the team.', false);
  }

  async function submitAutomaticAssignment(form) {
    if (activeProfile.role !== 'owner') throw new Error('Management access is required.');
    var enabled = new FormData(form).has('enabled');
    var result = await client.rpc('owner_set_automatic_assignment', { p_enabled: enabled });
    if (result.error) throw result.error;
    await loadWorkspace();
    setStatus(enabled ? 'The 24-hour fair assignment fallback is enabled.' : 'Automatic assignment is disabled. New work will remain under manual control.', false);
  }

  async function submitFile(form) {
    var data = new FormData(form);
    var file = data.get('file');
    var extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
    if (!file || !file.size) throw new Error('Select a document to upload.');
    if (!extensions[file.type]) throw new Error('Choose a JPG, PNG, WebP, or PDF document.');
    if (file.size > 10485760) throw new Error('Choose a document no larger than 10 MB.');
    var path = form.dataset.project + '/' + crypto.randomUUID() + '.' + extensions[file.type];
    var uploaded = await client.storage.from('client-project-files').upload(path, file, { contentType: file.type, upsert: false });
    if (uploaded.error) throw uploaded.error;
    var inserted = await client.from('project_files').insert({
      project_id: form.dataset.project,
      uploaded_by: activeProfile.id,
      storage_path: path,
      file_name: file.name.slice(0, 255),
      content_type: file.type,
      size_bytes: file.size,
      is_internal: activeProfile.role === 'owner' && Boolean(data.get('internal'))
    });
    if (inserted.error) {
      await client.storage.from('client-project-files').remove([path]);
      throw inserted.error;
    }
    await loadWorkspace();
    setStatus('The document has been uploaded to this project.', false);
  }

  async function submitQuote(form) {
    var data = new FormData(form);
    var cents = Math.round(Number(data.get('total')) * 100);
    if (!Number.isSafeInteger(cents) || cents < 1) throw new Error('Enter a valid quote total.');
    var descriptions = data.getAll('milestone_description');
    var amounts = data.getAll('milestone_amount');
    var dueDates = data.getAll('milestone_due');
    var sendTimes = data.getAll('milestone_send');
    var schedule = descriptions.map(function (description, index) {
      var amountMinor = Math.round(Number(amounts[index]) * 100);
      if (!Number.isSafeInteger(amountMinor) || amountMinor < 1) throw new Error('Enter a valid amount for each payment milestone.');
      if (!dueDates[index] || !sendTimes[index]) throw new Error('Select a due date and invoice email time for every payment milestone.');
      return {
        description: String(description).trim(),
        amount_minor: String(amountMinor),
        due_at: new Date(String(dueDates[index]) + 'T12:00:00').toISOString(),
        email_send_at: new Date(String(sendTimes[index])).toISOString()
      };
    });
    var sum = schedule.reduce(function (total, item) { return total + Number(item.amount_minor); }, 0);
    if (sum !== cents) throw new Error('Payment milestone amounts must equal the quote total.');
    var quoteResult = await client.rpc('owner_create_project_quote', {
      p_project_id: form.dataset.project,
      p_scope: String(data.get('scope')).trim(),
      p_deliverables: String(data.get('deliverables')).trim(),
      p_exclusions: String(data.get('exclusions') || '').trim(),
      p_total_minor: cents,
      p_valid_until: data.get('valid_until'),
      p_schedule: schedule
    });
    if (quoteResult.error) throw quoteResult.error;
    await loadWorkspace();
    setStatus('Quote sent for client approval. The agreed invoice schedule will activate after approval.', false);
  }

  async function handleAction(event) {
    var target = event.target.closest('[data-action]');
    if (!target || !client) return;
    var action = target.dataset.action;
    try {
      if (action === 'insert-mention') {
        var mentionForm = target.closest('form[data-action="team-message"]');
        var mentionSelect = mentionForm && mentionForm.querySelector('[data-mention-select]');
        var mention = mentionSelect && (relatedData.teamDirectory || []).find(function (entry) { return entry.id === mentionSelect.value; });
        if (!mentionForm || !mention) throw new Error('Select a teammate to mention.');
        var mentionTags = mentionForm.querySelector('[data-mention-tags]');
        if (mentionForm.querySelector('[data-mentioned-user-id="' + mention.id + '"]')) {
          setStatus('This teammate is already tagged in the message.', false, mentionForm);
        } else if (mentionForm.querySelectorAll('[data-mentioned-user-id]').length >= 20) {
          throw new Error('A message can tag up to 20 teammates.');
        } else {
          var messageInput = mentionForm.querySelector('[name="body"]');
          var taggedText = '@' + mention.display_name;
          messageInput.setRangeText(taggedText + ' ', messageInput.selectionStart, messageInput.selectionEnd, 'end');
          var hiddenMention = document.createElement('input');
          hiddenMention.type = 'hidden';
          hiddenMention.name = 'mentioned_user_ids';
          hiddenMention.value = mention.id;
          hiddenMention.dataset.mentionedUserId = mention.id;
          mentionForm.appendChild(hiddenMention);
          var tag = document.createElement('span');
          tag.className = 'client-desk-mention-tag';
          tag.dataset.mentionTag = mention.id;
          var tagLabel = document.createElement('span');
          tagLabel.textContent = '@' + mention.display_name;
          var removeTag = document.createElement('button');
          removeTag.type = 'button';
          removeTag.dataset.action = 'remove-mention';
          removeTag.dataset.mentionId = mention.id;
          removeTag.setAttribute('aria-label', 'Remove mention of ' + mention.display_name);
          removeTag.textContent = '×';
          tag.appendChild(tagLabel);
          tag.appendChild(removeTag);
          mentionTags.appendChild(tag);
          messageInput.focus();
        }
        mentionSelect.value = '';
      } else if (action === 'select-conversation') {
        selectedTeamConversation = target.dataset.conversation || 'group';
        renderDashboard();
      } else if (action === 'remove-mention') {
        var removeMentionForm = target.closest('form[data-action="team-message"]');
        var mentionId = target.dataset.mentionId;
        var hiddenMentionInput = removeMentionForm && removeMentionForm.querySelector('[data-mentioned-user-id="' + mentionId + '"]');
        var mentionTag = removeMentionForm && removeMentionForm.querySelector('[data-mention-tag="' + mentionId + '"]');
        if (hiddenMentionInput) hiddenMentionInput.remove();
        if (mentionTag) mentionTag.remove();
      } else if (action === 'calendar-prev' || action === 'calendar-next') {
        calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + (action === 'calendar-prev' ? -1 : 1), 1);
        renderDashboard();
      } else if (action === 'signout') {
        await client.auth.signOut();
        activeProfile = null;
        notificationStorageKey = '';
        renderSignIn();
      } else if (action === 'notifications') {
        var panel = portalRoot.querySelector('[data-notification-panel]');
        var open = panel && panel.hidden;
        if (open) {
          var visibleNotifications = notificationEvents().filter(function (event) {
            return notificationState.archived.indexOf(notificationId(event)) === -1;
          }).slice(0, notificationState.showAll ? notificationEvents().length : 10);
          visibleNotifications.forEach(function (event) {
            var id = notificationId(event);
            if (notificationState.read.indexOf(id) === -1) notificationState.read.push(id);
          });
          await markTeamMentionsRead(visibleNotifications);
          saveNotificationState();
        }
        refreshNotificationPanel();
        panel = portalRoot.querySelector('[data-notification-panel]');
        if (panel) panel.hidden = !open;
        target.setAttribute('aria-expanded', open ? 'true' : 'false');
        var notificationWrap = target.closest('.client-desk-notification-wrap');
        if (notificationWrap) notificationWrap.classList.toggle('is-open', Boolean(open));
      } else if (action === 'close-notifications') {
        var notificationPanel = portalRoot.querySelector('[data-notification-panel]');
        var notificationButton = portalRoot.querySelector('[data-action="notifications"]');
        if (notificationPanel) notificationPanel.hidden = true;
        if (notificationButton) notificationButton.setAttribute('aria-expanded', 'false');
        var wrap = target.closest('.client-desk-notification-wrap');
        if (wrap) wrap.classList.remove('is-open');
      } else if (action === 'dismiss-notification') {
        var dismissedId = target.dataset.notification;
        if (notificationState.archived.indexOf(dismissedId) === -1) notificationState.archived.push(dismissedId);
        saveNotificationState();
        refreshNotificationPanel();
      } else if (action === 'archive-notifications') {
        var allNotifications = notificationEvents();
        await markTeamMentionsRead(allNotifications);
        allNotifications.forEach(function (event) {
          var id = notificationId(event);
          if (notificationState.archived.indexOf(id) === -1) notificationState.archived.push(id);
          if (notificationState.read.indexOf(id) === -1) notificationState.read.push(id);
        });
        notificationState.showAll = false;
        saveNotificationState();
        refreshNotificationPanel();
      } else if (action === 'view-earlier-notifications') {
        notificationState.showEarlier = true;
        refreshNotificationPanel();
        var earlierPanel = portalRoot.querySelector('[data-notification-panel]');
        if (earlierPanel) earlierPanel.hidden = false;
      } else if (action === 'view-notifications') {
        notificationState.showEarlier = false;
        notificationState.showAll = false;
        refreshNotificationPanel();
        var recentPanel = portalRoot.querySelector('[data-notification-panel]');
        if (recentPanel) recentPanel.hidden = false;
      } else if (action === 'view-all-notifications') {
        notificationState.showAll = true;
        var allVisibleNotifications = notificationEvents().filter(function (event) {
          return notificationState.archived.indexOf(notificationId(event)) === -1;
        });
        await markTeamMentionsRead(allVisibleNotifications);
        allVisibleNotifications.forEach(function (event) {
          var id = notificationId(event);
          if (notificationState.read.indexOf(id) === -1) notificationState.read.push(id);
        });
        saveNotificationState();
        refreshNotificationPanel();
        var allPanel = portalRoot.querySelector('[data-notification-panel]');
        if (allPanel) allPanel.hidden = false;
      } else if (action === 'close-mobile-more') {
        var mobileMore = target.closest('.client-desk-mobile-more');
        if (mobileMore) mobileMore.open = false;
      } else if (action === 'dashboard-widget-move') {
        var definitions = dashboardWidgetDefinitions().map(function (widget) { return widget[0]; });
        var currentOrder = dashboardPreferences.order.filter(function (key) { return definitions.indexOf(key) !== -1; });
        definitions.forEach(function (key) { if (currentOrder.indexOf(key) === -1) currentOrder.push(key); });
        var widgetIndex = currentOrder.indexOf(target.dataset.widget);
        var destination = widgetIndex + (target.dataset.direction === 'up' ? -1 : 1);
        if (widgetIndex >= 0 && destination >= 0 && destination < currentOrder.length) {
          var movedWidget = currentOrder[widgetIndex];
          currentOrder[widgetIndex] = currentOrder[destination];
          currentOrder[destination] = movedWidget;
          dashboardPreferences.order = currentOrder;
          saveDashboardPreferences();
          applyDashboardPreferences();
          var customization = portalRoot.querySelector('.client-desk-dashboard-customize');
          var customizationOpen = customization && customization.open;
          if (customization) {
            customization.outerHTML = renderDashboardCustomization();
            portalRoot.querySelector('.client-desk-dashboard-customize').open = customizationOpen;
          }
        }
      } else if (action === 'dashboard-widget-reset') {
        dashboardPreferences = { order: [], hidden: [] };
        saveDashboardPreferences();
        applyDashboardPreferences();
        var resetDetails = target.closest('.client-desk-dashboard-customize');
        if (resetDetails) {
          resetDetails.outerHTML = renderDashboardCustomization();
          portalRoot.querySelector('.client-desk-dashboard-customize').open = true;
        }
      } else if (action === 'theme') {
        portalTheme = portalTheme === 'light' ? 'dark' : 'light';
        applyPortalTheme();
        target.innerHTML = portalIcon(portalTheme === 'light' ? 'moon' : 'sun') + (portalTheme === 'light' ? 'Use dark appearance' : 'Use light appearance');
      } else if (action === 'step-review') {
        target.disabled = true;
        var feedbackField = portalRoot.querySelector('[data-review-feedback="' + target.dataset.step + '"]');
        var feedback = feedbackField ? feedbackField.value.trim() : '';
        var review = await client.rpc('update_project_step', {
          p_step_id: target.dataset.step,
          p_status: target.dataset.status,
          p_feedback: feedback || null
        });
        if (review.error) throw review.error;
        await loadWorkspace();
        setStatus(target.dataset.status === 'done' ? 'Deliverable approved. Project progress has been updated.' : 'Revision requested. Your feedback has been added to the project activity.', false);
      } else if (action === 'assign-step') {
        target.disabled = true;
        var stepRow = target.closest('.client-desk-step');
        var ownerField = stepRow && stepRow.querySelector('[data-step-owner]');
        var dueField = stepRow && stepRow.querySelector('[data-step-due]');
        if (!ownerField || !dueField) throw new Error('Assignment details are unavailable. Refresh the project and try again.');
        var assignment = await client.rpc('owner_assign_project_step', {
          p_step_id: target.dataset.step,
          p_owner_id: ownerField.value || null,
          p_due_at: dueField.value ? new Date(dueField.value + 'T23:59:00').toISOString() : null
        });
        if (assignment.error) throw assignment.error;
        await loadWorkspace();
        setStatus('The assignment and due date have been saved.', false);
      } else if (action === 'new-request') {
        var panel = portalRoot.querySelector('[data-request-panel]');
        if (panel) { panel.open = true; panel.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      } else if (action === 'refresh') {
        target.disabled = true;
        await loadWorkspace();
        setStatus('Project information has been refreshed.', false);
      } else if (action === 'add-milestone') {
        var quoteForm = target.closest('form[data-action="quote"]');
        var milestoneList = quoteForm && quoteForm.querySelector('[data-milestone-list]');
        if (!milestoneList || milestoneList.querySelectorAll('[data-milestone-row]').length >= 12) throw new Error('A quote can have up to 12 payment milestones.');
        var row = document.createElement('div');
        row.className = 'client-desk-field-grid';
        row.setAttribute('data-milestone-row', '');
        row.innerHTML = '<div class="field"><label class="client-desk-label">Milestone name</label><input name="milestone_description" required maxlength="240" placeholder="e.g. Final handover"></div><div class="field"><label class="client-desk-label">Amount (ZAR)</label><input name="milestone_amount" type="number" min="0.01" step="0.01" required></div><div class="field"><label class="client-desk-label">Payment due</label><input name="milestone_due" type="date" required></div><div class="field"><label class="client-desk-label">Email invoice on</label><input name="milestone_send" type="datetime-local" required></div><button class="btn ghost" type="button" data-action="remove-milestone" aria-label="Remove payment milestone">Remove</button>';
        milestoneList.appendChild(row);
        row.querySelector('input').focus();
      } else if (action === 'remove-milestone') {
        var milestoneForm = target.closest('form[data-action="quote"]');
        var rows = milestoneForm && milestoneForm.querySelectorAll('[data-milestone-row]');
        if (rows && rows.length > 1) target.closest('[data-milestone-row]').remove();
      } else if (action === 'pay') {
        target.disabled = true;
        var checkout = await client.functions.invoke('create-payment', { body: { invoice_id: target.dataset.invoice, provider: target.dataset.provider } });
        if (checkout.error) throw checkout.error;
        if (checkout.data && checkout.data.manual) {
          setStatus('Manual payment reference: ' + checkout.data.reference + '. ' + checkout.data.instructions, false);
          target.disabled = false;
        } else if (checkout.data && checkout.data.form_url && checkout.data.form_fields) {
          var payFastAction = new URL(checkout.data.form_url);
          if (!['https://www.payfast.co.za', 'https://sandbox.payfast.co.za'].includes(payFastAction.origin) || payFastAction.pathname !== '/eng/process') throw new Error('The payment link could not be verified. Contact support before continuing.');
          var form = document.createElement('form');
          form.method = 'post';
          form.action = checkout.data.form_url;
          Object.keys(checkout.data.form_fields).forEach(function (name) {
            var input = document.createElement('input');
            input.type = 'hidden';
            input.name = name;
            input.value = checkout.data.form_fields[name];
            form.appendChild(input);
          });
          document.body.appendChild(form);
          form.submit();
        } else if (checkout.data && checkout.data.checkout_url && new URL(checkout.data.checkout_url).origin === 'https://checkout.stripe.com') {
          window.location.assign(checkout.data.checkout_url);
        } else throw new Error('The payment service did not provide a valid payment link. Contact support for assistance.');
      } else if (action === 'retry-invoice') {
        if (activeProfile.role !== 'owner') throw new Error('Management access is required.');
        var retry = await client.rpc('owner_retry_invoice_email', { p_invoice_id: target.dataset.invoice });
        if (retry.error) throw retry.error;
        await loadWorkspace();
        setStatus('The invoice email has been scheduled for retry.', false);
      } else if (action === 'accept-quote') {
        target.disabled = true;
        var accepted = await client.rpc('accept_project_quote', { p_quote_id: target.dataset.quote });
        if (accepted.error) throw accepted.error;
        await loadWorkspace();
        setStatus('Quote approved. The agreed invoice schedule is now active.', false);
      } else if (action === 'checklist' && target.checked) {
        var taskUpdate = await client.rpc('complete_customer_checklist_item', { p_item_id: target.dataset.id });
        if (taskUpdate.error) throw taskUpdate.error;
        await loadWorkspace();
      } else if (action === 'save-project') {
        var projectToSave = projectCache.find(function (item) { return item.id === target.dataset.project; });
        if (!projectToSave) return;
        var saved = await client.from('projects').update({ status: projectToSave.status, next_action: projectToSave.next_action }).eq('id', projectToSave.id);
        if (saved.error) throw saved.error;
        await loadWorkspace();
        setStatus('The project update has been saved.', false);
      }
    } catch (error) {
      setStatus(error.message || 'This action could not be completed. Please retry.', true);
      target.disabled = false;
    }
  }

  async function handlePortalPageNavigation(event) {
    var link = event.target.closest('[data-portal-page]');
    if (!link || link.getAttribute('aria-disabled') === 'true') return;
    event.preventDefault();
    if (link.dataset.mentionId) {
      var markRead = await client.from('team_message_mentions').update({ read_at: new Date().toISOString() }).eq('id', link.dataset.mentionId);
      if (markRead.error) {
        setStatus('The mention could not be marked as read. Please retry.', true);
        return;
      }
      var selectedMention = (relatedData.teamMentions || []).find(function (mention) { return mention.id === link.dataset.mentionId; });
      if (selectedMention) selectedMention.read_at = new Date().toISOString();
    }
    currentPortalPage = link.dataset.portalPage;
    currentPortalSection = portalPageTitle(currentPortalPage);
    pendingProjectOpen = link.dataset.openProject || '';
    pendingProjectSection = link.dataset.openSection || '';
    pendingProjectStep = link.dataset.openStep || '';
    pendingTeamMessageOpen = link.dataset.openTeamMessage || '';
    if (pendingTeamMessageOpen) selectedTeamConversation = 'group';
    var nextState = Object.assign({}, window.history.state || {}, { clientDeskPage: currentPortalPage });
    var pageUrl = new URL(window.location.href);
    pageUrl.searchParams.set('portalPage', currentPortalPage);
    window.history.pushState(nextState, '', pageUrl.pathname + pageUrl.search + pageUrl.hash);
    renderDashboard();
    portalRoot.querySelectorAll('.client-desk-mobile-more[open]').forEach(function (menu) { menu.open = false; });
  }

  function handlePortalPagePopState(event) {
    if (!activeProfile) return;
    var requestedPage = event.state && event.state.clientDeskPage || new URLSearchParams(window.location.search).get('portalPage') || 'dashboard';
    currentPortalPage = portalPageAllowed(requestedPage, activeProfile.role) ? requestedPage : 'dashboard';
    currentPortalSection = portalPageTitle(currentPortalPage);
    renderDashboard();
  }

  function handlePortalNavigation(event) {
    var link = event.target.closest('[data-portal-nav]');
    if (!link || link.getAttribute('aria-disabled') === 'true') return;
    event.preventDefault();
    var targetName = link.dataset.target;
    var target = document.getElementById(targetName);
    if (targetName === 'clientDeskClients' && target) target = target.querySelector('details') || target;
    if (!target && ['messages', 'files', 'billing', 'finance', 'team', 'timeline', 'deliverables'].indexOf(targetName) !== -1) {
      target = portalRoot.querySelector('[data-portal-section="' + targetName + '"]');
    }
    if (!target) return;
    if (link.dataset.section) {
      var section = target.querySelector('[data-portal-section="' + link.dataset.section + '"]');
      if (section) target = section;
    }
    var project = target.closest('details[data-project-details]');
    var expandable = target.closest('details');
    while (expandable) {
      expandable.open = true;
      expandable = expandable.parentElement.closest('details');
    }
    if (project) project.open = true;
    var label = link.dataset.label || (link.querySelector('span') && link.querySelector('span').textContent.trim());
    currentPortalSection = targetName === 'clientDeskHome'
      ? activeProfile.role === 'owner' ? 'Overview' : 'Dashboard'
      : link.dataset.section === 'deliverables' ? 'Deliverables & Approvals'
        : link.dataset.section === 'billing' ? 'Invoices & Payments'
          : label || (targetName === 'clientDeskProjects' ? 'Projects' : 'Workspace');
    portalRoot.querySelectorAll('[data-portal-nav]').forEach(function (item) {
      if (item.dataset.target === link.dataset.target) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });
    portalRoot.querySelectorAll('.client-desk-nav-more[open]').forEach(function (menu) { menu.open = false; });
    portalRoot.querySelectorAll('.client-desk-mobile-more[open]').forEach(function (menu) { menu.open = false; });
    var notificationPanel = portalRoot.querySelector('[data-notification-panel]');
    var notificationButton = portalRoot.querySelector('[data-action="notifications"]');
    if (notificationPanel) notificationPanel.hidden = true;
    if (notificationButton) notificationButton.setAttribute('aria-expanded', 'false');
    var notificationWrap = portalRoot.querySelector('.client-desk-notification-wrap');
    if (notificationWrap) notificationWrap.classList.remove('is-open');
    var backLink = portalRoot.querySelector('[data-back-dashboard]');
    if (backLink) backLink.hidden = targetName === 'clientDeskHome';
    var breadcrumb = portalRoot.querySelector('[data-current-section]');
    if (breadcrumb) breadcrumb.textContent = currentPortalSection;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function handlePortalSearch(event) {
    var input = event.target.closest('[data-portal-search]');
    if (!input) return;
    var query = input.value.trim().toLowerCase();
    var projects = portalRoot.querySelectorAll('[data-project-details]');
    var visibleCount = 0;
    projects.forEach(function (project) {
      project.hidden = Boolean(query) && !project.textContent.toLowerCase().includes(query);
      if (!project.hidden) visibleCount++;
    });
    var empty = portalRoot.querySelector('[data-portal-search-empty]');
    if (empty) empty.hidden = !query || visibleCount > 0;
  }

  function handlePortalKeydown(event) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      var search = portalRoot && portalRoot.querySelector('[data-portal-search]');
      if (search) search.focus();
    } else if (event.key === 'Escape' && portalRoot) {
      var panel = portalRoot.querySelector('[data-notification-panel]');
      var button = portalRoot.querySelector('[data-action="notifications"]');
      if (panel) panel.hidden = true;
      if (button) button.setAttribute('aria-expanded', 'false');
      var notificationWrap = portalRoot.querySelector('.client-desk-notification-wrap');
      if (notificationWrap) notificationWrap.classList.remove('is-open');
      portalRoot.querySelectorAll('.client-desk-user-menu, .client-desk-mobile-more').forEach(function (menu) { menu.open = false; });
    }
  }

  function handleOutsideClick(event) {
    if (!portalRoot || event.target.closest('.client-desk-notification-wrap')) return;
    var panel = portalRoot.querySelector('[data-notification-panel]');
    var button = portalRoot.querySelector('[data-action="notifications"]');
    if (panel) panel.hidden = true;
    if (button) button.setAttribute('aria-expanded', 'false');
    var wrap = portalRoot.querySelector('.client-desk-notification-wrap');
    if (wrap) wrap.classList.remove('is-open');
    if (!event.target.closest('.client-desk-mobile-more')) {
      portalRoot.querySelectorAll('.client-desk-mobile-more[open]').forEach(function (menu) { menu.open = false; });
    }
  }

  async function handleSubmit(event) {
    var form = event.target.closest('form[data-action]');
    if (!form) return;
    event.preventDefault();
    var action = form.dataset.action;
    var submit = form.querySelector('[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      if (action === 'signin') {
        var credentials = new FormData(form);
        var email = String(credentials.get('email')).trim();
        var password = String(credentials.get('password'));
        var response = await client.auth.signInWithPassword({ email: email, password: password });
        if (response.error) throw response.error;
      } else if (action === 'signup') {
        var signupData = new FormData(form);
        var signupResponse = await client.auth.signUp({
          email: String(signupData.get('email')).trim(),
          password: String(signupData.get('password')),
          options: { data: { full_name: String(signupData.get('name')).trim() } }
        });
        if (signupResponse.error) throw signupResponse.error;
        if (signupResponse.data.session) {
          form.reset();
          setStatus('Client account created. Your portal is ready.', false, form);
        } else {
          form.reset();
          setStatus('Account request received. Check your email to confirm your address, then sign in.', false, form);
        }
      } else if (action === 'request') await submitRequest(form);
      else if (action === 'message') await submitMessage(form);
      else if (action === 'upload') await submitFile(form);
      else if (action === 'checklist-add') await submitChecklistItem(form);
      else if (action === 'payment-settings') await submitPaymentSettings(form);
      else if (action === 'freelancer-role') await submitFreelancerRole(form);
      else if (action === 'team') await submitProjectTeam(form);
      else if (action === 'team-message') await submitTeamMessage(form);
      else if (action === 'payment-dispute') await submitPaymentDispute(form);
      else if (action === 'payment-dispute-review') await reviewPaymentDispute(form);
      else if (action === 'automatic-assignment') await submitAutomaticAssignment(form);
      else if (action === 'delete-profile') {
        var deletionCredentials = new FormData(form);
        if ((activeProfile.role !== 'customer' && activeProfile.role !== 'deleted') || !deletionCredentials.get('confirm')) {
          throw new Error('Confirm that you want to permanently delete this client account.');
        }
        var reauthenticated = await client.auth.signInWithPassword({
          email: activeProfile.email,
          password: String(deletionCredentials.get('password'))
        });
        if (reauthenticated.error) throw reauthenticated.error;
        var deletion = await client.functions.invoke('delete-client-profile');
        if (deletion.error) {
          await loadWorkspace();
          setStatus(deletion.error.message || 'Account deletion could not be completed. Retry or contact FixerCtrl.', true);
          return;
        }
        await client.auth.signOut({ scope: 'local' });
        activeProfile = null;
        renderSignIn();
        setStatus('Your client account has been removed. Project records remain anonymized.', false);
      }
      else if (action === 'manual-paid') {
        if (activeProfile.role !== 'owner' || !new FormData(form).get('verified')) throw new Error('Confirm that the bank transfer has been received before recording payment.');
        var reconciliation = await client.rpc('owner_mark_invoice_paid', { p_invoice_id: form.dataset.invoice });
        if (reconciliation.error) throw reconciliation.error;
        await loadWorkspace();
        setStatus('The bank transfer has been reconciled and recorded.', false);
      }
      else if (action === 'quote') await submitQuote(form);
    } catch (error) {
      setStatus(error.message || 'This request could not be completed.', true, form);
    } finally {
      if (submit && document.body.contains(submit)) submit.disabled = false;
    }
  }

  async function handleChange(event) {
    var widgetToggle = event.target.closest('[data-action="dashboard-widget-toggle"]');
    if (widgetToggle) {
      var hiddenIndex = dashboardPreferences.hidden.indexOf(widgetToggle.dataset.widget);
      if (widgetToggle.checked && hiddenIndex !== -1) dashboardPreferences.hidden.splice(hiddenIndex, 1);
      if (!widgetToggle.checked && hiddenIndex === -1) dashboardPreferences.hidden.push(widgetToggle.dataset.widget);
      saveDashboardPreferences();
      applyDashboardPreferences();
      return;
    }
    var target = event.target.closest('[data-action="set-status"], [data-action="set-next"]');
    var stepTarget = event.target.closest('[data-action="step-status"]');
    if (stepTarget) {
      var oldStatus = stepTarget.dataset.currentStatus;
      stepTarget.disabled = true;
      try {
        var stepUpdate = await client.rpc('update_project_step', {
          p_step_id: stepTarget.dataset.step,
          p_status: stepTarget.value,
          p_feedback: null
        });
        if (stepUpdate.error) {
          stepTarget.value = oldStatus;
          setStatus(stepUpdate.error.message || 'The project step could not be updated.', true);
          return;
        }
        await loadWorkspace();
        setStatus('Step updated. Project progress and activity are current.', false);
      } catch (error) {
        stepTarget.value = oldStatus;
        setStatus(error.message || 'The project step could not be updated.', true);
      } finally {
        if (document.body.contains(stepTarget)) stepTarget.disabled = false;
      }
      return;
    }
    if (!target || (activeProfile.role !== 'owner' && activeProfile.role !== 'freelancer')) return;
    var project = projectCache.find(function (item) { return item.id === target.dataset.project; });
    if (project) project[target.dataset.action === 'set-status' ? 'status' : 'next_action'] = target.value;
  }

  async function onSession(session) {
    if (!session) {
      unsubscribeProgressUpdates();
      activeProfile = null;
      currentPortalPage = 'dashboard';
      selectedTeamConversation = 'group';
      notificationStorageKey = '';
      navigationStorageKey = '';
      notificationState = { read: [], archived: [], showEarlier: false, showAll: false };
      navigationGroupState = {};
      renderSignIn();
      return;
    }
    activeProfile = { id: session.user.id, email: session.user.email };
    loadPortalPreferences(activeProfile.id);
    try {
      await loadWorkspace();
      subscribeProgressUpdates();
    } catch (error) {
      renderShell('<div class="client-desk-notice"><div><strong>Workspace could not load</strong><p>' + escapeHtml(error.message || 'Please refresh and try again.') + '</p></div></div>', activeProfile);
    }
  }

  window.initClientDesk = function () {
    portalRoot = document.getElementById('clientDeskApp');
    if (!portalRoot) return;
    if (client) {
      client.auth.getSession().then(function (response) {
        if (response.error) showSetupRequired(response.error.message);
        else onSession(response.data.session);
      });
      return;
    }
    var config = window.FIXERCTRL_PORTAL_CONFIG || {};
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      showSetupRequired('The secure sign-in service has not been configured yet.');
      return;
    }
    loadSupabase(function () {
      if (!window.supabase || !window.supabase.createClient) {
        showSetupRequired('The authentication library did not initialize.');
        return;
      }
      client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, { auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
      client.auth.onAuthStateChange(function (_event, session) { window.setTimeout(function () { onSession(session); }, 0); });
      client.auth.getSession().then(function (response) {
        if (response.error) showSetupRequired(response.error.message);
        else onSession(response.data.session);
      });
    });
  };

  document.addEventListener('click', handleAction);
  document.addEventListener('click', handlePortalPageNavigation);
  document.addEventListener('click', handlePortalNavigation);
  document.addEventListener('click', handleOutsideClick);
  document.addEventListener('submit', handleSubmit);
  document.addEventListener('change', handleChange);
  document.addEventListener('input', handlePortalSearch);
  document.addEventListener('keydown', handlePortalKeydown);
  document.addEventListener('toggle', handleNavigationGroupToggle, true);
  window.addEventListener('popstate', handlePortalPagePopState);
})();
