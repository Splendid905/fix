(function () {
  'use strict';

  var client = null;
  var portalRoot = null;
  var activeProfile = null;
  var progressChannel = null;
  var progressRefreshTimer = null;
  var currentPortalSection = 'Home';
  var portalTheme = 'light';
  var projectCache = [];
  var relatedData = {};
  var categories = [
    ['web', 'Web development'],
    ['it_support', 'IT support'],
    ['security', 'Security setup']
  ];
  var statuses = [
    ['received', 'Request received'],
    ['scoping', 'Scoping'],
    ['awaiting_approval', 'Awaiting approval'],
    ['awaiting_payment', 'Awaiting payment'],
    ['awaiting_customer', 'Waiting on you'],
    ['in_progress', 'Work underway'],
    ['review', 'Client review'],
    ['handover', 'Handover'],
    ['complete', 'Complete'],
    ['paused', 'Paused']
  ];
  var stepStatuses = [
    ['not_started', 'Not started'],
    ['in_progress', 'In progress'],
    ['in_review', 'In review'],
    ['done', 'Done']
  ];

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
    });
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
      finance: '<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-4 4"/>',
      settings: '<circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.7a8 8 0 0 1-1.7 1l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.7-1l-1.7.7-1.4-2.4 1.4-1.1a7 7 0 0 1 0-2l-1.4-1.1 1.4-2.4 1.7.7a8 8 0 0 1 1.7-1l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.7 1l1.7-.7 1.4 2.4-1.4 1.1a7 7 0 0 1 0 2Z"/>',
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
      { label: 'Home', icon: 'home', target: 'clientDeskHome' },
      { label: 'Projects', icon: 'projects', target: 'clientDeskProjects' },
      { label: 'Clients', icon: 'team', target: 'clientDeskClients' },
      { label: 'Team', icon: 'team', target: 'team' },
      { label: 'Payments', icon: 'billing', target: 'clientDeskFinance' },
      { label: 'Finance', icon: 'finance', disabled: true },
      { label: 'Analytics', icon: 'billing', disabled: true },
    ];
    if (profile.role === 'freelancer') return [
      { label: 'Home', icon: 'home', target: 'clientDeskHome' },
      { label: 'My tasks', icon: 'tasks', target: 'clientDeskProjects' },
      { label: 'Messages', icon: 'messages', target: 'messages' },
      { label: 'Files', icon: 'files', target: 'files' },
      { label: 'My earnings', icon: 'billing', disabled: true },
      { label: 'Profile', icon: 'team', target: 'clientDeskProfile' }
    ];
    return [
      { label: 'Home', icon: 'home', target: 'clientDeskHome' },
      { label: 'My projects', icon: 'projects', target: 'clientDeskProjects' },
      { label: 'Messages', icon: 'messages', target: 'messages' },
      { label: 'Files', icon: 'files', target: 'files' },
      { label: 'Billing', icon: 'billing', target: 'billing' },
      { label: 'Support', icon: 'support', href: '#/contact' }
    ];
  }

  function renderPortalNavItem(item) {
    if (item.disabled) return '<span class="client-desk-nav-link is-disabled" aria-label="' + escapeHtml(item.label + ', coming later') + '" aria-disabled="true" title="Available in a later phase">' + portalIcon(item.icon) + '<span>' + escapeHtml(item.label) + '<small>Coming later</small></span></span>';
    var attributes = item.href ? 'href="' + item.href + '"' : 'href="#' + escapeHtml(item.target) + '" data-portal-nav data-target="' + escapeHtml(item.target) + '"';
    return '<a class="client-desk-nav-link" aria-label="' + escapeHtml(item.label) + '" title="' + escapeHtml(item.label) + '" ' + attributes + (item.target === 'clientDeskHome' ? ' aria-current="page"' : '') + '>' + portalIcon(item.icon) + '<span>' + escapeHtml(item.label) + '</span></a>';
  }

  function initials(profile) {
    var words = String(profile && (profile.display_name || profile.email) || 'FC').trim().split(/[\s@._-]+/).filter(Boolean);
    return words.slice(0, 2).map(function (word) { return word.charAt(0).toUpperCase(); }).join('') || 'FC';
  }

  function renderNotifications(profile) {
    if (!profile) return '';
    var events = (relatedData.events || []).slice().sort(function (left, right) {
      return new Date(right.created_at) - new Date(left.created_at);
    }).slice(0, 6);
    var items = events.length ? events.map(function (event) {
      var project = projectCache.find(function (item) { return item.id === event.project_id; });
      return '<li><strong>' + escapeHtml(event.title) + '</strong><span>' + escapeHtml(project ? project.title : 'Project update') + '</span><small>' + escapeHtml(dateLabel(event.created_at)) + '</small></li>';
    }).join('') : '<li class="client-desk-notification-empty">Your project updates will appear here.</li>';
    return '<div class="client-desk-popover" data-notification-panel hidden><div class="client-desk-popover-head"><strong>Recent updates</strong><span>Project activity</span></div><ul>' + items + '</ul></div>';
  }

  function recentActivityCount() {
    return Math.min((relatedData.events || []).length, 6);
  }

  function applyPortalTheme() {
    var app = portalRoot && portalRoot.querySelector('.client-desk-app');
    if (app) app.dataset.theme = portalTheme;
  }

  function renderShell(content, profile) {
    var name = profile ? (profile.display_name || profile.email || 'Customer') : 'Private workspace';
    var role = profile ? (profile.role === 'owner' ? 'Admin' : profile.role === 'freelancer' ? 'Freelancer' : profile.role === 'deleted' ? 'Deletion pending' : 'Customer') : '';
    var navigation = portalNavigation(profile);
    var brand = '<a class="client-desk-brand" href="#/" aria-label="FixerCtrl home"><img src="assets/fixerctrl-logo.png" alt="FixerCtrl"></a>';
    if (!profile || !navigation.length) {
      portalRoot.innerHTML = '<div class="client-desk-app" data-theme="' + portalTheme + '"><header class="client-desk-guest-header">' + brand + '<span>Private project workspace</span>' + (profile ? '<button class="btn ghost" type="button" data-action="signout">Sign out</button>' : '') + '</header><main class="client-desk-guest-main">' + content + '</main></div>';
      return;
    }

    var navLinks = navigation.map(renderPortalNavItem).join('');
    var mobileNav = navigation.filter(function (item) { return !item.disabled; }).slice(0, 4)
      .map(renderPortalNavItem).join('');
    var rest = navigation.filter(function (item) { return !item.disabled; }).slice(4);
    var disabledItems = navigation.filter(function (item) { return item.disabled; });
    var search = '<label class="client-desk-search">' + portalIcon('search') + '<input type="search" data-portal-search placeholder="Search projects" aria-label="Search projects"><kbd>Ctrl / ⌘ K</kbd></label>';
    var notifications = renderNotifications(profile);
    var currentLabel = currentPortalSection;
    var accountMenu = '<details class="client-desk-user-menu" id="clientDeskProfile"><summary><span class="client-desk-avatar" aria-hidden="true">' + escapeHtml(initials(profile)) + '</span><span><strong>' + escapeHtml(name) + '</strong><small>' + escapeHtml(role) + '</small></span><span class="client-desk-menu-chevron" aria-hidden="true">⌄</span></summary><div class="client-desk-user-popover"><p>' + escapeHtml(profile.email || '') + '</p><button type="button" data-action="theme">' + portalIcon(portalTheme === 'light' ? 'moon' : 'sun') + (portalTheme === 'light' ? 'Switch to dark mode' : 'Switch to light mode') + '</button><button type="button" data-action="signout">Sign out</button></div></details>';
    portalRoot.innerHTML = '<div class="client-desk-app" data-theme="' + portalTheme + '"><aside class="client-desk-sidebar-nav" aria-label="Workspace navigation">' + brand + '<span class="client-desk-nav-caption">Workspace</span><nav>' + navLinks + '</nav><div class="client-desk-sidebar-help"><span>Need a hand?</span><a href="#/contact" aria-label="Contact FixerCtrl" title="Contact FixerCtrl">' + portalIcon('help') + '<span>Contact FixerCtrl</span></a></div></aside><div class="client-desk-shell"><header class="client-desk-topbar"><div class="client-desk-topbar-title"><span class="client-desk-topbar-kicker">FixerCtrl / Portal</span><strong>' + escapeHtml(currentLabel) + '</strong></div>' + search + '<div class="client-desk-top-actions"><div class="client-desk-notification-wrap"><button class="client-desk-icon-button" type="button" data-action="notifications" aria-label="Recent project updates" aria-expanded="false">' + portalIcon('bell') + '<span class="client-desk-notification-count" aria-label="' + recentActivityCount() + ' recent updates">' + (recentActivityCount() || '') + '</span></button>' + notifications + '</div><a class="client-desk-icon-button client-desk-help-button" href="#/contact" aria-label="Get help">' + portalIcon('help') + '</a>' + accountMenu + '</div></header><div class="client-desk-breadcrumb"><span>Workspace</span><span aria-hidden="true">/</span><strong data-current-section>' + escapeHtml(currentLabel) + '</strong></div><main class="client-desk-main-content">' + content + '</main></div><nav class="client-desk-mobile-nav" aria-label="Mobile workspace navigation">' + mobileNav + (rest.length || disabledItems.length ? '<details class="client-desk-mobile-more"><summary>' + portalIcon('more') + '<span>More</span></summary><div class="client-desk-mobile-more-panel">' + rest.map(renderPortalNavItem).join('') + disabledItems.map(renderPortalNavItem).join('') + '<a href="#/contact" class="client-desk-nav-link" aria-label="Help" title="Help">' + portalIcon('help') + '<span>Help</span></a></div></details>' : '') + '</nav></div>';
  }

  function showSetupRequired(message) {
    renderShell('<div class="client-desk-form"><p class="client-desk-kicker">Private workspace</p><h2>Secure access is not connected yet</h2>' +
      '<p>This portal is designed for private customer accounts and project records. No customer information is saved on this page.</p>' +
      '<div class="client-desk-notice"><div><strong>Setup required before sign-in</strong><p>' + escapeHtml(message || 'The Supabase project URL and public client key have not been configured.') + ' The database access policies, email sender, and payment providers must also be configured before this can accept real requests or payments.</p></div></div>' +
      '<p class="client-desk-footnote">For help with a request while setup is underway, use the existing <a href="#/contact">contact page</a>.</p></div>', null);
  }

  function loadSupabase(done) {
    if (window.supabase && window.supabase.createClient) return done();
    var existing = document.querySelector('script[data-supabase-client]');
    if (existing) {
      existing.addEventListener('load', done, { once: true });
      existing.addEventListener('error', function () { showSetupRequired('The authentication library could not load. Check the network and retry.'); }, { once: true });
      return;
    }
    var script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0';
    script.integrity = 'sha384-gnyZit14c5lnGcarmA166QQjjJXpucw25ogZXuwH3HxxY904zHkBqmxVpelsPorb';
    script.crossOrigin = 'anonymous';
    script.async = true;
    script.dataset.supabaseClient = 'true';
    script.onload = done;
    script.onerror = function () { showSetupRequired('The authentication library could not load. Check the network and retry.'); };
    document.head.appendChild(script);
  }

  function renderSignIn() {
    renderShell('<div class="client-desk-form"><p class="client-desk-kicker">Client Portal</p><h2>Access your workspace</h2>' +
      '<p>Sign in to view your projects or create a customer account to get started.</p>' +
      '<form class="client-desk-message-form" data-action="signin"><div class="field"><label class="client-desk-label" for="portalEmail">Email address</label><input id="portalEmail" name="email" type="email" autocomplete="email" required maxlength="254" placeholder="you@example.com"></div>' +
      '<div class="field"><label class="client-desk-label" for="portalPassword">Password</label><input id="portalPassword" name="password" type="password" autocomplete="current-password" required></div>' +
      '<button class="btn" type="submit">Sign in</button><p class="client-desk-form-status" data-portal-status aria-live="polite"></p></form>' +
      '<details class="client-desk-card"><summary><strong>New customer? Create an account</strong></summary><form class="client-desk-message-form" data-action="signup">' +
      '<div class="field"><label class="client-desk-label" for="signupName">Your name</label><input id="signupName" name="name" type="text" autocomplete="name" maxlength="100" required></div>' +
      '<div class="field"><label class="client-desk-label" for="signupEmail">Email address</label><input id="signupEmail" name="email" type="email" autocomplete="email" required maxlength="254" placeholder="you@example.com"></div>' +
      '<div class="field"><label class="client-desk-label" for="signupPassword">Create a password</label><input id="signupPassword" name="password" type="password" autocomplete="new-password" minlength="8" required></div>' +
      '<button class="btn ghost" type="submit">Create customer account</button><p class="client-desk-form-status" data-portal-status aria-live="polite"></p></form></details>' +
      '<details class="client-desk-card"><summary><strong>Admin sign-in help</strong></summary><p>Admins use the same sign-in form. The account must first exist in Supabase Authentication and its Client Portal profile must have the <code>owner</code> role. Public registration only creates customer accounts; it cannot grant admin access.</p><p class="client-desk-footnote">If your credentials are rejected, confirm the account exists in Supabase Auth and has a password. Then have the project administrator check or promote its profile in Supabase SQL Editor. Need help? <a href="#/contact">Contact FixerCtrl</a>.</p></details>' +
      '<p class="client-desk-footnote">Your projects and files are private to your account. Need a password reset or existing portal access? <a href="#/contact">Contact FixerCtrl</a>.</p></div>', null);
  }

  function buildRequestForm() {
    return '<details class="client-desk-card" data-request-panel><summary><strong>Start a new request</strong><span class="client-desk-status">New request</span></summary>' +
      '<form class="client-desk-message-form" data-action="request"><div class="client-desk-field-grid">' +
      '<div class="field"><label class="client-desk-label" for="requestTitle">Project title</label><input id="requestTitle" name="title" type="text" maxlength="120" required placeholder="e.g. Small business website"></div>' +
      '<div class="field"><label class="client-desk-label" for="requestCategory">Service</label><select id="requestCategory" name="service" required>' + categories.map(function (item) { return '<option value="' + item[0] + '">' + item[1] + '</option>'; }).join('') + '</select></div></div>' +
      '<div class="field"><label class="client-desk-label" for="requestDescription">What do you need?</label><textarea id="requestDescription" name="description" maxlength="5000" required placeholder="Describe your goal, any deadline, and what you already have."></textarea></div>' +
      '<div class="field"><label class="client-desk-label" for="requestDue">Preferred deadline (optional)</label><input id="requestDue" name="preferred_date" type="date"></div>' +
      '<button class="btn" type="submit">Send request</button><p class="client-desk-form-status" data-portal-status aria-live="polite"></p></form></details>';
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
    return match ? match[1] : 'Not started';
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
          ? '<label class="client-desk-step-control"><span class="client-desk-label">Update status</span><select data-action="step-status" data-step="' + escapeHtml(step.id) + '" data-current-status="' + escapeHtml(step.status) + '">' + stepStatuses.filter(function (entry) { return activeProfile.role === 'owner' || entry[0] !== 'done'; }).map(function (entry) {
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
          ? '<div class="client-desk-step-assignment"><label class="client-desk-step-control"><span class="client-desk-label">Step owner</span><select data-step-owner="' + escapeHtml(step.id) + '"><option value="">Unassigned</option>' + ownerOptions + '</select></label><label class="client-desk-step-control"><span class="client-desk-label">Due date</span><input type="date" data-step-due="' + escapeHtml(step.id) + '" value="' + escapeHtml(step.due_at ? new Date(step.due_at).toISOString().slice(0, 10) : '') + '"></label><button class="btn ghost" type="button" data-action="assign-step" data-step="' + escapeHtml(step.id) + '">Save owner and date</button></div>'
          : '';
        var clientReview = activeProfile.role === 'customer' && step.status === 'in_review'
          ? '<div class="client-desk-step-review"><label class="client-desk-label" for="feedback-' + escapeHtml(step.id) + '">Changes needed? (optional for approval)</label><textarea id="feedback-' + escapeHtml(step.id) + '" data-review-feedback="' + escapeHtml(step.id) + '" maxlength="1000" placeholder="Tell us what to adjust before requesting changes"></textarea><div class="client-desk-owner-tools"><button class="btn" type="button" data-action="step-review" data-step="' + escapeHtml(step.id) + '" data-status="done">Approve step</button><button class="btn ghost" type="button" data-action="step-review" data-step="' + escapeHtml(step.id) + '" data-status="in_progress">Request changes</button></div></div>'
          : '';
        return '<li class="client-desk-step"><div class="client-desk-step-copy"><span class="client-desk-step-state">' + escapeHtml(stepStatusLabel(step.status)) + '</span><strong>' + escapeHtml(step.title) + '</strong><small>' + escapeHtml(details) + '</small></div>' + staffControls + ownerControls + clientReview + '</li>';
      }).join('');
      return '<section class="client-desk-stage"><div class="client-desk-stage-head"><div><h3>' + escapeHtml(stage.title) + '</h3><span>' + percent + '% complete</span></div>' + renderProgressBar(percent, stage.title + ' progress') + '</div><ol class="client-desk-steps">' + stepMarkup + '</ol></section>';
    }).join('');
    return '<section class="client-desk-progress-panel" aria-label="Project progress"><div class="client-desk-project-summary"><div><span class="client-desk-label">Overall progress</span><strong>' + projectProgress(project.id) + '%</strong>' + renderProgressBar(projectProgress(project.id), 'Overall project progress') + '</div><div><span class="client-desk-label">Next milestone</span><strong>' + escapeHtml(overview.nextMilestone) + '</strong></div><div><span class="client-desk-label">Next action from you</span><strong>' + escapeHtml(overview.clientAction) + '</strong></div><div><span class="client-desk-label">Last update</span><strong>' + escapeHtml(overview.lastEvent ? overview.lastEvent.title : 'No updates yet') + '</strong><small>' + escapeHtml(overview.lastEvent ? dateLabel(overview.lastEvent.created_at) : 'Updates will appear here') + '</small></div></div><h3>Project stages</h3>' + (stagesMarkup || '<p class="client-desk-footnote">The project workflow will appear here when available.</p>') + '</section>';
  }

  function renderTimeline(project) {
    var events = projectEvents(project.id);
    if (!events.length) return '<p class="client-desk-footnote">Progress updates will appear here as work moves forward.</p>';
    return '<ol class="client-desk-timeline">' + events.map(function (event, index) {
      return '<li class="' + (index === events.length - 1 ? 'is-current' : 'is-done') + '"><strong>' + escapeHtml(event.title) + '</strong><br>' + escapeHtml(event.description || '') + '<br><small>' + escapeHtml(dateLabel(event.created_at)) + '</small></li>';
    }).join('') + '</ol>';
  }

  function renderChecklist(project) {
    var items = projectChecklist(project.id);
    if (!items.length) return '<p class="client-desk-footnote">No outstanding items.</p>';
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
      return '<li class="client-desk-message"><small>' + escapeHtml(author) + (message.is_internal ? ' / INTERNAL' : '') + ' / ' + escapeHtml(dateLabel(message.created_at)) + '</small><p>' + escapeHtml(message.body) + '</p></li>';
    }).join('') : '<li class="client-desk-footnote">No messages yet.</li>') + '</ul>' +
      '<form class="client-desk-message-form" data-action="message" data-project="' + escapeHtml(project.id) + '"><label class="client-desk-label" for="message-' + escapeHtml(project.id) + '">' + (activeProfile.role === 'owner' ? 'Reply to customer' : 'Message FixerCtrl') + '</label><textarea id="message-' + escapeHtml(project.id) + '" name="body" required maxlength="5000" placeholder="Write a project update or question"></textarea>' + (activeProfile.role === 'owner' ? '<label class="client-desk-checkline"><input name="internal" type="checkbox"><span>Private note (only visible to FixerCtrl)</span></label>' : '') + '<button class="btn" type="submit">Send message</button><p class="client-desk-footnote">A notification email will be sent when email delivery is configured.</p></form>';
  }

  function renderFiles(project) {
    var files = (relatedData.files || []).filter(function (file) { return file.project_id === project.id; });
    return '<section data-portal-section="files"><div class="client-desk-section-head"><h2>Files and materials</h2></div>' +
      (files.length ? '<ul class="client-desk-checklist">' + files.map(function (file) {
        return '<li><span aria-hidden="true">FILE</span><span><a href="' + escapeHtml(file.signed_url || '#') + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(file.file_name) + '</a> / ' + escapeHtml(dateLabel(file.created_at)) + (file.is_internal ? ' / INTERNAL' : '') + '</span></li>';
      }).join('') + '</ul>' : '<p class="client-desk-footnote">No files have been shared yet.</p>') +
      '<form class="client-desk-message-form" data-action="upload" data-project="' + escapeHtml(project.id) + '"><label class="client-desk-label" for="upload-' + escapeHtml(project.id) + '">Add a file (JPG, PNG, WebP, or PDF; 10 MB max)</label><input id="upload-' + escapeHtml(project.id) + '" name="file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required>' + (activeProfile.role === 'owner' ? '<label class="client-desk-checkline"><input name="internal" type="checkbox"><span>Private file (only visible to FixerCtrl)</span></label>' : '') + '<button class="btn ghost" type="submit">Upload file</button></form></section>';
  }

  function renderInvoices(project) {
    var invoices = projectInvoices(project.id);
    var providers = relatedData.providers || [];
    if (!invoices.length) return '<p class="client-desk-footnote">No invoices are due yet. Any price and payment schedule will be shown here before you are asked to pay.</p>';
    return '<div class="client-desk-payment-list">' + invoices.map(function (invoice) {
      var payable = ['sent', 'overdue'].indexOf(invoice.status) !== -1;
      var available = activeProfile.role === 'owner' ? [] : providers.filter(function (provider) { return provider.is_enabled; });
      var emailState = activeProfile.role === 'owner' ? '<p class="client-desk-footnote">Invoice email: ' + escapeHtml(invoice.email_state) + ' / scheduled ' + escapeHtml(dateLabel(invoice.email_send_at)) + (invoice.email_last_error ? '<br>' + escapeHtml(invoice.email_last_error) : '') + '</p>' + (invoice.email_state === 'failed' ? '<button class="btn ghost" type="button" data-action="retry-invoice" data-invoice="' + escapeHtml(invoice.id) + '">Retry invoice email</button>' : '') : '';
      return '<div class="client-desk-payment"><div><span class="client-desk-label">' + escapeHtml(invoice.invoice_number || 'Invoice') + ' / ' + escapeHtml(invoice.status) + '</span><p class="client-desk-money">' + escapeHtml(money(invoice.amount_minor, invoice.currency)) + '</p><p>Due ' + escapeHtml(dateLabel(invoice.due_at)) + (invoice.description ? ' / ' + escapeHtml(invoice.description) : '') + '</p></div>' +
        emailState +
        (payable ? '<div class="client-desk-checkout-options">' + available.map(function (provider) {
          return '<button class="btn ghost" type="button" data-action="pay" data-invoice="' + escapeHtml(invoice.id) + '" data-provider="' + escapeHtml(provider.provider) + '">' + escapeHtml(provider.label) + '</button>';
        }).join('') + '</div>' : '<span class="client-desk-status">' + escapeHtml(invoice.status) + (invoice.status === 'scheduled' ? ' / Email ' + escapeHtml(dateLabel(invoice.email_send_at)) : '') + '</span>') +
        (payable && activeProfile.role === 'owner' ? '<form class="client-desk-message-form" data-action="manual-paid" data-invoice="' + escapeHtml(invoice.id) + '"><label class="client-desk-checkline"><input name="verified" type="checkbox" required><span>I verified this EFT in the bank account.</span></label><button class="btn ghost" type="submit">Record manual payment</button></form>' : '') + '</div>';
    }).join('') + '</div>';
  }

  function renderQuotes(project) {
    var quotes = projectQuotes(project.id);
    if (!quotes.length) return '<p class="client-desk-footnote">A written quote will appear here before any work or payment is agreed.</p>';
    return quotes.map(function (quote) {
      var accept = quote.status === 'sent';
      return '<article class="client-desk-card"><div class="client-desk-card-meta"><span>Quote v' + escapeHtml(quote.version) + '</span><span class="client-desk-status">' + escapeHtml(quote.status) + '</span></div><p class="client-desk-money">' + escapeHtml(money(quote.total_minor, quote.currency)) + '</p><p><strong>Scope</strong><br>' + escapeHtml(quote.scope) + '</p><p><strong>Deliverables</strong><br>' + escapeHtml(quote.deliverables) + '</p>' + (quote.exclusions ? '<p><strong>Not included</strong><br>' + escapeHtml(quote.exclusions) + '</p>' : '') + '<p class="client-desk-footnote">Valid until ' + escapeHtml(dateLabel(quote.valid_until)) + '</p>' + (accept ? '<button class="btn" type="button" data-action="accept-quote" data-quote="' + escapeHtml(quote.id) + '">Accept this quote</button>' : '') + '</article>';
    }).join('');
  }

  function renderOwnerTools(project) {
    if (activeProfile.role !== 'owner') return '';
    return '<div class="client-desk-card"><h3>Admin controls</h3><div class="client-desk-field-grid"><div class="field"><label class="client-desk-label" for="status-' + escapeHtml(project.id) + '">Project status</label><select id="status-' + escapeHtml(project.id) + '" data-action="set-status" data-project="' + escapeHtml(project.id) + '">' + statuses.map(function (entry) { return '<option value="' + entry[0] + '" ' + (project.status === entry[0] ? 'selected' : '') + '>' + entry[1] + '</option>'; }).join('') + '</select></div><div class="field"><label class="client-desk-label" for="next-' + escapeHtml(project.id) + '">Next action</label><input id="next-' + escapeHtml(project.id) + '" data-action="set-next" data-project="' + escapeHtml(project.id) + '" type="text" maxlength="240" value="' + escapeHtml(project.next_action || '') + '" placeholder="e.g. Review homepage draft"></div></div><button class="btn ghost" type="button" data-action="save-project" data-project="' + escapeHtml(project.id) + '">Save project update</button>' +
      '<details><summary>Manage customer checklist</summary><form class="client-desk-message-form" data-action="checklist-add" data-project="' + escapeHtml(project.id) + '"><label class="client-desk-label">Item</label><input name="title" type="text" required maxlength="240" placeholder="e.g. Upload site logo"><div class="client-desk-field-grid"><div class="field"><label class="client-desk-label">Assigned to</label><select name="owner_kind"><option value="customer">Customer</option><option value="owner">FixerCtrl</option></select></div><div class="field"><label class="client-desk-label">Due date (optional)</label><input name="due_at" type="date"></div></div><label class="client-desk-checkline"><input name="internal" type="checkbox"><span>Private owner-only item</span></label><button class="btn ghost" type="submit">Add checklist item</button></form></details>' +
      renderQuoteBuilder(project) + '</div>' + renderTeamTools(project);
  }

  function renderTeamTools(project) {
    if (activeProfile.role !== 'owner') return '';
    var freelancers = relatedData.freelancers || [];
    var assignments = (relatedData.teamAssignments || []).filter(function (assignment) { return assignment.project_id === project.id; });
    var assignedIds = assignments.map(function (assignment) { return assignment.user_id; });
    return '<details class="client-desk-card"><summary><strong>Project team</strong></summary><p class="client-desk-footnote">Assigned freelancers can see this project, share public updates, and add project files. They cannot see private notes, quotes, or invoices.</p>' +
      (freelancers.length ? '<form class="client-desk-message-form" data-action="team" data-project="' + escapeHtml(project.id) + '"><fieldset><legend class="client-desk-label">Freelancers with access</legend>' + freelancers.map(function (freelancer) {
        var displayName = freelancer.display_name || freelancer.email;
        return '<label class="client-desk-checkline"><input type="checkbox" name="freelancer" value="' + escapeHtml(freelancer.id) + '" ' + (assignedIds.indexOf(freelancer.id) !== -1 ? 'checked' : '') + '><span>' + escapeHtml(displayName) + ' / ' + escapeHtml(freelancer.email) + '</span></label>';
      }).join('') + '</fieldset><button class="btn ghost" type="submit">Save project team</button></form>' : '<p class="client-desk-footnote">No freelancer accounts yet. Add an Auth account in Supabase, then enable freelancer access below.</p>') + '</details>';
  }

  function renderFreelancerTools(project) {
    if (activeProfile.role !== 'freelancer') return '';
    return '<div class="client-desk-card"><h3>Update client progress</h3><p class="client-desk-footnote">Saving a status or next step adds a dated update to the client’s project timeline. No message is required.</p><div class="client-desk-field-grid"><div class="field"><label class="client-desk-label" for="status-' + escapeHtml(project.id) + '">Project status</label><select id="status-' + escapeHtml(project.id) + '" data-action="set-status" data-project="' + escapeHtml(project.id) + '">' + statuses.map(function (entry) { return '<option value="' + entry[0] + '" ' + (project.status === entry[0] ? 'selected' : '') + '>' + entry[1] + '</option>'; }).join('') + '</select></div><div class="field"><label class="client-desk-label" for="next-' + escapeHtml(project.id) + '">Next action</label><input id="next-' + escapeHtml(project.id) + '" data-action="set-next" data-project="' + escapeHtml(project.id) + '" type="text" maxlength="240" value="' + escapeHtml(project.next_action || '') + '" placeholder="e.g. Test the updated checkout"></div></div><button class="btn ghost" type="button" data-action="save-project" data-project="' + escapeHtml(project.id) + '">Save progress update</button></div>';
  }

  function renderProject(project) {
    var status = statuses.find(function (entry) { return entry[0] === project.status; });
    var freelancer = activeProfile.role === 'freelancer';
    var overview = projectOverview(project);
    return '<details class="client-desk-project" data-project-details data-project-id="' + escapeHtml(project.id) + '"><summary><span class="client-desk-project-heading"><span class="client-desk-label">' + escapeHtml(project.reference || project.id.slice(0, 8)) + ' / ' + escapeHtml(project.service_category.replace('_', ' ')) + '</span><strong>' + escapeHtml(project.title) + '</strong></span><div class="client-desk-project-summary-status"><span class="client-desk-status">' + escapeHtml(status ? status[1] : project.status) + '</span><span class="client-desk-project-percent">' + projectProgress(project.id) + '% complete</span>' + renderProgressBar(projectProgress(project.id), project.title + ' progress') + '</div><span class="client-desk-project-summary-brief"><span><strong>Next milestone</strong>' + escapeHtml(overview.nextMilestone) + '</span><span><strong>Action from you</strong>' + escapeHtml(overview.clientAction) + '</span><span><strong>Last update</strong>' + escapeHtml(overview.lastEvent ? overview.lastEvent.title + ' / ' + dateLabel(overview.lastEvent.created_at) : 'No updates yet') + '</span></span></summary>' +
      renderProjectProgress(project) + '<div class="client-desk-project-body"><div><div class="client-desk-section-head"><h2>Activity</h2><span class="client-desk-footnote">Updated ' + escapeHtml(dateLabel(project.updated_at)) + '</span></div>' + (project.next_action ? '<div class="client-desk-notice"><div><strong>Next step</strong><p>' + escapeHtml(project.next_action) + '</p></div></div>' : '') + renderTimeline(project) +
      '<section data-portal-section="messages"><div class="client-desk-section-head"><h2>Conversation</h2></div>' + renderMessages(project) + '</section></div><div><h3>What is needed</h3>' + renderChecklist(project) + renderFiles(project) + (freelancer ? '' : '<section data-portal-section="billing"><div class="client-desk-section-head"><h2>Quote</h2></div>' + renderQuotes(project) + '<div class="client-desk-section-head"><h2>Payments</h2></div>' + renderInvoices(project) + '</section>') + '</div></div>' + renderOwnerTools(project) + renderFreelancerTools(project) + '</details>';
  }

  function renderOwnerSummary() {
    if (activeProfile.role !== 'owner') return '';
    var waiting = projectCache.filter(function (project) { return ['received', 'awaiting_customer', 'awaiting_approval', 'awaiting_payment'].indexOf(project.status) !== -1; }).length;
    return '<div class="client-desk-grid"><article class="client-desk-card"><span class="client-desk-label">Open projects</span><p class="client-desk-money">' + projectCache.filter(function (project) { return project.status !== 'complete'; }).length + '</p></article><article class="client-desk-card"><span class="client-desk-label">Awaiting an action</span><p class="client-desk-money">' + waiting + '</p></article></div>';
  }

  function renderFreelancerSummary() {
    var active = projectCache.filter(function (project) { return project.status !== 'complete'; }).length;
    return '<div class="client-desk-grid"><article class="client-desk-card"><span class="client-desk-label">Assigned projects</span><p class="client-desk-money">' + projectCache.length + '</p></article><article class="client-desk-card"><span class="client-desk-label">Still active</span><p class="client-desk-money">' + active + '</p></article></div>';
  }

  function renderFreelancerAccounts() {
    if (activeProfile.role !== 'owner') return '';
    var profiles = (relatedData.profiles || []).filter(function (profile) { return profile.role === 'customer' || profile.role === 'freelancer'; });
    return '<details class="client-desk-card" id="clientDeskTeam" data-portal-section="team"><summary><strong>Freelancer accounts</strong></summary><p class="client-desk-footnote">Create or invite accounts in Supabase Auth first. Enabling freelancer access here limits each account to projects you assign.</p>' +
      (profiles.length ? profiles.map(function (profile) {
        return '<form class="client-desk-account-role" data-action="freelancer-role"><div><strong>' + escapeHtml(profile.display_name || profile.email) + '</strong><span class="client-desk-footnote">' + escapeHtml(profile.email) + '</span></div><label class="client-desk-label" for="role-' + escapeHtml(profile.id) + '">Portal access</label><select id="role-' + escapeHtml(profile.id) + '" name="role"><option value="customer" ' + (profile.role === 'customer' ? 'selected' : '') + '>Customer</option><option value="freelancer" ' + (profile.role === 'freelancer' ? 'selected' : '') + '>Freelancer</option></select><input name="user_id" type="hidden" value="' + escapeHtml(profile.id) + '"><button class="btn ghost" type="submit">Save access</button></form>';
      }).join('') : '<p class="client-desk-footnote">No other accounts have signed in yet. Create an account in Supabase Auth first.</p>') + '</details>';
  }

  function renderAccountDeletion() {
    if (activeProfile.role !== 'customer') return '';
    return '<details class="client-desk-card"><summary><strong>Delete my Client Portal account</strong></summary>' +
      '<p>This permanently removes your sign-in and replaces your name and email with anonymized details. Project history, messages, shared files, quotes, and invoice records are retained for business records, but will no longer be linked to your identity. This cannot be undone.</p>' +
      '<form class="client-desk-message-form" data-action="delete-profile"><div class="field"><label class="client-desk-label" for="deleteAccountPassword">Confirm with your current password</label><input id="deleteAccountPassword" name="password" type="password" autocomplete="current-password" required></div><label class="client-desk-checkline"><input type="checkbox" name="confirm" required><span>I understand my login will be removed and project records will be retained in anonymized form.</span></label><button class="btn ghost client-desk-danger" type="submit">Delete my account</button><p class="client-desk-form-status" data-portal-status aria-live="polite"></p></form></details>';
  }

  function renderPendingDeletion() {
    renderShell('<div class="client-desk-notice"><div><strong>Account deletion in progress</strong><p>Your profile has been anonymized and portal access is disabled. Finish removing the sign-in below. If the operation continues to fail, contact FixerCtrl for help.</p>' +
      '<form class="client-desk-message-form" data-action="delete-profile"><div class="field"><label class="client-desk-label" for="finishDeletionPassword">Confirm with your current password</label><input id="finishDeletionPassword" name="password" type="password" autocomplete="current-password" required></div><label class="client-desk-checkline"><input type="checkbox" name="confirm" required><span>Continue removing this sign-in.</span></label><button class="btn ghost client-desk-danger" type="submit">Finish account deletion</button><p class="client-desk-form-status" data-portal-status aria-live="polite"></p></form></div></div>', activeProfile);
  }

  function renderPaymentSettings() {
    if (activeProfile.role !== 'owner') return '';
    var providers = relatedData.providers || [];
    return '<details class="client-desk-card" id="clientDeskFinance" data-portal-section="finance"><summary><strong>Payment methods</strong></summary><p class="client-desk-footnote">Gateway secrets belong in Supabase Edge Function secrets. Enable a provider here only after its merchant account and server settings are configured.</p><form class="client-desk-message-form" data-action="payment-settings">' +
      providers.map(function (provider) {
        return '<label class="client-desk-checkline"><input type="checkbox" name="provider_' + escapeHtml(provider.provider) + '" ' + (provider.is_enabled ? 'checked' : '') + '><span><strong>' + escapeHtml(provider.label) + '</strong> / ' + (provider.is_enabled ? 'Available to customers' : 'Hidden from customers') + '</span></label>';
      }).join('') +
      '<div class="field"><label class="client-desk-label" for="eftInstructions">Manual EFT instructions (shown to customers)</label><textarea id="eftInstructions" name="eft_instructions" maxlength="1500">' + escapeHtml((providers.find(function (provider) { return provider.provider === 'eft'; }) || {}).public_instructions || '') + '</textarea></div><button class="btn ghost" type="submit">Save payment methods</button></form></details>';
  }

  function renderQuoteBuilder(project) {
    return '<details><summary>Prepare quote and payment schedule</summary><form class="client-desk-message-form" data-action="quote" data-project="' + escapeHtml(project.id) + '"><div class="field"><label class="client-desk-label">Scope</label><textarea name="scope" required maxlength="5000"></textarea></div><div class="field"><label class="client-desk-label">Deliverables</label><textarea name="deliverables" required maxlength="3000"></textarea></div><div class="field"><label class="client-desk-label">Exclusions and third-party costs</label><textarea name="exclusions" maxlength="3000"></textarea></div><div class="client-desk-field-grid"><div class="field"><label class="client-desk-label">Quote total (ZAR)</label><input name="total" type="number" min="0.01" step="0.01" required></div><div class="field"><label class="client-desk-label">Quote valid until</label><input name="valid_until" type="date" required></div></div><h4>Payment milestones</h4><div data-milestone-list><div class="client-desk-field-grid" data-milestone-row><div class="field"><label class="client-desk-label">Milestone name</label><input name="milestone_description" required maxlength="240" placeholder="e.g. Project deposit"></div><div class="field"><label class="client-desk-label">Amount (ZAR)</label><input name="milestone_amount" type="number" min="0.01" step="0.01" required></div><div class="field"><label class="client-desk-label">Payment due</label><input name="milestone_due" type="date" required></div><div class="field"><label class="client-desk-label">Email invoice on</label><input name="milestone_send" type="datetime-local" required></div><button class="btn ghost" type="button" data-action="remove-milestone" aria-label="Remove payment milestone">Remove</button></div></div><button class="btn ghost" type="button" data-action="add-milestone">Add milestone</button><label class="client-desk-checkline"><input name="confirm" type="checkbox" required><span>I checked that the scope, total, dates, and milestone amounts are clear and add up to the quoted total.</span></label><button class="btn" type="submit">Send quote for customer approval</button></form></details>';
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
    var projectResult = await client.from('projects').select('*').order('updated_at', { ascending: false });
    if (projectResult.error) throw projectResult.error;
    projectCache = projectResult.data || [];
    var ids = projectCache.map(function (project) { return project.id; });
    relatedData = { checklist: [], messages: [], invoices: [], quotes: [], events: [], files: [], profiles: [], providers: [], freelancers: [], teamAssignments: [], stages: [], steps: [] };
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
      var profiles = await client.from('client_profiles').select('id,email,display_name,role');
      if (profiles.error) throw profiles.error;
      relatedData.profiles = profiles.data || [];
      relatedData.freelancers = relatedData.profiles.filter(function (profile) { return profile.role === 'freelancer'; });
    }
    var providersQuery = client.from('payment_providers').select('provider,label,is_enabled,public_instructions');
    if (activeProfile.role !== 'owner') providersQuery = providersQuery.eq('is_enabled', true);
    var providers = await providersQuery;
    if (!providers.error) relatedData.providers = providers.data || [];
    renderDashboard();
  }

  function renderDashboard() {
    var openProjectIds = Array.prototype.map.call(portalRoot.querySelectorAll('details[data-project-details][open]'), function (element) {
      return element.dataset.projectId;
    });
    var owner = activeProfile.role === 'owner';
    var freelancer = activeProfile.role === 'freelancer';
    var heading = owner ? 'Admin work queue' : freelancer ? 'Assigned work' : 'Your projects';
    var emptyHeading = owner ? 'No requests yet' : freelancer ? 'No projects assigned' : 'Nothing in progress';
    var emptyMessage = owner ? 'New customer requests will appear here.' : freelancer ? 'Projects assigned to you by the FixerCtrl admin will appear here.' : 'Send a request to start a conversation about your project.';
    var content = '<div id="clientDeskHome" class="client-desk-workspace"><div class="client-desk-main"><div class="client-desk-section-head"><div><h2>' + heading + '</h2><p class="client-desk-footnote">' + escapeHtml(activeProfile.email) + '</p></div><div class="client-desk-owner-tools"><button class="btn ghost" type="button" data-action="refresh" aria-label="Refresh projects"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M5.5 9A7 7 0 0 1 18 6l2 2M4 16l2 2a7 7 0 0 0 12.5-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' + (!owner && !freelancer ? '<button class="btn" type="button" data-action="new-request">New request</button>' : '') + '</div></div>' +
      (owner ? renderOwnerSummary() + renderPaymentSettings() + '<div id="clientDeskClients">' + renderFreelancerAccounts() + '</div>' : freelancer ? renderFreelancerSummary() + '<div class="client-desk-notice"><div><strong>Keep the client dashboard current</strong><p>Save a status or next step when work progresses. These updates are added to the client’s project timeline without requiring a message.</p></div></div>' : buildRequestForm() + renderAccountDeletion()) + '<p class="client-desk-form-status" data-portal-status aria-live="polite"></p>' +
      '<div id="clientDeskProjects">' + (projectCache.length ? projectCache.map(renderProject).join('') : '<div class="client-desk-empty"><h3>' + emptyHeading + '</h3><p>' + emptyMessage + '</p></div>') + '</div><p class="client-desk-search-empty" data-portal-search-empty hidden>No matching projects. Try another search.</p>' +
      '</div><aside class="client-desk-sidebar">' + (freelancer ? '<h2>Assigned access</h2><p>You can view the projects assigned to your account, post client-visible progress and conversation updates, and share project files.</p><p>You cannot access client invoices, payment settings, private owner notes, or unassigned projects.</p>' : '<h2>Payment clarity</h2><p>Every quote states the agreed scope, total, due conditions, and any third-party costs before work begins.</p><p>Invoices are sent on the date shown in your agreed schedule. A project status change never charges you by itself.</p><p class="client-desk-footnote">Payments are processed by the selected provider. FixerCtrl does not store card details.</p>') + (!owner && !freelancer ? '<h2>Indicative service guide</h2><ul><li>Landing page: R1,500–R3,000</li><li>Up to 5 website pages: R3,500–R7,500</li><li>Website updates: R250/hour</li><li>Setup: from R500</li><li>Features: from R800</li></ul><p class="client-desk-footnote">IT and security work is quoted after review. These are guides, not your quote. <a href="#/freelancer">Full pricing details</a></p>' : '') + '</aside></div>';
    renderShell(content, activeProfile);
    openProjectIds.forEach(function (projectId) {
      var details = Array.prototype.find.call(portalRoot.querySelectorAll('details[data-project-details]'), function (element) {
        return element.dataset.projectId === projectId;
      });
      if (details) details.open = true;
    });
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
    setStatus('Request received. FixerCtrl will review it and follow up here.', false);
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
    setStatus('Message sent.', false);
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
    setStatus('Checklist updated.', false);
  }

  async function submitPaymentSettings(form) {
    if (activeProfile.role !== 'owner') throw new Error('Owner access is required.');
    var data = new FormData(form);
    var eftInstructions = String(data.get('eft_instructions') || '').trim();
    for (var index = 0; index < relatedData.providers.length; index++) {
      var provider = relatedData.providers[index];
      var enabled = data.has('provider_' + provider.provider);
      if (provider.provider === 'eft' && enabled && !eftInstructions) throw new Error('Add EFT instructions before enabling manual EFT.');
      var update = await client.from('payment_providers').update({
        is_enabled: enabled,
        public_instructions: provider.provider === 'eft' ? eftInstructions : provider.public_instructions
      }).eq('provider', provider.provider);
      if (update.error) throw update.error;
    }
    await loadWorkspace();
    setStatus('Payment methods saved.', false);
  }

  async function submitFreelancerRole(form) {
    if (activeProfile.role !== 'owner') throw new Error('Admin access is required.');
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
    if (activeProfile.role !== 'owner') throw new Error('Admin access is required.');
    var result = await client.rpc('owner_set_project_team', {
      p_project_id: form.dataset.project,
      p_freelancer_ids: new FormData(form).getAll('freelancer')
    });
    if (result.error) throw result.error;
    await loadWorkspace();
    setStatus('Project team saved.', false);
  }

  async function submitFile(form) {
    var data = new FormData(form);
    var file = data.get('file');
    var extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
    if (!file || !file.size) throw new Error('Choose a file to upload.');
    if (!extensions[file.type]) throw new Error('Only JPG, PNG, WebP, or PDF files are allowed.');
    if (file.size > 10485760) throw new Error('Files must be 10 MB or smaller.');
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
    setStatus('File uploaded to this private project.', false);
  }

  async function submitQuote(form) {
    var data = new FormData(form);
    var cents = Math.round(Number(data.get('total')) * 100);
    if (!Number.isSafeInteger(cents) || cents < 1) throw new Error('Enter a valid quote amount.');
    var descriptions = data.getAll('milestone_description');
    var amounts = data.getAll('milestone_amount');
    var dueDates = data.getAll('milestone_due');
    var sendTimes = data.getAll('milestone_send');
    var schedule = descriptions.map(function (description, index) {
      var amountMinor = Math.round(Number(amounts[index]) * 100);
      if (!Number.isSafeInteger(amountMinor) || amountMinor < 1) throw new Error('Each milestone needs a valid amount.');
      if (!dueDates[index] || !sendTimes[index]) throw new Error('Choose a due date and invoice email time for every milestone.');
      return {
        description: String(description).trim(),
        amount_minor: String(amountMinor),
        due_at: new Date(String(dueDates[index]) + 'T12:00:00').toISOString(),
        email_send_at: new Date(String(sendTimes[index])).toISOString()
      };
    });
    var sum = schedule.reduce(function (total, item) { return total + Number(item.amount_minor); }, 0);
    if (sum !== cents) throw new Error('Milestone amounts must add up exactly to the quote total.');
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
    setStatus('Quote sent. The invoice schedule will activate after customer acceptance.', false);
  }

  async function handleAction(event) {
    var target = event.target.closest('[data-action]');
    if (!target || !client) return;
    var action = target.dataset.action;
    try {
      if (action === 'signout') {
        await client.auth.signOut();
        activeProfile = null;
        renderSignIn();
      } else if (action === 'notifications') {
        var panel = portalRoot.querySelector('[data-notification-panel]');
        var open = panel && panel.hidden;
        if (panel) panel.hidden = !open;
        target.setAttribute('aria-expanded', open ? 'true' : 'false');
      } else if (action === 'theme') {
        portalTheme = portalTheme === 'light' ? 'dark' : 'light';
        applyPortalTheme();
        target.innerHTML = portalIcon(portalTheme === 'light' ? 'moon' : 'sun') + (portalTheme === 'light' ? 'Switch to dark mode' : 'Switch to light mode');
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
        setStatus(target.dataset.status === 'done' ? 'Step approved. The project progress has been updated.' : 'Changes requested. Your feedback is in the project activity feed.', false);
      } else if (action === 'assign-step') {
        target.disabled = true;
        var stepRow = target.closest('.client-desk-step');
        var ownerField = stepRow && stepRow.querySelector('[data-step-owner]');
        var dueField = stepRow && stepRow.querySelector('[data-step-due]');
        if (!ownerField || !dueField) throw new Error('The step assignment controls could not be found.');
        var assignment = await client.rpc('owner_assign_project_step', {
          p_step_id: target.dataset.step,
          p_owner_id: ownerField.value || null,
          p_due_at: dueField.value ? new Date(dueField.value + 'T23:59:00').toISOString() : null
        });
        if (assignment.error) throw assignment.error;
        await loadWorkspace();
        setStatus('Step owner and due date saved.', false);
      } else if (action === 'new-request') {
        var panel = portalRoot.querySelector('[data-request-panel]');
        if (panel) { panel.open = true; panel.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      } else if (action === 'refresh') {
        target.disabled = true;
        await loadWorkspace();
        setStatus('Workspace refreshed.', false);
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
          if (!['https://www.payfast.co.za', 'https://sandbox.payfast.co.za'].includes(payFastAction.origin) || payFastAction.pathname !== '/eng/process') throw new Error('Invalid PayFast checkout destination.');
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
        } else throw new Error('The payment provider did not return a valid checkout link.');
      } else if (action === 'retry-invoice') {
        if (activeProfile.role !== 'owner') throw new Error('Owner access is required.');
        var retry = await client.rpc('owner_retry_invoice_email', { p_invoice_id: target.dataset.invoice });
        if (retry.error) throw retry.error;
        await loadWorkspace();
        setStatus('Invoice email queued for retry.', false);
      } else if (action === 'accept-quote') {
        target.disabled = true;
        var accepted = await client.rpc('accept_project_quote', { p_quote_id: target.dataset.quote });
        if (accepted.error) throw accepted.error;
        await loadWorkspace();
        setStatus('Quote accepted. The agreed invoice schedule is now active.', false);
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
        setStatus('Project update saved.', false);
      }
    } catch (error) {
      setStatus(error.message || 'This action could not be completed. Please retry.', true);
      target.disabled = false;
    }
  }

  function handlePortalNavigation(event) {
    var link = event.target.closest('[data-portal-nav]');
    if (!link || link.getAttribute('aria-disabled') === 'true') return;
    event.preventDefault();
    var targetName = link.dataset.target;
    var target = document.getElementById(targetName);
    if (!target && ['messages', 'files', 'billing', 'finance', 'team'].indexOf(targetName) !== -1) {
      target = portalRoot.querySelector('[data-portal-section="' + targetName + '"]');
    }
    if (!target) return;
    var project = target.closest('details[data-project-details]');
    if (project) project.open = true;
    var expandable = target.matches('details') ? target : null;
    if (expandable) expandable.open = true;
    var label = link.querySelector('span');
    currentPortalSection = label ? label.textContent.trim() : 'Workspace';
    portalRoot.querySelectorAll('[data-portal-nav]').forEach(function (item) {
      if (item.querySelector('span') && item.querySelector('span').textContent.trim() === currentPortalSection) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });
    var breadcrumb = portalRoot.querySelector('[data-current-section]');
    var title = portalRoot.querySelector('.client-desk-topbar-title > strong');
    if (breadcrumb) breadcrumb.textContent = currentPortalSection;
    if (title) title.textContent = currentPortalSection;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    var moreMenu = portalRoot.querySelector('.client-desk-mobile-more');
    if (moreMenu) moreMenu.open = false;
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
      portalRoot.querySelectorAll('.client-desk-user-menu, .client-desk-mobile-more').forEach(function (menu) { menu.open = false; });
    }
  }

  function handleOutsideClick(event) {
    if (!portalRoot || event.target.closest('.client-desk-notification-wrap')) return;
    var panel = portalRoot.querySelector('[data-notification-panel]');
    var button = portalRoot.querySelector('[data-action="notifications"]');
    if (panel) panel.hidden = true;
    if (button) button.setAttribute('aria-expanded', 'false');
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
          setStatus('Customer account created. Your workspace is ready.', false, form);
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
      else if (action === 'delete-profile') {
        var deletionCredentials = new FormData(form);
        if ((activeProfile.role !== 'customer' && activeProfile.role !== 'deleted') || !deletionCredentials.get('confirm')) {
          throw new Error('Confirm that you want to permanently delete this customer account.');
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
        setStatus('Your Client Portal sign-in has been removed. Project records remain in anonymized form.', false);
      }
      else if (action === 'manual-paid') {
        if (activeProfile.role !== 'owner' || !new FormData(form).get('verified')) throw new Error('Confirm the bank receipt before recording payment.');
        var reconciliation = await client.rpc('owner_mark_invoice_paid', { p_invoice_id: form.dataset.invoice });
        if (reconciliation.error) throw reconciliation.error;
        await loadWorkspace();
        setStatus('Manual payment reconciled and recorded.', false);
      }
      else if (action === 'quote') await submitQuote(form);
    } catch (error) {
      setStatus(error.message || 'This request could not be completed.', true, form);
    } finally {
      if (submit && document.body.contains(submit)) submit.disabled = false;
    }
  }

  async function handleChange(event) {
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
      renderSignIn();
      return;
    }
    activeProfile = { id: session.user.id, email: session.user.email };
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
      showSetupRequired('The Supabase project URL and public client key have not been configured.');
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
  document.addEventListener('click', handlePortalNavigation);
  document.addEventListener('click', handleOutsideClick);
  document.addEventListener('submit', handleSubmit);
  document.addEventListener('change', handleChange);
  document.addEventListener('input', handlePortalSearch);
  document.addEventListener('keydown', handlePortalKeydown);
})();
