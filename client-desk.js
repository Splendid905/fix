(function () {
  'use strict';

  var client = null;
  var portalRoot = null;
  var activeProfile = null;
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

  function setStatus(message, isError) {
    var status = portalRoot && portalRoot.querySelector('[data-portal-status]');
    if (!status) return;
    status.textContent = message || '';
    status.setAttribute('role', isError ? 'alert' : 'status');
    status.classList.toggle('is-error', Boolean(isError));
  }

  function renderShell(content, profile) {
    var name = profile ? (profile.display_name || profile.email || 'Customer') : 'Private workspace';
    portalRoot.innerHTML = '<header class="client-desk-head"><div><p class="client-desk-kicker">FixerCtrl / Client Desk</p><h1>Project control room</h1><p>Clear scope, visible progress, and payment details in one private workspace.</p></div>' +
      (profile ? '<div class="client-desk-account"><span class="client-desk-label">' + escapeHtml(name) + '</span><button class="btn ghost" type="button" data-action="signout">Sign out</button></div>' : '') +
      '</header>' + content;
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
    script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
    script.async = true;
    script.dataset.supabaseClient = 'true';
    script.onload = done;
    script.onerror = function () { showSetupRequired('The authentication library could not load. Check the network and retry.'); };
    document.head.appendChild(script);
  }

  function renderSignIn() {
    renderShell('<form class="client-desk-form" data-action="signin"><p class="client-desk-kicker">Customer access</p><h2>Sign in to your workspace</h2>' +
      '<p>We will email you a secure sign-in link. Use the same email address you gave for your project.</p>' +
      '<div class="field"><label class="client-desk-label" for="portalEmail">Email address</label><input id="portalEmail" name="email" type="email" autocomplete="email" required maxlength="254" placeholder="you@example.com"></div>' +
      '<button class="btn" type="submit">Email me a sign-in link</button><p class="client-desk-form-status" data-portal-status aria-live="polite"></p>' +
      '<p class="client-desk-footnote">Only your account can access your projects and files. Do not share a sign-in link with anyone.</p></form>', null);
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

  function renderTimeline(project) {
    var events = projectEvents(project.id);
    if (!events.length) return '<p class="client-desk-footnote">Progress updates will appear here as work moves forward.</p>';
    return '<ol class="client-desk-timeline">' + events.map(function (event) {
      return '<li class="' + (event.status === project.status ? 'is-current' : 'is-done') + '"><strong>' + escapeHtml(event.title) + '</strong><br>' + escapeHtml(event.description || '') + '<br><small>' + escapeHtml(dateLabel(event.created_at)) + '</small></li>';
    }).join('') + '</ol>';
  }

  function renderChecklist(project) {
    var items = projectChecklist(project.id);
    if (!items.length) return '<p class="client-desk-footnote">No outstanding items.</p>';
    return '<ul class="client-desk-checklist">' + items.map(function (item) {
      var owner = item.owner_kind === 'customer' ? 'You' : 'FixerCtrl';
      var canComplete = item.owner_kind === 'customer' && !item.completed_at;
      return '<li><input type="checkbox" data-action="checklist" data-id="' + escapeHtml(item.id) + '" ' + (item.completed_at ? 'checked disabled' : canComplete ? '' : 'disabled') + ' aria-label="' + escapeHtml(owner + ': ' + item.title) + '"><span><strong>' + escapeHtml(owner) + ':</strong> ' + escapeHtml(item.title) + (item.due_at ? '<br><small>Due ' + escapeHtml(dateLabel(item.due_at)) + '</small>' : '') + '</span></li>';
    }).join('') + '</ul>';
  }

  function renderMessages(project) {
    var messages = projectMessages(project.id);
    return '<ul class="client-desk-message-list">' + (messages.length ? messages.map(function (message) {
      var author = 'FixerCtrl';
      if (message.author_id === activeProfile.id) author = activeProfile.role === 'owner' ? 'FixerCtrl' : 'You';
      else if (activeProfile.role === 'owner') {
        var authorProfile = (relatedData.profiles || []).find(function (profile) { return profile.id === message.author_id; });
        author = authorProfile ? authorProfile.email : 'Customer';
      }
      return '<li class="client-desk-message"><small>' + escapeHtml(author) + (message.is_internal ? ' / INTERNAL' : '') + ' / ' + escapeHtml(dateLabel(message.created_at)) + '</small><p>' + escapeHtml(message.body) + '</p></li>';
    }).join('') : '<li class="client-desk-footnote">No messages yet.</li>') + '</ul>' +
      '<form class="client-desk-message-form" data-action="message" data-project="' + escapeHtml(project.id) + '"><label class="client-desk-label" for="message-' + escapeHtml(project.id) + '">' + (activeProfile.role === 'owner' ? 'Reply to customer' : 'Message FixerCtrl') + '</label><textarea id="message-' + escapeHtml(project.id) + '" name="body" required maxlength="5000" placeholder="Write a project update or question"></textarea>' + (activeProfile.role === 'owner' ? '<label class="client-desk-checkline"><input name="internal" type="checkbox"><span>Private note (only visible to FixerCtrl)</span></label>' : '') + '<button class="btn" type="submit">Send message</button><p class="client-desk-footnote">A notification email will be sent when email delivery is configured.</p></form>';
  }

  function renderFiles(project) {
    var files = (relatedData.files || []).filter(function (file) { return file.project_id === project.id; });
    return '<div class="client-desk-section-head"><h2>Files and materials</h2></div>' +
      (files.length ? '<ul class="client-desk-checklist">' + files.map(function (file) {
        return '<li><span aria-hidden="true">FILE</span><span><a href="' + escapeHtml(file.signed_url || '#') + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(file.file_name) + '</a> / ' + escapeHtml(dateLabel(file.created_at)) + (file.is_internal ? ' / INTERNAL' : '') + '</span></li>';
      }).join('') + '</ul>' : '<p class="client-desk-footnote">No files have been shared yet.</p>') +
      '<form class="client-desk-message-form" data-action="upload" data-project="' + escapeHtml(project.id) + '"><label class="client-desk-label" for="upload-' + escapeHtml(project.id) + '">Add a file (JPG, PNG, WebP, or PDF; 10 MB max)</label><input id="upload-' + escapeHtml(project.id) + '" name="file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required>' + (activeProfile.role === 'owner' ? '<label class="client-desk-checkline"><input name="internal" type="checkbox"><span>Private file (only visible to FixerCtrl)</span></label>' : '') + '<button class="btn ghost" type="submit">Upload file</button></form>';
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
    return '<div class="client-desk-card"><h3>Owner controls</h3><div class="client-desk-field-grid"><div class="field"><label class="client-desk-label" for="status-' + escapeHtml(project.id) + '">Project status</label><select id="status-' + escapeHtml(project.id) + '" data-action="set-status" data-project="' + escapeHtml(project.id) + '">' + statuses.map(function (entry) { return '<option value="' + entry[0] + '" ' + (project.status === entry[0] ? 'selected' : '') + '>' + entry[1] + '</option>'; }).join('') + '</select></div><div class="field"><label class="client-desk-label" for="next-' + escapeHtml(project.id) + '">Next action</label><input id="next-' + escapeHtml(project.id) + '" data-action="set-next" data-project="' + escapeHtml(project.id) + '" type="text" maxlength="240" value="' + escapeHtml(project.next_action || '') + '" placeholder="e.g. Review homepage draft"></div></div><button class="btn ghost" type="button" data-action="save-project" data-project="' + escapeHtml(project.id) + '">Save project update</button>' +
      '<details><summary>Manage customer checklist</summary><form class="client-desk-message-form" data-action="checklist-add" data-project="' + escapeHtml(project.id) + '"><label class="client-desk-label">Item</label><input name="title" type="text" required maxlength="240" placeholder="e.g. Upload site logo"><div class="client-desk-field-grid"><div class="field"><label class="client-desk-label">Assigned to</label><select name="owner_kind"><option value="customer">Customer</option><option value="owner">FixerCtrl</option></select></div><div class="field"><label class="client-desk-label">Due date (optional)</label><input name="due_at" type="date"></div></div><label class="client-desk-checkline"><input name="internal" type="checkbox"><span>Private owner-only item</span></label><button class="btn ghost" type="submit">Add checklist item</button></form></details>' +
      renderQuoteBuilder(project) + '</div>';
  }

  function renderProject(project) {
    var status = statuses.find(function (entry) { return entry[0] === project.status; });
    return '<details class="client-desk-project" data-project-details><summary><span><span class="client-desk-label">' + escapeHtml(project.reference || project.id.slice(0, 8)) + ' / ' + escapeHtml(project.service_category.replace('_', ' ')) + '</span><strong>' + escapeHtml(project.title) + '</strong></span><span class="client-desk-status">' + escapeHtml(status ? status[1] : project.status) + '</span></summary>' +
      '<div class="client-desk-project-body"><div><div class="client-desk-section-head"><h2>Progress</h2><span class="client-desk-footnote">Updated ' + escapeHtml(dateLabel(project.updated_at)) + '</span></div>' + (project.next_action ? '<div class="client-desk-notice"><div><strong>Next step</strong><p>' + escapeHtml(project.next_action) + '</p></div></div>' : '') + renderTimeline(project) +
      '<div class="client-desk-section-head"><h2>Conversation</h2></div>' + renderMessages(project) + '</div><div><h3>What is needed</h3>' + renderChecklist(project) + renderFiles(project) + '<div class="client-desk-section-head"><h2>Quote</h2></div>' + renderQuotes(project) + '<div class="client-desk-section-head"><h2>Payments</h2></div>' + renderInvoices(project) + '</div></div>' + renderOwnerTools(project) + '</details>';
  }

  function renderOwnerSummary() {
    if (activeProfile.role !== 'owner') return '';
    var waiting = projectCache.filter(function (project) { return ['received', 'awaiting_customer', 'awaiting_approval', 'awaiting_payment'].indexOf(project.status) !== -1; }).length;
    return '<div class="client-desk-grid"><article class="client-desk-card"><span class="client-desk-label">Open projects</span><p class="client-desk-money">' + projectCache.filter(function (project) { return project.status !== 'complete'; }).length + '</p></article><article class="client-desk-card"><span class="client-desk-label">Awaiting an action</span><p class="client-desk-money">' + waiting + '</p></article></div>';
  }

  function renderPaymentSettings() {
    if (activeProfile.role !== 'owner') return '';
    var providers = relatedData.providers || [];
    return '<details class="client-desk-card"><summary><strong>Payment methods</strong></summary><p class="client-desk-footnote">Gateway secrets belong in Supabase Edge Function secrets. Enable a provider here only after its merchant account and server settings are configured.</p><form class="client-desk-message-form" data-action="payment-settings">' +
      providers.map(function (provider) {
        return '<label class="client-desk-checkline"><input type="checkbox" name="provider_' + escapeHtml(provider.provider) + '" ' + (provider.is_enabled ? 'checked' : '') + '><span><strong>' + escapeHtml(provider.label) + '</strong> / ' + (provider.is_enabled ? 'Available to customers' : 'Hidden from customers') + '</span></label>';
      }).join('') +
      '<div class="field"><label class="client-desk-label" for="eftInstructions">Manual EFT instructions (shown to customers)</label><textarea id="eftInstructions" name="eft_instructions" maxlength="1500">' + escapeHtml((providers.find(function (provider) { return provider.provider === 'eft'; }) || {}).public_instructions || '') + '</textarea></div><button class="btn ghost" type="submit">Save payment methods</button></form></details>';
  }

  function renderQuoteBuilder(project) {
    return '<details><summary>Prepare quote and payment schedule</summary><form class="client-desk-message-form" data-action="quote" data-project="' + escapeHtml(project.id) + '"><div class="field"><label class="client-desk-label">Scope</label><textarea name="scope" required maxlength="5000"></textarea></div><div class="field"><label class="client-desk-label">Deliverables</label><textarea name="deliverables" required maxlength="3000"></textarea></div><div class="field"><label class="client-desk-label">Exclusions and third-party costs</label><textarea name="exclusions" maxlength="3000"></textarea></div><div class="client-desk-field-grid"><div class="field"><label class="client-desk-label">Quote total (ZAR)</label><input name="total" type="number" min="0.01" step="0.01" required></div><div class="field"><label class="client-desk-label">Quote valid until</label><input name="valid_until" type="date" required></div></div><h4>Payment milestones</h4><div data-milestone-list><div class="client-desk-field-grid" data-milestone-row><div class="field"><label class="client-desk-label">Milestone name</label><input name="milestone_description" required maxlength="240" placeholder="e.g. Project deposit"></div><div class="field"><label class="client-desk-label">Amount (ZAR)</label><input name="milestone_amount" type="number" min="0.01" step="0.01" required></div><div class="field"><label class="client-desk-label">Payment due</label><input name="milestone_due" type="date" required></div><div class="field"><label class="client-desk-label">Email invoice on</label><input name="milestone_send" type="datetime-local" required></div><button class="btn ghost" type="button" data-action="remove-milestone" aria-label="Remove payment milestone">Remove</button></div></div><button class="btn ghost" type="button" data-action="add-milestone">Add milestone</button><label class="client-desk-checkline"><input name="confirm" type="checkbox" required><span>I checked that the scope, total, dates, and milestone amounts are clear and add up to the quoted total.</span></label><button class="btn" type="submit">Send quote for customer approval</button></form></details>';
  }

  async function loadWorkspace() {
    var profileResult = await client.from('client_profiles').select('id,display_name,role').eq('id', activeProfile.id).single();
    if (profileResult.error) throw profileResult.error;
    activeProfile = Object.assign({}, profileResult.data, { email: activeProfile.email });
    var projectResult = await client.from('projects').select('*').order('updated_at', { ascending: false });
    if (projectResult.error) throw projectResult.error;
    projectCache = projectResult.data || [];
    var ids = projectCache.map(function (project) { return project.id; });
    relatedData = { checklist: [], messages: [], invoices: [], quotes: [], events: [], files: [], profiles: [], providers: [] };
    if (ids.length) {
      var queries = await Promise.all([
        client.from('project_checklist').select('*').in('project_id', ids).order('position'),
        client.from('project_messages').select('*').in('project_id', ids).order('created_at'),
        client.from('invoices').select('*').in('project_id', ids).order('created_at'),
        client.from('quotes').select('*').in('project_id', ids).order('version', { ascending: false }),
        client.from('project_events').select('*').in('project_id', ids).order('created_at'),
        client.from('project_files').select('*').in('project_id', ids).order('created_at')
      ]);
      var names = ['checklist', 'messages', 'invoices', 'quotes', 'events', 'files'];
      queries.forEach(function (result, index) {
        if (result.error) throw result.error;
        relatedData[names[index]] = result.data || [];
      });
      await Promise.all(relatedData.files.map(async function (file) {
        var signed = await client.storage.from('client-project-files').createSignedUrl(file.storage_path, 300);
        file.signed_url = signed.error ? '' : signed.data.signedUrl;
      }));
    }
    var profiles = await client.from('client_profiles').select('id,email,display_name');
    if (!profiles.error) relatedData.profiles = profiles.data || [];
    var providersQuery = client.from('payment_providers').select('provider,label,is_enabled,public_instructions');
    if (activeProfile.role !== 'owner') providersQuery = providersQuery.eq('is_enabled', true);
    var providers = await providersQuery;
    if (!providers.error) relatedData.providers = providers.data || [];
    renderDashboard();
  }

  function renderDashboard() {
    var owner = activeProfile.role === 'owner';
    var content = '<div class="client-desk-workspace"><div class="client-desk-main"><div class="client-desk-section-head"><div><h2>' + (owner ? 'Work queue' : 'Your projects') + '</h2><p class="client-desk-footnote">' + escapeHtml(activeProfile.email) + '</p></div><div class="client-desk-owner-tools"><button class="btn ghost" type="button" data-action="refresh" aria-label="Refresh projects"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M5.5 9A7 7 0 0 1 18 6l2 2M4 16l2 2a7 7 0 0 0 12.5-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' + (!owner ? '<button class="btn" type="button" data-action="new-request">New request</button>' : '') + '</div></div>' +
      (owner ? renderOwnerSummary() + renderPaymentSettings() : buildRequestForm()) + '<p class="client-desk-form-status" data-portal-status aria-live="polite"></p>' +
      (projectCache.length ? projectCache.map(renderProject).join('') : '<div class="client-desk-empty"><h3>' + (owner ? 'No requests yet' : 'Nothing in progress') + '</h3><p>' + (owner ? 'New customer requests will appear here.' : 'Send a request to start a conversation about your project.') + '</p></div>') +
      '</div><aside class="client-desk-sidebar"><h2>Payment clarity</h2><p>Every quote states the agreed scope, total, due conditions, and any third-party costs before work begins.</p><p>Invoices are sent on the date shown in your agreed schedule. A project status change never charges you by itself.</p><p class="client-desk-footnote">Payments are processed by the selected provider. FixerCtrl does not store card details.</p>' + (!owner ? '<h2>Indicative service guide</h2><ul><li>Landing page: R1,500–R3,000</li><li>Up to 5 website pages: R3,500–R7,500</li><li>Website updates: R250/hour</li><li>Setup: from R500</li><li>Features: from R800</li></ul><p class="client-desk-footnote">IT and security work is quoted after review. These are guides, not your quote. <a href="#/freelancer">Full pricing details</a></p>' : '') + '</aside></div>';
    renderShell(content, activeProfile);
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

  async function handleSubmit(event) {
    var form = event.target.closest('form[data-action]');
    if (!form) return;
    event.preventDefault();
    var action = form.dataset.action;
    var submit = form.querySelector('[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      if (action === 'signin') {
        var email = String(new FormData(form).get('email')).trim();
        var response = await client.auth.signInWithOtp({ email: email, options: { emailRedirectTo: window.location.origin + window.location.pathname + '#/client-desk' } });
        if (response.error) throw response.error;
        setStatus('Sign-in link sent. Check your inbox and spam folder.', false);
      } else if (action === 'request') await submitRequest(form);
      else if (action === 'message') await submitMessage(form);
      else if (action === 'upload') await submitFile(form);
      else if (action === 'checklist-add') await submitChecklistItem(form);
      else if (action === 'payment-settings') await submitPaymentSettings(form);
      else if (action === 'manual-paid') {
        if (activeProfile.role !== 'owner' || !new FormData(form).get('verified')) throw new Error('Confirm the bank receipt before recording payment.');
        var reconciliation = await client.rpc('owner_mark_invoice_paid', { p_invoice_id: form.dataset.invoice });
        if (reconciliation.error) throw reconciliation.error;
        await loadWorkspace();
        setStatus('Manual payment reconciled and recorded.', false);
      }
      else if (action === 'quote') await submitQuote(form);
    } catch (error) {
      setStatus(error.message || 'This request could not be completed.', true);
    } finally {
      if (submit && document.body.contains(submit)) submit.disabled = false;
    }
  }

  function handleChange(event) {
    var target = event.target.closest('[data-action="set-status"], [data-action="set-next"]');
    if (!target || activeProfile.role !== 'owner') return;
    var project = projectCache.find(function (item) { return item.id === target.dataset.project; });
    if (project) project[target.dataset.action === 'set-status' ? 'status' : 'next_action'] = target.value;
  }

  async function onSession(session) {
    if (!session) {
      activeProfile = null;
      renderSignIn();
      return;
    }
    activeProfile = { id: session.user.id, email: session.user.email };
    try {
      await loadWorkspace();
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
  document.addEventListener('submit', handleSubmit);
  document.addEventListener('change', handleChange);
})();
