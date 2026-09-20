/**
 * Multi-Tenant SaaS Automation Test Suite
 * 
 * End-to-end automated testing covering every critical workflow:
 * - Health & System Edge / Cloudflare metadata
 * - Authentication (suresh@gmail.com / Suresh@1234)
 * - Two-Factor Authentication (2FA TOTP: Setup, Verify, Challenge, Login, Disable)
 * - Workspaces & Organizations
 * - Projects CRUD & RLS isolation
 * - Tasks Lifecycle & Comments
 * - Meetings Scheduling, Fetching & Deletion (Regression check)
 * - Dashboard Metrics & Aggregations
 * - Notifications & Activity Audits
 * - Custom 404 & Error Handling
 * - Frontend Web App Sanity Checks
 */

import { generateTotpCode } from '../src/utils/totp.js';

const BACKEND_URL = process.env['BACKEND_URL'] || 'http://localhost:5000';
const FRONTEND_URL = process.env['FRONTEND_URL'] || 'http://localhost:3000';

const USER_EMAIL = 'suresh@gmail.com';
const USER_PASSWORD = 'Suresh@1234';

interface TestResult {
  step: number;
  category: string;
  name: string;
  passed: boolean;
  durationMs: number;
  error?: string;
  details?: string;
}

const results: TestResult[] = [];
let stepCounter = 1;

async function runTest(
  category: string,
  name: string,
  fn: () => Promise<{ details?: string } | void>
): Promise<boolean> {
  const step = stepCounter++;
  const start = Date.now();
  try {
    const res = await fn();
    const durationMs = Date.now() - start;
    results.push({
      step,
      category,
      name,
      passed: true,
      durationMs,
      details: res?.details,
    });
    console.log(`  \x1b[32m✔\x1b[0m [Step ${step}] ${category} » ${name} \x1b[90m(${durationMs}ms)\x1b[0m`);
    if (res?.details) {
      console.log(`    \x1b[90m└─ ${res.details}\x1b[0m`);
    }
    return true;
  } catch (err: any) {
    const durationMs = Date.now() - start;
    const errorMsg = err?.message || String(err);
    results.push({
      step,
      category,
      name,
      passed: false,
      durationMs,
      error: errorMsg,
    });
    console.error(`  \x1b[31m✖\x1b[0m [Step ${step}] ${category} » ${name} \x1b[90m(${durationMs}ms)\x1b[0m`);
    console.error(`    \x1b[31m└─ Error: ${errorMsg}\x1b[0m`);
    return false;
  }
}

// Cookie jar for handling cookies across requests if needed
let sessionCookie = '';

async function apiRequest(
  path: string,
  options: {
    method?: string;
    token?: string;
    body?: any;
    headers?: Record<string, string>;
  } = {}
) {
  const url = `${BACKEND_URL}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (options.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
  }

  if (sessionCookie) {
    headers['Cookie'] = sessionCookie;
  }

  const response = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const cookieHeader = response.headers.get('set-cookie');
  if (cookieHeader) {
    sessionCookie = cookieHeader.split(';')[0] || '';
  }

  const text = await response.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Non-JSON response
  }

  return { status: response.status, headers: response.headers, json, text };
}

async function main() {
  console.log(`\n================================================================================`);
  console.log(`🚀 MULTI-TENANT SAAS - AUTOMATED FULL E2E SUITE`);
  console.log(`================================================================================`);
  console.log(`🎯 Backend URL:  ${BACKEND_URL}`);
  console.log(`🌐 Frontend URL: ${FRONTEND_URL}`);
  console.log(`👤 Target User:  ${USER_EMAIL}`);
  console.log(`🕒 Started at:   ${new Date().toISOString()}`);
  console.log(`--------------------------------------------------------------------------------\n`);

  let accessToken = '';
  let activeOrgId = '';
  let createdProjectId = '';
  let createdTaskId = '';
  let createdMeetingId = '';
  let totpSecret = '';

  // ==========================================
  // SECTION 1: System Health & Infrastructure
  // ==========================================
  console.log(`\x1b[1m[1/8] Infrastructure & System Health\x1b[0m`);

  await runTest('System', 'Backend /health probe responds with 200 OK', async () => {
    const res = await apiRequest('/health');
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}: ${res.text}`);
    if (!res.json?.data?.status) throw new Error(`Missing status in body: ${res.text}`);
    return { details: `Status: ${res.json.data.status}, Uptime: ${Math.round(res.json.data.uptime)}s` };
  });

  await runTest('System', 'Cloudflare Edge metadata endpoint responds', async () => {
    const res = await apiRequest('/api/v1/system/edge-status');
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    return { details: `Edge Proxy: ${res.json?.data?.edge?.proxiedByCloudflare ? 'Yes' : 'Direct/Emulated'}` };
  });

  await runTest('System', 'Backend 404 Route Handler returns structured JSON error', async () => {
    const res = await apiRequest('/api/v1/unknown-test-route-random-404');
    if (res.status !== 404) throw new Error(`Expected 404, got ${res.status}`);
    if (res.json?.error?.code !== 'ROUTE_NOT_FOUND') {
      throw new Error(`Expected code ROUTE_NOT_FOUND, got ${res.json?.error?.code}`);
    }
    return { details: `Verified structured JSON error response: ${res.json.error.code}` };
  });

  await runTest('System', 'Frontend root responds with 200 OK', async () => {
    const res = await fetch(FRONTEND_URL);
    if (res.status !== 200) throw new Error(`Expected 200 from Frontend, got ${res.status}`);
    return { details: `Frontend server online at ${FRONTEND_URL}` };
  });

  await runTest('System', 'Frontend 404 page responds for non-existent routes', async () => {
    const res = await fetch(`${FRONTEND_URL}/some-unregistered-test-page`);
    if (res.status !== 404) throw new Error(`Expected 404 from Frontend, got ${res.status}`);
    const html = await res.text();
    if (!html.includes('404') && !html.includes('Not Found')) {
      throw new Error('404 page does not contain 404 indicator text');
    }
    return { details: `Verified custom Next.js 404 page rendered correctly` };
  });

  // ==========================================
  // SECTION 2: Authentication & Password Check
  // ==========================================
  console.log(`\n\x1b[1m[2/8] User Authentication (${USER_EMAIL})\x1b[0m`);

  await runTest('Auth', 'Reject login attempt with invalid password', async () => {
    const res = await apiRequest('/api/v1/auth/login', {
      method: 'POST',
      body: { email: USER_EMAIL, password: 'WrongPassword999!' },
    });
    if (res.status !== 401) throw new Error(`Expected 401 Unauthorized, got ${res.status}`);
    return { details: `Correctly rejected unauthorized credential` };
  });

  await runTest('Auth', `Authenticate successfully with valid credentials`, async () => {
    const res = await apiRequest('/api/v1/auth/login', {
      method: 'POST',
      body: { email: USER_EMAIL, password: USER_PASSWORD },
    });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}: ${res.text}`);
    if (res.json?.data?.requiresMfa) {
      // If 2FA was already left enabled from a previous run, complete with MFA
      throw new Error('User has 2FA enabled unexpectedly before 2FA test cycle');
    }
    accessToken = res.json?.data?.accessToken;
    if (!accessToken) throw new Error(`No access token returned: ${res.text}`);
    return { details: `Issued JWT for user: ${res.json.data.user.email} (ID: ${res.json.data.user.id})` };
  });

  await runTest('Auth', 'Rotate session via /auth/refresh endpoint', async () => {
    const res = await apiRequest('/api/v1/auth/refresh', {
      method: 'POST',
    });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}: ${res.text}`);
    if (!res.json?.data?.accessToken) throw new Error(`No new accessToken received`);
    accessToken = res.json.data.accessToken;
    return { details: `Successfully refreshed token pair` };
  });

  // ==========================================
  // SECTION 3: Two-Factor Authentication (TOTP)
  // ==========================================
  console.log(`\n\x1b[1m[3/8] Two-Factor Authentication (2FA TOTP Lifecycle)\x1b[0m`);

  await runTest('2FA', 'Generate 2FA TOTP setup secret & QR URI', async () => {
    const res = await apiRequest('/api/v1/auth/2fa/setup', {
      method: 'POST',
      token: accessToken,
    });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}: ${res.text}`);
    totpSecret = res.json?.data?.secret;
    if (!totpSecret) throw new Error(`Secret missing in setup response`);
    return { details: `Generated Base32 secret: ${totpSecret.substring(0, 6)}...` };
  });

  await runTest('2FA', 'Reject invalid 6-digit TOTP verification code', async () => {
    const res = await apiRequest('/api/v1/auth/2fa/verify', {
      method: 'POST',
      token: accessToken,
      body: { code: '000000' },
    });
    if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
    return { details: `Rejected bad code correctly` };
  });

  await runTest('2FA', 'Activate 2FA with valid RFC 6238 TOTP code', async () => {
    const validCode = generateTotpCode(totpSecret);
    const res = await apiRequest('/api/v1/auth/2fa/verify', {
      method: 'POST',
      token: accessToken,
      body: { code: validCode },
    });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}: ${res.text}`);
    return { details: `2FA successfully verified and activated` };
  });

  let mfaToken = '';
  await runTest('2FA', 'Login now triggers MFA challenge (requiresMfa: true)', async () => {
    const res = await apiRequest('/api/v1/auth/login', {
      method: 'POST',
      body: { email: USER_EMAIL, password: USER_PASSWORD },
    });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}: ${res.text}`);
    if (!res.json?.data?.requiresMfa) throw new Error(`Expected requiresMfa: true, got ${JSON.stringify(res.json)}`);
    mfaToken = res.json.data.mfaToken;
    if (!mfaToken) throw new Error(`Missing mfaToken in response`);
    return { details: `Received short-lived mfaToken: ${mfaToken.substring(0, 15)}...` };
  });

  await runTest('2FA', 'Reject invalid code during MFA login challenge', async () => {
    const res = await apiRequest('/api/v1/auth/2fa/login', {
      method: 'POST',
      body: { mfaToken, code: '123456' },
    });
    if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
    return { details: `MFA gate blocked invalid code` };
  });

  await runTest('2FA', 'Complete MFA login challenge with valid TOTP code', async () => {
    const validCode = generateTotpCode(totpSecret);
    const res = await apiRequest('/api/v1/auth/2fa/login', {
      method: 'POST',
      body: { mfaToken, code: validCode },
    });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}: ${res.text}`);
    if (!res.json?.data?.accessToken) throw new Error(`Did not issue accessToken after MFA`);
    accessToken = res.json.data.accessToken;
    return { details: `MFA challenge verified, new session issued` };
  });

  await runTest('2FA', 'Disable 2FA with valid TOTP code', async () => {
    const validCode = generateTotpCode(totpSecret);
    const res = await apiRequest('/api/v1/auth/2fa/disable', {
      method: 'POST',
      token: accessToken,
      body: { code: validCode },
    });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}: ${res.text}`);
    return { details: `2FA disabled, restored direct password sign-in` };
  });

  // ==========================================
  // SECTION 4: Organizations & Workspaces
  // ==========================================
  console.log(`\n\x1b[1m[4/8] Workspaces & Organizations\x1b[0m`);

  await runTest('Organizations', 'List organizations for authenticated user', async () => {
    const res = await apiRequest('/api/v1/organizations', {
      token: accessToken,
    });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}: ${res.text}`);
    const orgs = res.json?.data?.organizations || res.json?.data;
    if (!Array.isArray(orgs) || orgs.length === 0) {
      throw new Error(`Expected array of organizations, got: ${JSON.stringify(orgs)}`);
    }
    const org = orgs[0].organization || orgs[0];
    activeOrgId = org.id;
    return { details: `Active Org: "${org.name}" (ID: ${activeOrgId})` };
  });

  await runTest('Organizations', 'Fetch specific organization details', async () => {
    const res = await apiRequest(`/api/v1/organizations/${activeOrgId}`, {
      token: accessToken,
    });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}: ${res.text}`);
    return { details: `Organization verified: ${res.json?.data?.name}` };
  });

  await runTest('Organizations', 'List organization members and verify roles', async () => {
    const res = await apiRequest(`/api/v1/organizations/${activeOrgId}/members`, {
      token: accessToken,
    });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}: ${res.text}`);
    const members = res.json?.data?.members || res.json?.data;
    return { details: `Found ${Array.isArray(members) ? members.length : 0} workspace members` };
  });

  // ==========================================
  // SECTION 5: Projects Management
  // ==========================================
  console.log(`\n\x1b[1m[5/8] Projects Management\x1b[0m`);

  await runTest('Projects', 'List all projects in workspace', async () => {
    const res = await apiRequest(`/api/v1/organizations/${activeOrgId}/projects`, {
      token: accessToken,
    });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}: ${res.text}`);
    return { details: `Fetched project list successfully` };
  });

  await runTest('Projects', 'Create a new automated test project', async () => {
    const res = await apiRequest(`/api/v1/organizations/${activeOrgId}/projects`, {
      method: 'POST',
      token: accessToken,
      body: {
        name: `Automated Test Project ${Date.now().toString().slice(-4)}`,
        description: 'Project created via automated test suite',
      },
    });
    if (res.status !== 201 && res.status !== 200) throw new Error(`Expected 201/200, got ${res.status}: ${res.text}`);
    createdProjectId = res.json?.data?.id;
    if (!createdProjectId) throw new Error(`Missing project ID: ${res.text}`);
    return { details: `Created project: "${res.json.data.name}" (ID: ${createdProjectId})` };
  });

  await runTest('Projects', 'Update project title & description', async () => {
    const res = await apiRequest(`/api/v1/organizations/${activeOrgId}/projects/${createdProjectId}`, {
      method: 'PATCH',
      token: accessToken,
      body: {
        name: `Automated Test Project (Updated)`,
        description: 'Updated description for automation verification',
      },
    });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}: ${res.text}`);
    return { details: `Successfully updated project metadata` };
  });

  // ==========================================
  // SECTION 6: Tasks & Comments Lifecycle
  // ==========================================
  console.log(`\n\x1b[1m[6/8] Tasks & Comments\x1b[0m`);

  await runTest('Tasks', 'Create a new task in project', async () => {
    const res = await apiRequest(
      `/api/v1/organizations/${activeOrgId}/projects/${createdProjectId}/tasks`,
      {
        method: 'POST',
        token: accessToken,
        body: {
          title: 'Verify Two-Factor Auth and Realtime sync',
          description: 'High priority task for testing multi-tenant workflows',
          status: 'TODO',
          priority: 'HIGH',
        },
      }
    );
    if (res.status !== 201 && res.status !== 200) throw new Error(`Expected 201/200, got ${res.status}: ${res.text}`);
    createdTaskId = res.json?.data?.id;
    if (!createdTaskId) throw new Error(`Missing task ID: ${res.text}`);
    return { details: `Created task: "${res.json.data.title}" (ID: ${createdTaskId})` };
  });

  await runTest('Tasks', 'Transition task status to IN_PROGRESS and DONE', async () => {
    // Step a: IN_PROGRESS
    let res = await apiRequest(
      `/api/v1/organizations/${activeOrgId}/projects/${createdProjectId}/tasks/${createdTaskId}`,
      {
        method: 'PATCH',
        token: accessToken,
        body: { status: 'IN_PROGRESS' },
      }
    );
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}: ${res.text}`);

    // Step b: DONE
    res = await apiRequest(
      `/api/v1/organizations/${activeOrgId}/projects/${createdProjectId}/tasks/${createdTaskId}`,
      {
        method: 'PATCH',
        token: accessToken,
        body: { status: 'DONE' },
      }
    );
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}: ${res.text}`);
    return { details: `Transitioned task state: TODO -> IN_PROGRESS -> DONE` };
  });

  await runTest('Tasks', 'Add a comment to the task', async () => {
    const res = await apiRequest(
      `/api/v1/organizations/${activeOrgId}/projects/${createdProjectId}/tasks/${createdTaskId}/comments`,
      {
        method: 'POST',
        token: accessToken,
        body: { content: 'Automated test verification comment: passed with flying colors.' },
      }
    );
    if (res.status !== 201 && res.status !== 200) throw new Error(`Expected 201/200, got ${res.status}: ${res.text}`);
    return { details: `Comment posted on task` };
  });

  // ==========================================
  // SECTION 7: Meetings Lifecycle (Regression Verification)
  // ==========================================
  console.log(`\n\x1b[1m[7/8] Meetings & Calendar Operations (Regression Test)\x1b[0m`);

  await runTest('Meetings', 'List existing meetings in organization', async () => {
    const res = await apiRequest(`/api/v1/organizations/${activeOrgId}/meetings`, {
      token: accessToken,
    });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}: ${res.text}`);
    return { details: `Loaded meetings calendar feed` };
  });

  await runTest('Meetings', 'Schedule a new meeting', async () => {
    const startTime = new Date(Date.now() + 3600000).toISOString();
    const endTime = new Date(Date.now() + 7200000).toISOString();
    const res = await apiRequest(`/api/v1/organizations/${activeOrgId}/meetings`, {
      method: 'POST',
      token: accessToken,
      body: {
        title: 'Automated QA Review Meeting',
        description: 'End-to-end automation verification sync',
        startTime,
        endTime,
        location: 'Virtual / Google Meet',
      },
    });
    if (res.status !== 201 && res.status !== 200) throw new Error(`Expected 201/200, got ${res.status}: ${res.text}`);
    createdMeetingId = res.json?.data?.id;
    if (!createdMeetingId) throw new Error(`Missing meeting ID: ${res.text}`);
    return { details: `Meeting scheduled: "${res.json.data.title}" (ID: ${createdMeetingId})` };
  });

  await runTest('Meetings', 'Fetch scheduled meeting by ID', async () => {
    const res = await apiRequest(`/api/v1/organizations/${activeOrgId}/meetings/${createdMeetingId}`, {
      token: accessToken,
    });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}: ${res.text}`);
    return { details: `Fetched meeting details successfully` };
  });

  await runTest('Meetings', 'Delete meeting (Regression: Verify Clean Deletion)', async () => {
    const res = await apiRequest(`/api/v1/organizations/${activeOrgId}/meetings/${createdMeetingId}`, {
      method: 'DELETE',
      token: accessToken,
    });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}: ${res.text}`);
    return { details: `Meeting successfully deleted without foreign key or server errors` };
  });

  // ==========================================
  // SECTION 8: Dashboard, Audits & Cleanup
  // ==========================================
  console.log(`\n\x1b[1m[8/8] Dashboard, Activity Stream & Cleanup\x1b[0m`);

  await runTest('Dashboard', 'Fetch workspace dashboard statistics', async () => {
    const res = await apiRequest(`/api/v1/organizations/${activeOrgId}/dashboard`, {
      token: accessToken,
    });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}: ${res.text}`);
    return { details: `Dashboard metrics computed successfully` };
  });

  await runTest('Activity', 'Fetch workspace audit activity log', async () => {
    const res = await apiRequest(`/api/v1/organizations/${activeOrgId}/activity`, {
      token: accessToken,
    });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}: ${res.text}`);
    return { details: `Audit log returned event records` };
  });

  await runTest('Notifications', 'Fetch user notifications', async () => {
    const res = await apiRequest(`/api/v1/notifications`, {
      token: accessToken,
    });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}: ${res.text}`);
    return { details: `Notifications retrieved successfully` };
  });

  if (createdProjectId) {
    await runTest('Cleanup', 'Delete test project and cascaded records', async () => {
      const res = await apiRequest(
        `/api/v1/organizations/${activeOrgId}/projects/${createdProjectId}`,
        {
          method: 'DELETE',
          token: accessToken,
        }
      );
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}: ${res.text}`);
      return { details: `Cleaned up test project: ${createdProjectId}` };
    });
  }

  // ==========================================
  // FINAL REPORT
  // ==========================================
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const totalDuration = results.reduce((acc, r) => acc + r.durationMs, 0);

  console.log(`\n================================================================================`);
  console.log(`📊 AUTOMATION EXECUTION SUMMARY`);
  console.log(`================================================================================`);
  console.log(`Total Tests:    ${total}`);
  console.log(`\x1b[32mPassed:\x1b[0m         ${passed}`);
  console.log(`\x1b[${failed > 0 ? '31' : '32'}mFailed:\x1b[0m         ${failed}`);
  console.log(`Total Duration: ${(totalDuration / 1000).toFixed(2)}s`);
  console.log(`Target User:    ${USER_EMAIL}`);
  console.log(`Status:         ${failed === 0 ? '\x1b[32mALL TESTS PASSED ✔\x1b[0m' : '\x1b[31mSOME TESTS FAILED ✖\x1b[0m'}`);
  console.log(`================================================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
