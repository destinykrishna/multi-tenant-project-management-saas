import autocannon, { type Options, type Result } from 'autocannon';
import { prisma, disconnectDatabase } from '../src/config/database.js';
import { generateAccessToken } from '../src/utils/jwt.js';
import { OrganizationRole } from '../src/constants/roles.js';

import { env } from '../src/config/env.js';

const TARGET_PORT = env.PORT || 5000;
const TARGET_URL = process.env['TARGET_URL'] || `http://localhost:${TARGET_PORT}`;

interface BenchmarkScenario {
  name: string;
  endpoint: string;
  method: 'GET' | 'POST';
  headers?: Record<string, string>;
  connections: number;
  duration: number;
}

function printResultTable(result: Result, scenarioName: string) {
  console.log(`\n================================================================================`);
  console.log(`📊 Benchmark Results: ${scenarioName}`);
  console.log(`================================================================================`);
  console.log(`🎯 Target URL:       ${result.url}`);
  console.log(`👥 Connections:      ${result.connections}`);
  console.log(`⏱️  Duration:         ${result.duration}s`);
  console.log(`--------------------------------------------------------------------------------`);
  console.log(`🚀 Throughput & Requests:`);
  console.log(`   • Total Requests:  ${result.requests.total}`);
  console.log(`   • Req/Sec (Avg):   ${result.requests.average.toFixed(1)} req/s`);
  console.log(`   • Req/Sec (Max):   ${result.requests.max} req/s`);
  console.log(`   • Data Transfer:   ${(result.throughput.total / 1024 / 1024).toFixed(2)} MB (${(result.throughput.average / 1024 / 1024).toFixed(2)} MB/s)`);
  console.log(`--------------------------------------------------------------------------------`);
  console.log(`⌛ Latency Distribution:`);
  console.log(`   • Average:         ${result.latency.average.toFixed(2)} ms`);
  console.log(`   • Median (p50):    ${result.latency.p50} ms`);
  console.log(`   • p90:             ${result.latency.p90} ms`);
  console.log(`   • p97.5:           ${result.latency.p97_5} ms`);
  console.log(`   • p99:             ${result.latency.p99} ms`);
  console.log(`   • Max:             ${result.latency.max} ms`);
  console.log(`--------------------------------------------------------------------------------`);
  console.log(`⚠️ Errors & Statuses:`);
  console.log(`   • 2xx Success:     ${result['2xx']}`);
  console.log(`   • 4xx Client Err:  ${result['4xx']}`);
  console.log(`   • 5xx Server Err:  ${result['5xx']}`);
  console.log(`   • Timeouts:        ${result.timeouts}`);
  console.log(`   • Errors:          ${result.errors}`);
  console.log(`================================================================================\n`);
}

async function runAutocannon(options: Options, scenarioName: string): Promise<Result> {
  console.log(`\n⏳ Running benchmark [${scenarioName}] against ${options.url}...`);
  return new Promise<Result>((resolve, reject) => {
    autocannon(options, (err, result) => {
      if (err) {
        reject(err);
        return;
      }
      printResultTable(result, scenarioName);
      resolve(result);
    });
  });
}

async function setupTestContext(): Promise<{ token: string; organizationId: string }> {
  try {
    let testUser = await prisma.user.findFirst({
      where: { email: 'loadtest@example.com' },
    });

    if (!testUser) {
      testUser = await prisma.user.create({
        data: {
          name: 'Load Test User',
          email: 'loadtest@example.com',
          passwordHash: '$2a$10$abcdefghijklmnopqrstuvwxyz1234567890abcdefghijklmnopqr',
        },
      });
    }

    let testOrg = await prisma.organization.findFirst({
      where: { ownerId: testUser.id },
    });

    if (!testOrg) {
      testOrg = await prisma.organization.create({
        data: {
          name: 'Load Test Org',
          slug: `load-test-org-${Date.now()}`,
          ownerId: testUser.id,
          members: {
            create: {
              userId: testUser.id,
              role: OrganizationRole.OWNER,
            },
          },
        },
      });
    }

    const token = generateAccessToken({ userId: testUser.id, email: testUser.email });
    return { token, organizationId: testOrg.id };
  } catch (error) {
    console.warn('⚠️ Could not seed database test user for authenticated load testing (DB might be remote or offline).');
    return { token: '', organizationId: '' };
  }
}

async function main() {
  console.log(`================================================================================`);
  console.log(`🏁 Starting Autocannon Load-Testing Suite`);
  console.log(`🌐 Gateway / Load Balancer Target: ${TARGET_URL}`);
  console.log(`================================================================================`);

  const { token, organizationId } = await setupTestContext();

  try {
    const probe = await fetch(`${TARGET_URL}/health`);
    if (!probe.ok) {
      console.warn(`⚠️ Target server returned HTTP ${probe.status} at ${TARGET_URL}/health`);
    } else {
      console.log(`✅ Pre-flight connectivity check passed against ${TARGET_URL}/health`);
    }
  } catch (err: any) {
    console.error(`\n❌ PRE-FLIGHT CHECK FAILED: Cannot connect to target server at ${TARGET_URL}/health.`);
    console.error(`   Please ensure the backend dev server is running (e.g. 'npm run dev' on port ${TARGET_PORT}).`);
    console.error(`   If your server or Nginx is listening on another port/host, run with:`);
    console.error(`   TARGET_URL=http://localhost:<port> npm run test:load\n`);
    await disconnectDatabase();
    process.exit(1);
  }

  const scenarios: BenchmarkScenario[] = [
    // ─── Scenario 1: Public Health Check (Progressive Concurrency) ─────────
    {
      name: 'Health Check (Baseline - 10 Concurrency)',
      endpoint: '/health',
      method: 'GET',
      connections: 10,
      duration: 10,
    },
    {
      name: 'Health Check (Medium Load - 50 Concurrency)',
      endpoint: '/health',
      method: 'GET',
      connections: 50,
      duration: 10,
    },
    {
      name: 'Health Check (High Load - 100 Concurrency)',
      endpoint: '/health',
      method: 'GET',
      connections: 100,
      duration: 10,
    },
  ];

  if (token && organizationId) {
    scenarios.push(
      // ─── Scenario 2: Authenticated Organization Projects ───────────────────
      {
        name: 'Authenticated Projects Listing (50 Concurrency)',
        endpoint: `/api/v1/organizations/${organizationId}/projects`,
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, 'x-load-test': 'true' },
        connections: 50,
        duration: 10,
      },
      // ─── Scenario 3: Authenticated Organization Dashboard (Aggregations) ──
      {
        name: 'Authenticated Dashboard Aggregations (50 Concurrency)',
        endpoint: `/api/v1/organizations/${organizationId}/dashboard`,
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, 'x-load-test': 'true' },
        connections: 50,
        duration: 10,
      },
    );
  }

  for (const scenario of scenarios) {
    try {
      await runAutocannon(
        {
          url: `${TARGET_URL}${scenario.endpoint}`,
          method: scenario.method,
          headers: scenario.headers,
          connections: scenario.connections,
          duration: scenario.duration,
          pipelining: 1,
        },
        scenario.name,
      );
    } catch (err) {
      console.error(`❌ Benchmark error on scenario "${scenario.name}":`, err);
    }
  }

  await disconnectDatabase();
  console.log(`\n🎉 Load-testing run completed.`);
}

void main();
