
/**
 * Genz EduTech Innovation Bible backend
 * Standalone Google Apps Script
 * 1) Paste your Google Sheet ID below
 * 2) Run setupSystem()
 * 3) Deploy as Web App: Execute as Me, Access Anyone
 * 4) Paste the final /exec URL into index.html
 */
const GOOGLE_SHEET_ID = 'PASTE_YOUR_GOOGLE_SHEET_ID_HERE';

const APP_NAME = 'Genz EduTech Innovation Bible';

const BOOTSTRAP_PRINCIPAL = {
  name: 'PASTE_PRINCIPAL_NAME_HERE',
  email: 'PASTE_PRINCIPAL_EMAIL_HERE',
  password: 'PASTE_PRINCIPAL_PASSWORD_HERE',
  recoveryPin: 'PASTE_PRINCIPAL_RECOVERY_PIN_HERE'
};

const SHEETS = {
  USERS: 'USERS',
  ADMINS: 'ADMINS',
  TOKENS: 'TOKENS',
  SETTINGS: 'SETTINGS',
  ACTIVITY: 'ACTIVITY',
  TRANSACTIONS: 'TRANSACTIONS'
};

const HEADERS = {
  USERS: ['user_id','name','email','password_hash','recovery_pin_hash','status','payment_ref','approved_by','approved_at','created_at','updated_at','android_device_id','pc_device_id','last_device_type','last_login_at','is_deleted'],
  ADMINS: ['admin_id','name','email','password_hash','recovery_pin_hash','role','status','created_by','created_at','updated_at','is_deleted'],
  TOKENS: ['token','type','email','role','expires_at','status','created_at'],
  SETTINGS: ['key','value'],
  ACTIVITY: ['activity_id','actor_type','name','email','action','status','device_type','device_id','payment_ref','details','created_at'],
  TRANSACTIONS: ['tx_id','name','email','payment_ref','status','source','device_type','device_id','attempted_at','submitted_at','verified_at','verified_by','notes']
};

const DEFAULT_REMOTE_VERSIONS = {
  ASV: { title: 'American Standard Version (1901)', url: 'https://raw.githubusercontent.com/scrollmapper/bible_databases/master/formats/json/ASV.json' },
  BBE: { title: 'Bible in Basic English', url: 'https://raw.githubusercontent.com/scrollmapper/bible_databases/master/formats/json/BBE.json' },
  Darby: { title: 'Darby Bible (1889)', url: 'https://raw.githubusercontent.com/scrollmapper/bible_databases/master/formats/json/Darby.json' },
  Webster: { title: 'Webster Bible', url: 'https://raw.githubusercontent.com/scrollmapper/bible_databases/master/formats/json/Webster.json' },
  YLT: { title: "Young's Literal Translation", url: 'https://raw.githubusercontent.com/scrollmapper/bible_databases/master/formats/json/YLT.json' },
  AKJV: { title: 'American King James Version', url: 'https://raw.githubusercontent.com/scrollmapper/bible_databases/master/formats/json/AKJV.json' }
};

function doGet(e) {
  return handleRequest_(e, 'GET');
}

function doPost(e) {
  return handleRequest_(e, 'POST');
}

function handleRequest_(e, method) {
  try {
    setupSystem();
    const raw = (e && e.parameter) ? e.parameter : {};
    let params = {};
    if (method === 'POST') {
      if (raw.payload) {
        params = tryParseJson_(String(raw.payload || '{}')) || {};
        params.action = raw.action || params.action || '';
      } else {
        params = raw;
      }
    } else {
      params = raw;
    }

    const result = executeAction_(params);
    SpreadsheetApp.flush();
    return outputJson_(result);
  } catch (error) {
    return outputJson_({ ok:false, message:error && error.message ? error.message : 'Unexpected server error.' });
  }
}

function outputJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function executeAction_(payload) {
  const action = clean_(payload.action);
  if (!action) throw new Error('Missing action.');

  const routes = {
    ping: () => ({ok:true, message:'Backend is live.', app: APP_NAME}),
    bootstrap_status: () => bootstrapStatus_(),
    bootstrap_principal_admin: () => bootstrapPrincipalAdmin_(payload),

    get_public_settings: () => getPublicSettings_(),
    getPublicBootstrap: () => getPublicBootstrap_(),
    track_payment_click: () => trackPaymentClick_(payload),
    load_bible_version: () => loadBibleVersion_(payload),

    register_user: () => registerUser_(payload),
    user_login: () => userLogin_(payload),
    user_forgot_password: () => userForgotPassword_(payload),

    admin_login: () => adminLogin_(payload),
    admin_forgot_password: () => adminForgotPassword_(payload),
    admin_overview: () => adminOverview_(payload),

    admin_create_subadmin: () => adminCreateSubadmin_(payload),
    admin_set_subadmin_status: () => adminSetSubadminStatus_(payload),
    admin_delete_subadmin: () => adminDeleteSubadmin_(payload),
    admin_reset_subadmin_password: () => adminResetSubadminPassword_(payload),

    admin_set_user_status: () => adminSetUserStatus_(payload),
    admin_reset_user_password: () => adminResetUserPassword_(payload),
    admin_reset_user_devices: () => adminResetUserDevices_(payload),
    admin_delete_user: () => adminDeleteUser_(payload),

    admin_update_display: () => adminUpdateDisplay_(payload),
    admin_update_version_sources: () => adminUpdateVersionSources_(payload),

    admin_logout: () => logoutToken_(payload)
  };

  if (!routes[action]) throw new Error('Unknown action: ' + action);
  return routes[action]();
}



function tryParseJson_(txt) {
  if (!txt) return {};
  try { return JSON.parse(txt); } catch (err) {}
  try {
    const decoded = Utilities.newBlob(Utilities.base64Decode(clean_(txt))).getDataAsString('UTF-8');
    return JSON.parse(decoded);
  } catch (err2) {}
  return {};
}









function setupSystem() {
  const ss = getDb_();
  getOrCreateSheet_(ss, SHEETS.USERS, HEADERS.USERS);
  getOrCreateSheet_(ss, SHEETS.ADMINS, HEADERS.ADMINS);
  getOrCreateSheet_(ss, SHEETS.TOKENS, HEADERS.TOKENS);
  getOrCreateSheet_(ss, SHEETS.ACTIVITY, HEADERS.ACTIVITY);
  getOrCreateSheet_(ss, SHEETS.TRANSACTIONS, HEADERS.TRANSACTIONS);
  const settings = getOrCreateSheet_(ss, SHEETS.SETTINGS, HEADERS.SETTINGS);

  const defaults = {
    app_name: APP_NAME,
    db_created_at: nowIso_(),
    version: '9',
    brand_name: 'Genz EduTech Innovation',
    dashboard_image_url: '',
    dashboard_image_desc: '',
    remote_versions_json: JSON.stringify(DEFAULT_REMOTE_VERSIONS),
    admin_route_hint: '#admin'
  };
  Object.keys(defaults).forEach(key => ensureSetting_(settings, key, defaults[key]));
  return {ok:true, dbId:ss.getId(), url:ss.getUrl(), name:ss.getName()};
}





function createPrincipalAdmin(name, email, password, recoveryPin) {
  setupSystem();
  const args = resolvePrincipalArgs_(name, email, password, recoveryPin);
  name = clean_(args.name);
  email = normalizeEmail_(args.email);
  password = String(args.password || '');
  recoveryPin = String(args.recoveryPin || '');
  if (!name || !email || !password || !recoveryPin) {
    throw new Error('Edit BOOTSTRAP_PRINCIPAL first, or call createPrincipalAdmin(name, email, password, recoveryPin).');
  }
  const sheet = getSheet_(SHEETS.ADMINS);
  const rows = getObjects_(sheet);
  const activePrincipal = rows.find(r => String(r.role) === 'principal' && String(r.is_deleted) !== 'true');
  if (activePrincipal) throw new Error('A principal admin already exists.');
  appendRow_(sheet, {
    admin_id: uid_('ADM'),
    name: name,
    email: email,
    password_hash: sha_(password),
    recovery_pin_hash: sha_(recoveryPin),
    role: 'principal',
    status: 'active',
    created_by: 'system',
    created_at: nowIso_(),
    updated_at: nowIso_(),
    is_deleted: 'false'
  }, HEADERS.ADMINS);
  logActivity_('admin', name, email, 'bootstrap_principal_admin', 'success', '', '', '', 'Principal admin created.');
  return {ok:true, message:'Principal admin created.', email:email};
}
function resolvePrincipalArgs_(name, email, password, recoveryPin) {
  if (typeof name === 'object' && name) {
    return { name:name.name || '', email:name.email || '', password:name.password || '', recoveryPin:name.recoveryPin || name.recovery_pin || '' };
  }
  if (!name && !email && !password && !recoveryPin) return BOOTSTRAP_PRINCIPAL;
  return { name:name, email:email, password:password, recoveryPin:recoveryPin };
}
function bootstrapStatus_() {
  const admins = getObjects_(getSheet_(SHEETS.ADMINS)).filter(r => String(r.is_deleted) !== 'true');
  const principal = admins.find(r => String(r.role) === 'principal');
  return { ok:true, hasPrincipal:Boolean(principal), principalEmail: principal ? principal.email : '' };
}
function bootstrapPrincipalAdmin_(p) {
  const status = bootstrapStatus_();
  if (status.hasPrincipal) throw new Error('A principal admin already exists. Please sign in instead.');
  return createPrincipalAdmin({ name:p.name, email:p.email, password:p.password, recoveryPin:p.recoveryPin });
}

function getPublicSettings_() {
  const settings = getSettingsMap_();
  return {
    ok:true,
    branding: {
      imageUrl: settings.dashboard_image_url || '',
      imageDesc: settings.dashboard_image_desc || ''
    },
    versionSources: parseJsonSafe_(settings.remote_versions_json, DEFAULT_REMOTE_VERSIONS)
  };
}

function getPublicBootstrap_() {
  const data = getPublicSettings_();
  const settings = getSettingsMap_();
  data.data = {
    settings: settings,
    branding: data.branding,
    versionSources: data.versionSources
  };
  return data;
}

function trackPaymentClick_(p) {
  const name = clean_(p.name);
  const email = normalizeEmail_(p.email);
  const deviceType = clean_(p.deviceType).toLowerCase();
  const deviceId = clean_(p.deviceId);
  logActivity_('anon', name, email, 'payment_click', 'attempted', deviceType, deviceId, '', 'Selar payment page opened.');
  appendRow_(getSheet_(SHEETS.TRANSACTIONS), {
    tx_id: uid_('TX'),
    name: name,
    email: email,
    payment_ref: '',
    status: 'attempted',
    source: 'Selar click',
    device_type: deviceType,
    device_id: deviceId,
    attempted_at: nowIso_(),
    submitted_at: '',
    verified_at: '',
    verified_by: '',
    notes: 'User clicked payment button.'
  }, HEADERS.TRANSACTIONS);
  return {ok:true, message:'Payment attempt tracked.'};
}

function loadBibleVersion_(p) {
  const version = clean_(p.version);
  if (!version || version === 'KJV') throw new Error('KJV is bundled in the frontend package.');
  const settings = getSettingsMap_();
  const map = parseJsonSafe_(settings.remote_versions_json, DEFAULT_REMOTE_VERSIONS);
  const meta = map[version];
  if (!meta || !meta.url) throw new Error('No URL configured for version ' + version + '. Update the version sources JSON in admin settings or the SETTINGS sheet.');
  const res = UrlFetchApp.fetch(meta.url, { muteHttpExceptions:true, followRedirects:true });
  if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) {
    throw new Error('Could not load ' + version + ' from its configured source. Open the admin portal and update the version source URL if needed.');
  }
  const text = res.getContentText();
  let parsed;
  try { parsed = JSON.parse(text); } catch (err) { throw new Error('The configured source for ' + version + ' did not return valid JSON.'); }
  return { ok:true, version:version, title:meta.title || version, bible:parsed };
}

function registerUser_(p) {
  const name = clean_(p.name);
  const email = normalizeEmail_(p.email);
  const password = String(p.password || '');
  const recoveryPin = String(p.recoveryPin || '');
  const paymentRef = clean_(p.paymentRef);
  const deviceType = clean_(p.deviceType).toLowerCase();
  const deviceId = clean_(p.deviceId);
  if (!name || !email || !password || !recoveryPin || !paymentRef) throw new Error('Complete all registration fields.');
  const sheet = getSheet_(SHEETS.USERS);
  const found = findRowByEmail_(sheet, email);
  if (found && String(found.obj.is_deleted) !== 'true') throw new Error('This email already exists.');
  appendRow_(sheet, {
    user_id: uid_('USR'),
    name: name,
    email: email,
    password_hash: sha_(password),
    recovery_pin_hash: sha_(recoveryPin),
    status: 'pending',
    payment_ref: paymentRef,
    approved_by: '',
    approved_at: '',
    created_at: nowIso_(),
    updated_at: nowIso_(),
    android_device_id: '',
    pc_device_id: '',
    last_device_type: '',
    last_login_at: '',
    is_deleted: 'false'
  }, HEADERS.USERS);
  appendRow_(getSheet_(SHEETS.TRANSACTIONS), {
    tx_id: uid_('TX'),
    name: name,
    email: email,
    payment_ref: paymentRef,
    status: 'submitted',
    source: 'Registration',
    device_type: deviceType,
    device_id: deviceId,
    attempted_at: '',
    submitted_at: nowIso_(),
    verified_at: '',
    verified_by: '',
    notes: 'User submitted registration after payment.'
  }, HEADERS.TRANSACTIONS);
  logActivity_('user', name, email, 'register_user', 'submitted', deviceType, deviceId, paymentRef, 'Registration submitted for admin approval.');
  return {ok:true, message:'Registration submitted. An admin will verify payment and approve access.'};
}

function userLogin_(p) {
  const email = normalizeEmail_(p.email);
  const password = String(p.password || '');
  const deviceId = clean_(p.deviceId);
  let deviceType = clean_(p.deviceType).toLowerCase();
  if (!email || !password || !deviceId) throw new Error('Email, password and device details are required.');
  if (deviceType !== 'android') deviceType = 'pc';
  const sheet = getSheet_(SHEETS.USERS);
  const found = mustFindByEmail_(sheet, email, 'User not found.');
  const user = found.obj;
  const headers = getHeaders_(sheet);

  if (String(user.is_deleted) === 'true') {
    logActivity_('user', user.name, email, 'user_login', 'failed', deviceType, deviceId, user.payment_ref, 'Deleted account attempted login.');
    throw new Error('This account has been deleted.');
  }
  if (String(user.status) === 'pending') {
    logActivity_('user', user.name, email, 'user_login', 'failed', deviceType, deviceId, user.payment_ref, 'Pending account attempted login.');
    throw new Error('Your account is still pending admin approval.');
  }
  if (String(user.status) === 'rejected') {
    logActivity_('user', user.name, email, 'user_login', 'failed', deviceType, deviceId, user.payment_ref, 'Rejected account attempted login.');
    throw new Error('Your account request was rejected.');
  }
  if (String(user.status) !== 'approved') {
    logActivity_('user', user.name, email, 'user_login', 'failed', deviceType, deviceId, user.payment_ref, 'Inactive account attempted login.');
    throw new Error('This account is inactive.');
  }
  if (String(user.password_hash) !== sha_(password)) {
    logActivity_('user', user.name, email, 'user_login', 'failed', deviceType, deviceId, user.payment_ref, 'Password mismatch.');
    throw new Error('Invalid login details.');
  }

  if (deviceType === 'android') {
    const current = String(user.android_device_id || '');
    if (!current) setCellByHeader_(sheet, found.rowIndex, headers, 'android_device_id', deviceId);
    else if (current !== deviceId) throw new Error('Your Android slot is already in use on another device. Ask admin to reset it.');
  } else {
    const current = String(user.pc_device_id || '');
    if (!current) setCellByHeader_(sheet, found.rowIndex, headers, 'pc_device_id', deviceId);
    else if (current !== deviceId) throw new Error('Your PC slot is already in use on another computer. Ask admin to reset it.');
  }
  setCellByHeader_(sheet, found.rowIndex, headers, 'last_device_type', deviceType);
  setCellByHeader_(sheet, found.rowIndex, headers, 'last_login_at', nowIso_());
  setCellByHeader_(sheet, found.rowIndex, headers, 'updated_at', nowIso_());

  logActivity_('user', user.name, email, 'user_login', 'success', deviceType, deviceId, user.payment_ref, 'User logged in successfully.');
  return {
    ok:true,
    message:'Login successful.',
    user:{
      name:user.name,
      email:user.email,
      status:user.status,
      androidBound:Boolean(String(getValueByHeader_(sheet, found.rowIndex, headers, 'android_device_id') || '')),
      pcBound:Boolean(String(getValueByHeader_(sheet, found.rowIndex, headers, 'pc_device_id') || ''))
    }
  };
}

function userForgotPassword_(p) {
  const email = normalizeEmail_(p.email);
  const recoveryPin = String(p.recoveryPin || '');
  const newPassword = String(p.newPassword || '');
  if (!email || !recoveryPin || !newPassword) throw new Error('Email, recovery PIN and new password are required.');
  const sheet = getSheet_(SHEETS.USERS);
  const found = mustFindByEmail_(sheet, email, 'User not found.');
  if (String(found.obj.recovery_pin_hash) !== sha_(recoveryPin)) {
    logActivity_('user', found.obj.name, email, 'user_forgot_password', 'failed', '', '', found.obj.payment_ref, 'Recovery PIN mismatch.');
    throw new Error('Incorrect recovery PIN.');
  }
  const headers = getHeaders_(sheet);
  setCellByHeader_(sheet, found.rowIndex, headers, 'password_hash', sha_(newPassword));
  setCellByHeader_(sheet, found.rowIndex, headers, 'updated_at', nowIso_());
  logActivity_('user', found.obj.name, email, 'user_forgot_password', 'success', '', '', found.obj.payment_ref, 'User password reset.');
  return {ok:true, message:'Password reset successful.'};
}

function adminLogin_(p) {
  const email = normalizeEmail_(p.email);
  const password = String(p.password || '');
  if (!email || !password) throw new Error('Email and password are required.');
  const sheet = getSheet_(SHEETS.ADMINS);
  const found = mustFindByEmail_(sheet, email, 'Admin not found.');
  const admin = found.obj;
  if (String(admin.is_deleted) === 'true') throw new Error('Admin account deleted.');
  if (String(admin.status) !== 'active') throw new Error('Admin account is inactive.');
  if (String(admin.password_hash) !== sha_(password)) {
    logActivity_('admin', admin.name, email, 'admin_login', 'failed', '', '', '', 'Password mismatch.');
    throw new Error('Invalid admin login.');
  }
  const token = issueToken_('admin', email, admin.role);
  logActivity_('admin', admin.name, email, 'admin_login', 'success', '', '', '', 'Admin logged in.');
  return { ok:true, message:'Admin login successful.', token:token, admin:{name:admin.name, email:admin.email, role:admin.role} };
}

function adminForgotPassword_(p) {
  const email = normalizeEmail_(p.email);
  const recoveryPin = String(p.recoveryPin || '');
  const newPassword = String(p.newPassword || '');
  if (!email || !recoveryPin || !newPassword) throw new Error('Email, recovery PIN and new password are required.');
  const sheet = getSheet_(SHEETS.ADMINS);
  const found = mustFindByEmail_(sheet, email, 'Admin not found.');
  if (String(found.obj.recovery_pin_hash) !== sha_(recoveryPin)) {
    logActivity_('admin', found.obj.name, email, 'admin_forgot_password', 'failed', '', '', '', 'Recovery PIN mismatch.');
    throw new Error('Incorrect recovery PIN.');
  }
  const headers = getHeaders_(sheet);
  setCellByHeader_(sheet, found.rowIndex, headers, 'password_hash', sha_(newPassword));
  setCellByHeader_(sheet, found.rowIndex, headers, 'updated_at', nowIso_());
  logActivity_('admin', found.obj.name, email, 'admin_forgot_password', 'success', '', '', '', 'Admin password reset.');
  return {ok:true, message:'Admin password reset successful.'};
}

function adminOverview_(p) {
  const auth = requireAdmin_(p.token);
  const users = getObjects_(getSheet_(SHEETS.USERS)).filter(r => String(r.is_deleted) !== 'true')
    .sort((a,b) => String(b.created_at).localeCompare(String(a.created_at)));
  const admins = getObjects_(getSheet_(SHEETS.ADMINS)).filter(r => String(r.is_deleted) !== 'true')
    .sort((a,b) => String(b.created_at).localeCompare(String(a.created_at)));
  const activities = getObjects_(getSheet_(SHEETS.ACTIVITY))
    .sort((a,b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 200);
  const transactions = getObjects_(getSheet_(SHEETS.TRANSACTIONS))
    .sort((a,b) => String((b.verified_at || b.submitted_at || b.attempted_at)).localeCompare(String((a.verified_at || a.submitted_at || a.attempted_at))))
    .slice(0, 200);
  const settings = getSettingsMap_();

  const counts = {
    users_total: users.length,
    users_pending: users.filter(u => u.status === 'pending').length,
    users_approved: users.filter(u => u.status === 'approved').length,
    buy_attempts: transactions.filter(t => t.status === 'attempted').length,
    payment_submitted: transactions.filter(t => t.status === 'submitted').length,
    purchase_verified: transactions.filter(t => t.status === 'approved').length,
    subadmins: admins.filter(a => a.role === 'subadmin').length,
    activities: activities.length
  };

  return {
    ok:true,
    me: auth.admin,
    counts: counts,
    users: users,
    admins: admins,
    activities: activities,
    transactions: transactions,
    settings: {
      branding: {
        imageUrl: settings.dashboard_image_url || '',
        imageDesc: settings.dashboard_image_desc || ''
      },
      versionSources: parseJsonSafe_(settings.remote_versions_json, DEFAULT_REMOTE_VERSIONS)
    }
  };
}

function adminCreateSubadmin_(p) {
  const auth = requireAdmin_(p.token, 'principal');
  const name = clean_(p.name);
  const email = normalizeEmail_(p.email);
  const password = String(p.password || '');
  const recoveryPin = String(p.recoveryPin || '');
  if (!name || !email || !password || !recoveryPin) throw new Error('Complete the subadmin form.');
  const sheet = getSheet_(SHEETS.ADMINS);
  const found = findRowByEmail_(sheet, email);
  if (found && String(found.obj.is_deleted) !== 'true') throw new Error('That subadmin email already exists.');
  appendRow_(sheet, {
    admin_id: uid_('ADM'),
    name:name,
    email:email,
    password_hash:sha_(password),
    recovery_pin_hash:sha_(recoveryPin),
    role:'subadmin',
    status:'active',
    created_by:auth.admin.email,
    created_at:nowIso_(),
    updated_at:nowIso_(),
    is_deleted:'false'
  }, HEADERS.ADMINS);
  logActivity_('admin', auth.admin.name, auth.admin.email, 'admin_create_subadmin', 'success', '', '', '', 'Subadmin created: ' + email);
  return {ok:true, message:'Subadmin created.'};
}

function adminSetSubadminStatus_(p) {
  const auth = requireAdmin_(p.token, 'principal');
  const email = normalizeEmail_(p.email);
  const status = clean_(p.status).toLowerCase();
  if (!['active','inactive'].includes(status)) throw new Error('Invalid status.');
  const sheet = getSheet_(SHEETS.ADMINS);
  const found = mustFindByEmail_(sheet, email, 'Subadmin not found.');
  if (String(found.obj.role) !== 'subadmin') throw new Error('Only subadmins can be managed here.');
  const headers = getHeaders_(sheet);
  setCellByHeader_(sheet, found.rowIndex, headers, 'status', status);
  setCellByHeader_(sheet, found.rowIndex, headers, 'updated_at', nowIso_());
  logActivity_('admin', auth.admin.name, auth.admin.email, 'admin_set_subadmin_status', 'success', '', '', '', email + ' => ' + status);
  return {ok:true, message:'Subadmin updated.'};
}

function adminDeleteSubadmin_(p) {
  const auth = requireAdmin_(p.token, 'principal');
  const email = normalizeEmail_(p.email);
  const permanent = String(p.permanent) === 'true' || p.permanent === true;
  const sheet = getSheet_(SHEETS.ADMINS);
  const found = mustFindByEmail_(sheet, email, 'Subadmin not found.');
  if (String(found.obj.role) !== 'subadmin') throw new Error('Only subadmins can be deleted here.');
  if (permanent) {
    sheet.deleteRow(found.rowIndex);
    logActivity_('admin', auth.admin.name, auth.admin.email, 'admin_delete_subadmin', 'success', '', '', '', 'Deleted forever: ' + email);
    return {ok:true, message:'Subadmin deleted forever.'};
  }
  const headers = getHeaders_(sheet);
  setCellByHeader_(sheet, found.rowIndex, headers, 'status', 'deleted');
  setCellByHeader_(sheet, found.rowIndex, headers, 'is_deleted', 'true');
  setCellByHeader_(sheet, found.rowIndex, headers, 'updated_at', nowIso_());
  logActivity_('admin', auth.admin.name, auth.admin.email, 'admin_delete_subadmin', 'success', '', '', '', 'Soft deleted: ' + email);
  return {ok:true, message:'Subadmin deleted.'};
}

function adminResetSubadminPassword_(p) {
  const auth = requireAdmin_(p.token, 'principal');
  const email = normalizeEmail_(p.email);
  const newPassword = String(p.newPassword || '');
  if (!email || !newPassword) throw new Error('Email and new password are required.');
  const sheet = getSheet_(SHEETS.ADMINS);
  const found = mustFindByEmail_(sheet, email, 'Subadmin not found.');
  if (String(found.obj.role) !== 'subadmin') throw new Error('Only subadmins can be reset here.');
  const headers = getHeaders_(sheet);
  setCellByHeader_(sheet, found.rowIndex, headers, 'password_hash', sha_(newPassword));
  setCellByHeader_(sheet, found.rowIndex, headers, 'updated_at', nowIso_());
  logActivity_('admin', auth.admin.name, auth.admin.email, 'admin_reset_subadmin_password', 'success', '', '', '', 'Reset subadmin password: ' + email);
  return {ok:true, message:'Subadmin password reset.'};
}

function adminSetUserStatus_(p) {
  const auth = requireAdmin_(p.token);
  const email = normalizeEmail_(p.email);
  const status = clean_(p.status).toLowerCase();
  if (!['approved','inactive','rejected','pending'].includes(status)) throw new Error('Invalid user status.');
  const sheet = getSheet_(SHEETS.USERS);
  const found = mustFindByEmail_(sheet, email, 'User not found.');
  const headers = getHeaders_(sheet);
  setCellByHeader_(sheet, found.rowIndex, headers, 'status', status);
  setCellByHeader_(sheet, found.rowIndex, headers, 'updated_at', nowIso_());
  if (status === 'approved') {
    setCellByHeader_(sheet, found.rowIndex, headers, 'approved_by', auth.admin.email);
    setCellByHeader_(sheet, found.rowIndex, headers, 'approved_at', nowIso_());
  }
  updateLatestTransactionStatus_(email, status, auth.admin.email, found.obj.payment_ref);
  logActivity_('admin', auth.admin.name, auth.admin.email, 'admin_set_user_status', 'success', '', '', found.obj.payment_ref, email + ' => ' + status);
  return {ok:true, message:'User updated.'};
}

function adminResetUserPassword_(p) {
  const auth = requireAdmin_(p.token);
  const email = normalizeEmail_(p.email);
  const newPassword = String(p.newPassword || '');
  if (!email || !newPassword) throw new Error('Email and new password are required.');
  const sheet = getSheet_(SHEETS.USERS);
  const found = mustFindByEmail_(sheet, email, 'User not found.');
  const headers = getHeaders_(sheet);
  setCellByHeader_(sheet, found.rowIndex, headers, 'password_hash', sha_(newPassword));
  setCellByHeader_(sheet, found.rowIndex, headers, 'updated_at', nowIso_());
  logActivity_('admin', auth.admin.name, auth.admin.email, 'admin_reset_user_password', 'success', '', '', found.obj.payment_ref, 'Reset password: ' + email);
  return {ok:true, message:'User password reset.'};
}

function adminResetUserDevices_(p) {
  const auth = requireAdmin_(p.token);
  const email = normalizeEmail_(p.email);
  if (!email) throw new Error('Email is required.');
  const sheet = getSheet_(SHEETS.USERS);
  const found = mustFindByEmail_(sheet, email, 'User not found.');
  const headers = getHeaders_(sheet);
  setCellByHeader_(sheet, found.rowIndex, headers, 'android_device_id', '');
  setCellByHeader_(sheet, found.rowIndex, headers, 'pc_device_id', '');
  setCellByHeader_(sheet, found.rowIndex, headers, 'updated_at', nowIso_());
  logActivity_('admin', auth.admin.name, auth.admin.email, 'admin_reset_user_devices', 'success', '', '', found.obj.payment_ref, 'Reset devices: ' + email);
  return {ok:true, message:'User device slots reset.'};
}

function adminDeleteUser_(p) {
  const auth = requireAdmin_(p.token);
  const email = normalizeEmail_(p.email);
  const permanent = String(p.permanent) === 'true' || p.permanent === true;
  const sheet = getSheet_(SHEETS.USERS);
  const found = mustFindByEmail_(sheet, email, 'User not found.');
  if (permanent) {
    sheet.deleteRow(found.rowIndex);
    logActivity_('admin', auth.admin.name, auth.admin.email, 'admin_delete_user', 'success', '', '', found.obj.payment_ref, 'Deleted forever: ' + email);
    return {ok:true, message:'User deleted forever.'};
  }
  const headers = getHeaders_(sheet);
  setCellByHeader_(sheet, found.rowIndex, headers, 'status', 'deleted');
  setCellByHeader_(sheet, found.rowIndex, headers, 'is_deleted', 'true');
  setCellByHeader_(sheet, found.rowIndex, headers, 'updated_at', nowIso_());
  logActivity_('admin', auth.admin.name, auth.admin.email, 'admin_delete_user', 'success', '', '', found.obj.payment_ref, 'Soft deleted: ' + email);
  return {ok:true, message:'User deleted.'};
}

function adminUpdateDisplay_(p) {
  const auth = requireAdmin_(p.token);
  const imageUrl = clean_(p.imageUrl);
  const imageDesc = clean_(p.imageDesc);
  setSetting_('dashboard_image_url', imageUrl);
  setSetting_('dashboard_image_desc', imageDesc);
  logActivity_('admin', auth.admin.name, auth.admin.email, 'admin_update_display', 'success', '', '', '', 'Updated dashboard image settings.');
  return {
    ok:true,
    message:'Dashboard image settings saved.',
    branding:{ imageUrl:imageUrl, imageDesc:imageDesc }
  };
}

function adminUpdateVersionSources_(p) {
  const auth = requireAdmin_(p.token);
  const raw = String(p.versionSourcesJson || '');
  const parsed = parseJsonSafe_(raw, null);
  if (!parsed || typeof parsed !== 'object') throw new Error('Version sources JSON is invalid.');
  setSetting_('remote_versions_json', JSON.stringify(parsed));
  logActivity_('admin', auth.admin.name, auth.admin.email, 'admin_update_version_sources', 'success', '', '', '', 'Updated remote version source map.');
  return { ok:true, message:'Version source map saved.', versionSources: parsed };
}

function logoutToken_(p) {
  const token = String(p.token || '');
  if (!token) return {ok:true, message:'Logged out.'};
  const sheet = getSheet_(SHEETS.TOKENS);
  const headers = getHeaders_(sheet);
  const values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === token) {
      sheet.getRange(i + 1, headers.indexOf('status') + 1).setValue('revoked');
      break;
    }
  }
  return {ok:true, message:'Logged out.'};
}

function requireAdmin_(token, requiredRole) {
  const auth = authByToken_(String(token || ''));
  if (!auth.ok) throw new Error(auth.message);
  if (requiredRole && auth.admin.role !== requiredRole) throw new Error('Only the principal admin can do that.');
  return auth;
}
function authByToken_(token) {
  if (!token) return {ok:false, message:'Missing admin token.'};
  const tokens = getObjects_(getSheet_(SHEETS.TOKENS));
  const now = new Date();
  const row = tokens.find(r => r.token === token && r.type === 'admin' && r.status === 'active' && new Date(r.expires_at) > now);
  if (!row) return {ok:false, message:'Session expired. Please log in again.'};
  const admin = mustFindByEmail_(getSheet_(SHEETS.ADMINS), normalizeEmail_(row.email), 'Admin not found.').obj;
  if (String(admin.status) !== 'active' || String(admin.is_deleted) === 'true') return {ok:false, message:'Admin account inactive.'};
  return {ok:true, admin:{name:admin.name, email:admin.email, role:admin.role}};
}
function issueToken_(type, email, role) {
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  appendRow_(getSheet_(SHEETS.TOKENS), {
    token: token,
    type: type,
    email: email,
    role: role || '',
    expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString(),
    status: 'active',
    created_at: nowIso_()
  }, HEADERS.TOKENS);
  return token;
}

function updateLatestTransactionStatus_(email, status, adminEmail, paymentRef) {
  const sheet = getSheet_(SHEETS.TRANSACTIONS);
  const headers = getHeaders_(sheet);
  const values = sheet.getDataRange().getValues();
  for (var i = values.length - 1; i >= 2; i--) {
    const rowEmail = normalizeEmail_(values[i-1][headers.indexOf('email')]);
    const rowRef = clean_(values[i-1][headers.indexOf('payment_ref')]);
    if (rowEmail === email && (!paymentRef || rowRef === paymentRef || !rowRef)) {
      setCellByHeader_(sheet, i, headers, 'status', status);
      setCellByHeader_(sheet, i, headers, 'verified_at', nowIso_());
      setCellByHeader_(sheet, i, headers, 'verified_by', adminEmail || '');
      return;
    }
  }
}

function logActivity_(actorType, name, email, action, status, deviceType, deviceId, paymentRef, details) {
  appendRow_(getSheet_(SHEETS.ACTIVITY), {
    activity_id: uid_('ACT'),
    actor_type: actorType || '',
    name: name || '',
    email: normalizeEmail_(email),
    action: action || '',
    status: status || '',
    device_type: deviceType || '',
    device_id: deviceId || '',
    payment_ref: paymentRef || '',
    details: details || '',
    created_at: nowIso_()
  }, HEADERS.ACTIVITY);
}

function getDb_() {
  const id = clean_(GOOGLE_SHEET_ID);
  if (!id || id.indexOf('PASTE_') !== -1) {
    throw new Error('Paste your real Google Sheet ID into GOOGLE_SHEET_ID at the top of Code.gs.');
  }
  try {
    return SpreadsheetApp.openById(id);
  } catch (e) {
    throw new Error('Could not open the Google Sheet ID in GOOGLE_SHEET_ID. Check the sheet ID and make sure this Apps Script project has access to that spreadsheet.');
  }
}
function getSheet_(name) {
  const ss = getDb_();
  return getOrCreateSheet_(ss, name, HEADERS[name]);
}
function getOrCreateSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) sh.appendRow(headers);
  const currentHeaders = sh.getRange(1,1,1,headers.length).getValues()[0];
  if (String(currentHeaders.join('|')) !== String(headers.join('|'))) {
    sh.getRange(1,1,1,headers.length).setValues([headers]);
  }
  return sh;
}
function appendRow_(sheet, obj, headers) {
  const row = headers.map(h => obj[h] !== undefined ? obj[h] : '');
  sheet.appendRow(row);
}
function getHeaders_(sheet) { return sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0].map(String); }
function getObjects_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0].map(String);
  return values.slice(1).map(row => {
    const o = {};
    headers.forEach((h, i) => o[h] = row[i]);
    return o;
  });
}
function findRowByEmail_(sheet, email) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return null;
  const headers = values[0].map(String);
  const idx = headers.indexOf('email');
  for (var i = 1; i < values.length; i++) {
    if (normalizeEmail_(values[i][idx]) === email) {
      const obj = {};
      headers.forEach((h, col) => obj[h] = values[i][col]);
      return {rowIndex:i + 1, obj:obj};
    }
  }
  return null;
}
function mustFindByEmail_(sheet, email, message) {
  const found = findRowByEmail_(sheet, email);
  if (!found) throw new Error(message || 'Record not found.');
  return found;
}
function setCellByHeader_(sheet, rowIndex, headers, header, value) {
  const col = headers.indexOf(header);
  if (col === -1) throw new Error('Missing column: ' + header);
  sheet.getRange(rowIndex, col + 1).setValue(value);
}
function getValueByHeader_(sheet, rowIndex, headers, header) {
  const col = headers.indexOf(header);
  if (col === -1) return '';
  return sheet.getRange(rowIndex, col + 1).getValue();
}
function getSettingsMap_() {
  const rows = getObjects_(getSheet_(SHEETS.SETTINGS));
  const map = {};
  rows.forEach(r => map[String(r.key)] = r.value);
  return map;
}
function ensureSetting_(sheet, key, value) {
  const rows = getObjects_(sheet);
  const existing = rows.find(r => String(r.key) === String(key));
  if (!existing) appendRow_(sheet, {key:key, value:value}, HEADERS.SETTINGS);
}
function setSetting_(key, value) {
  const sheet = getSheet_(SHEETS.SETTINGS);
  const values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(key)) {
      sheet.getRange(i + 1, 2).setValue(value);
      return;
    }
  }
  appendRow_(sheet, {key:key, value:value}, HEADERS.SETTINGS);
}

function parseJsonSafe_(txt, fallback) {
  try { return JSON.parse(String(txt || '')); } catch (e) { return fallback; }
}
function clean_(v) { return String(v === undefined || v === null ? '' : v).trim(); }
function normalizeEmail_(v) { return clean_(v).toLowerCase(); }
function uid_(prefix) { return prefix + '_' + Utilities.getUuid().split('-')[0] + '_' + new Date().getTime(); }
function nowIso_() { return new Date().toISOString(); }
function sha_(text) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8);
  return digest.map(function(b) {
    const v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}
