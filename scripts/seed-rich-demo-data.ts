import { prisma } from '../src/config/database.js';
import { hashPassword } from '../src/utils/password.js';

async function seedUserOrg(email: string, userName: string, orgName: string) {
  console.log(`\n💼 Seeding enterprise data for user: ${email} (${orgName})...`);

  const defaultPasswordHash = await hashPassword('Password123!');

  // 1. Find or create user
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        name: userName,
        passwordHash: defaultPasswordHash,
        isEmailVerified: true,
      }
    });
    console.log(`Created user: ${email}`);
  }

  // 2. Team members
  const teamMembersData = [
    { email: 'sarah.chen@cloudscale.io', name: 'Sarah Chen (Lead Architect)', role: 'ADMIN' as const },
    { email: 'alex.rivera@cloudscale.io', name: 'Alex Rivera (Frontend Engineer)', role: 'MEMBER' as const },
    { email: 'priya.patel@cloudscale.io', name: 'Priya Patel (DevOps & Security)', role: 'MEMBER' as const },
    { email: 'david.kim@cloudscale.io', name: 'David Kim (QA Engineer)', role: 'MEMBER' as const },
  ];

  const teamUsers = [];
  for (const m of teamMembersData) {
    let tUser = await prisma.user.findUnique({ where: { email: m.email } });
    if (!tUser) {
      tUser = await prisma.user.create({
        data: {
          email: m.email,
          name: m.name,
          passwordHash: defaultPasswordHash,
          isEmailVerified: true,
        }
      });
    }
    teamUsers.push({ user: tUser, role: m.role });
  }

  // 3. Organization
  let org = await prisma.organization.findFirst({
    where: {
      members: {
        some: { userId: user.id }
      }
    }
  });

  if (!org) {
    const slug = email.split('@')[0] + '-enterprise';
    org = await prisma.organization.create({
      data: {
        name: orgName,
        slug,
        ownerId: user.id,
        members: {
          create: {
            userId: user.id,
            role: 'OWNER'
          }
        }
      }
    });
  } else {
    // Update name to enterprise name
    org = await prisma.organization.update({
      where: { id: org.id },
      data: { name: orgName }
    });
  }

  console.log(`Organization ready: "${org.name}" (${org.id})`);

  // Add team members to organization
  for (const member of teamUsers) {
    const existing = await prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: org.id,
          userId: member.user.id
        }
      }
    });

    if (!existing) {
      await prisma.organizationMember.create({
        data: {
          organizationId: org.id,
          userId: member.user.id,
          role: member.role
        }
      });
    }
  }

  // 4. Clean up any dummy projects
  await prisma.project.deleteMany({
    where: {
      organizationId: org.id,
      name: { in: ['This is a project', 'tttt'] }
    }
  });

  // 5. Create 4 Projects
  const projectsData = [
    {
      name: 'Cloud Infrastructure Modernization',
      key: 'CLOUD',
      description: 'Multi-tenant database scaling, Row-Level Security rollout, and sub-millisecond edge routing.',
    },
    {
      name: 'Zero-Trust Security & 2FA Engine',
      key: 'SEC',
      description: 'RFC 6238 TOTP authentication, SHA-256 token rotation, and distributed rate limiting.',
    },
    {
      name: 'AI Knowledge Engine (RAG)',
      key: 'RAG',
      description: 'Semantic vector embeddings, document ingestion pipelines, and contextual workspace retrieval.',
    },
    {
      name: 'Mobile & Edge Client SDK',
      key: 'SDK',
      description: 'Cross-platform mobile workspace, offline sync caching, and push notification streams.',
    }
  ];

  const projects = [];
  for (const p of projectsData) {
    let project = await prisma.project.findFirst({
      where: { organizationId: org.id, key: p.key }
    });

    if (!project) {
      project = await prisma.project.create({
        data: {
          organizationId: org.id,
          name: p.name,
          key: p.key,
          description: p.description,
          createdById: user.id,
        }
      });
    }
    projects.push(project);
  }

  const [cloudProject, secProject, ragProject, sdkProject] = projects;

  // Clear existing tasks in these projects for a clean refresh
  await prisma.task.deleteMany({
    where: { projectId: { in: projects.map(p => p.id) } }
  });

  const now = new Date();
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  // 6. Seed rich Tasks
  const tasksToCreate = [
    // --- TODO ---
    {
      project: cloudProject,
      title: 'Setup Prometheus & Grafana telemetry exporter',
      description: 'Collect p99 latency distributions, memory usage, and Redis pool utilization metrics.',
      status: 'TODO' as const,
      priority: 'MEDIUM' as const,
      assignee: teamUsers[2].user.id, // Priya
      dueDate: nextWeek,
      position: 1000,
    },
    {
      project: secProject,
      title: 'Implement automated token revocation via Redis Bloom filter',
      description: 'Prevent token replay attacks while maintaining sub-millisecond verification overhead.',
      status: 'TODO' as const,
      priority: 'HIGH' as const,
      assignee: teamUsers[0].user.id, // Sarah
      dueDate: nextWeek,
      position: 2000,
    },
    {
      project: sdkProject,
      title: 'Design dark mode token contrast palette for mobile views',
      description: 'Audit WCAG 2.1 AAA color contrast ratios across OLED mobile display profiles.',
      status: 'TODO' as const,
      priority: 'LOW' as const,
      assignee: teamUsers[1].user.id, // Alex
      dueDate: nextWeek,
      position: 3000,
    },
    {
      project: secProject,
      title: 'Conduct third-party penetration testing for Ingress Nginx',
      description: 'Simulate HTTP request smuggling, header injection, and connection starvation vectors.',
      status: 'TODO' as const,
      priority: 'URGENT' as const,
      assignee: teamUsers[3].user.id, // David
      dueDate: tomorrow,
      position: 4000,
    },

    // --- IN_PROGRESS ---
    {
      project: cloudProject,
      title: 'Optimize PostgreSQL RLS context injection with connection pooling',
      description: 'Ensure SET LOCAL app.current_org_id executes cleanly across shared pg.Pool clients.',
      status: 'IN_PROGRESS' as const,
      priority: 'URGENT' as const,
      assignee: user.id, // Primary User
      dueDate: tomorrow,
      position: 1000,
    },
    {
      project: sdkProject,
      title: 'Build interactive Kanban drag-and-drop column reordering',
      description: 'Provide smooth visual transitions, optimistic UI updates, and conflict resolution.',
      status: 'IN_PROGRESS' as const,
      priority: 'HIGH' as const,
      assignee: teamUsers[1].user.id, // Alex
      dueDate: tomorrow,
      position: 2000,
    },
    {
      project: cloudProject,
      title: 'Streamline BullMQ worker concurrency for batch notifications',
      description: 'Tune concurrency limits to eliminate Redis pipeline stalls during peak hours.',
      status: 'IN_PROGRESS' as const,
      priority: 'HIGH' as const,
      assignee: teamUsers[0].user.id, // Sarah
      dueDate: nextWeek,
      position: 3000,
    },
    {
      project: secProject,
      title: 'Configure Cloudflare Turnstile verification on public auth endpoints',
      description: 'Block malicious credential stuffing attempts without introducing CAPTCHA friction.',
      status: 'IN_PROGRESS' as const,
      priority: 'MEDIUM' as const,
      assignee: teamUsers[2].user.id, // Priya
      dueDate: nextWeek,
      position: 4000,
    },

    // --- IN_REVIEW ---
    {
      project: secProject,
      title: 'RFC 6238 TOTP Secret Generation & Dynamic QR Verification PR',
      description: 'Complete Base32 generator, clock-drift compensation, and fallback recovery codes.',
      status: 'IN_REVIEW' as const,
      priority: 'URGENT' as const,
      assignee: user.id, // Primary User
      dueDate: tomorrow,
      position: 1000,
    },
    {
      project: cloudProject,
      title: 'Autocannon stress test benchmark report (4,910 req/s sustained)',
      description: 'Consolidate 50-concurrency benchmark results, latency distributions, and zero-error graphs.',
      status: 'IN_REVIEW' as const,
      priority: 'HIGH' as const,
      assignee: teamUsers[3].user.id, // David
      dueDate: tomorrow,
      position: 2000,
    },
    {
      project: ragProject,
      title: 'Vector embedding pipeline for Markdown workspace documents',
      description: 'Chunk documents by semantic sections and generate 768-dimensional dense vectors.',
      status: 'IN_REVIEW' as const,
      priority: 'MEDIUM' as const,
      assignee: teamUsers[0].user.id, // Sarah
      dueDate: nextWeek,
      position: 3000,
    },

    // --- DONE ---
    {
      project: cloudProject,
      title: 'Establish PostgreSQL 16 RLS session variable engine',
      description: 'Enforced zero-trust database isolation using native SET LOCAL app.current_org_id.',
      status: 'DONE' as const,
      priority: 'URGENT' as const,
      assignee: user.id, // Primary User
      dueDate: yesterday,
      position: 1000,
    },
    {
      project: secProject,
      title: 'Implement dual-token JWT refresh rotation with SHA-256 hashes',
      description: 'Cryptographic refresh token hashing with automated family reuse revocation.',
      status: 'DONE' as const,
      priority: 'HIGH' as const,
      assignee: user.id, // Primary User
      dueDate: yesterday,
      position: 2000,
    },
    {
      project: cloudProject,
      title: 'Construct 32-step E2E automation regression test runner',
      description: 'Autonomous end-to-end integration test coverage across full tenant lifecycles.',
      status: 'DONE' as const,
      priority: 'HIGH' as const,
      assignee: teamUsers[3].user.id, // David
      dueDate: threeDaysAgo,
      position: 3000,
    },
    {
      project: cloudProject,
      title: 'Deploy least_conn Nginx load balancer with real-IP restoration',
      description: 'Configured connection pooling, HTTP keep-alive, and Cloudflare subnet CIDR headers.',
      status: 'DONE' as const,
      priority: 'HIGH' as const,
      assignee: teamUsers[2].user.id, // Priya
      dueDate: threeDaysAgo,
      position: 4000,
    },
    {
      project: sdkProject,
      title: 'Next.js 16 App Router workspace layout & telemetry monitors',
      description: 'Engineered responsive navigation, telemetry widgets, and real-time state synchronization.',
      status: 'DONE' as const,
      priority: 'MEDIUM' as const,
      assignee: teamUsers[1].user.id, // Alex
      dueDate: threeDaysAgo,
      position: 5000,
    },

    // --- OVERDUE TASK ---
    {
      project: cloudProject,
      title: 'Archive historical audit logs older than 90 days to S3 Glacier',
      description: 'Implement monthly cron schedule for cold storage data compliance.',
      status: 'TODO' as const,
      priority: 'MEDIUM' as const,
      assignee: user.id,
      dueDate: yesterday, // Overdue
      position: 5000,
    }
  ];

  const createdTasks = [];
  for (const t of tasksToCreate) {
    const task = await prisma.task.create({
      data: {
        projectId: t.project.id,
        title: t.title,
        description: t.description,
        status: t.status,
        priority: t.priority,
        assigneeId: t.assignee,
        createdById: user.id,
        dueDate: t.dueDate,
        position: t.position,
      }
    });
    createdTasks.push(task);
  }
  console.log(`Created ${createdTasks.length} rich tasks across projects!`);

  // 7. Comments
  const rlsTask = createdTasks.find(t => t.title.includes('PostgreSQL 16 RLS'));
  if (rlsTask) {
    await prisma.comment.createMany({
      data: [
        {
          taskId: rlsTask.id,
          userId: teamUsers[0].user.id,
          content: 'Validated with multi-tenant SQL execution queries: zero cross-tenant leaks detected in isolated transactions. Production-ready!',
          createdAt: yesterday,
        },
        {
          taskId: rlsTask.id,
          userId: user.id,
          content: 'Merged into main branch and benchmarked against 50 concurrent tenant sessions.',
          createdAt: now,
        }
      ]
    });
  }

  const loadTestTask = createdTasks.find(t => t.title.includes('Autocannon'));
  if (loadTestTask) {
    await prisma.comment.create({
      data: {
        taskId: loadTestTask.id,
        userId: teamUsers[3].user.id,
        content: 'Autocannon run clocked 4,910 req/s average throughput and 9.7ms latency over 49,088 requests. Outstanding stability!',
        createdAt: now,
      }
    });
  }

  // 8. Meetings
  await prisma.meeting.deleteMany({
    where: { organizationId: org.id }
  });

  const meetingDate1 = new Date(Date.now() + 18 * 60 * 60 * 1000);
  const meetingEnd1 = new Date(meetingDate1.getTime() + 45 * 60 * 1000);

  const meetingDate2 = new Date(Date.now() + 42 * 60 * 60 * 1000);
  const meetingEnd2 = new Date(meetingDate2.getTime() + 60 * 60 * 1000);

  await prisma.meeting.createMany({
    data: [
      {
        organizationId: org.id,
        projectId: cloudProject.id,
        createdById: user.id,
        title: 'Weekly System Architecture & Scale Review',
        description: 'Reviewing RLS connection pool metrics, Redis memory cache tiering, and upcoming sprint objectives.',
        startTime: meetingDate1,
        endTime: meetingEnd1,
        location: 'Virtual Conference Room A',
        googleMeetLink: 'https://meet.google.com/xyz-arch-sync',
        googleMeetId: 'xyz-arch-sync',
        isMeetEnabled: true,
      },
      {
        organizationId: org.id,
        projectId: secProject.id,
        createdById: user.id,
        title: 'Security Compliance & 2FA Rollout Sync',
        description: 'End-to-end verification of RFC 6238 TOTP pairing, recovery codes, and rate limiting thresholds.',
        startTime: meetingDate2,
        endTime: meetingEnd2,
        location: 'Security War Room',
        googleMeetLink: 'https://meet.google.com/sec-audit-2026',
        googleMeetId: 'sec-audit-2026',
        isMeetEnabled: true,
      }
    ]
  });
  console.log('Created scheduled enterprise meetings with Google Meet links');

  // 9. Activity Logs
  await prisma.activityLog.deleteMany({
    where: { organizationId: org.id }
  });

  await prisma.activityLog.createMany({
    data: [
      {
        organizationId: org.id,
        userId: user.id,
        entityType: 'TASK',
        entityId: createdTasks[4].id,
        action: 'TASK_STATUS_CHANGED',
        metadata: { title: 'Optimize PostgreSQL RLS context injection with connection pooling', from: 'TODO', to: 'IN_PROGRESS' },
        createdAt: now,
      },
      {
        organizationId: org.id,
        userId: teamUsers[3].user.id,
        entityType: 'TASK',
        entityId: createdTasks[9].id,
        action: 'TASK_STATUS_CHANGED',
        metadata: { title: 'Autocannon stress test benchmark report (4,910 req/s sustained)', from: 'IN_PROGRESS', to: 'IN_REVIEW' },
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      },
      {
        organizationId: org.id,
        userId: user.id,
        entityType: 'TASK',
        entityId: createdTasks[11].id,
        action: 'TASK_STATUS_CHANGED',
        metadata: { title: 'Establish PostgreSQL 16 RLS session variable engine', from: 'IN_REVIEW', to: 'DONE' },
        createdAt: yesterday,
      },
      {
        organizationId: org.id,
        userId: teamUsers[0].user.id,
        entityType: 'USER',
        entityId: teamUsers[1].user.id,
        action: 'MEMBER_ADDED',
        metadata: { memberEmail: 'alex.rivera@cloudscale.io', role: 'MEMBER' },
        createdAt: yesterday,
      },
      {
        organizationId: org.id,
        userId: user.id,
        entityType: 'PROJECT',
        entityId: cloudProject.id,
        action: 'CREATED',
        metadata: { projectName: 'Cloud Infrastructure Modernization', key: 'CLOUD' },
        createdAt: threeDaysAgo,
      }
    ]
  });
  console.log('Created activity audit logs for dashboard feed');

  // 10. Notifications
  await prisma.notification.deleteMany({
    where: { userId: user.id }
  });

  await prisma.notification.createMany({
    data: [
      {
        userId: user.id,
        organizationId: org.id,
        type: 'TASK_ASSIGNED',
        title: 'New Task Assigned',
        message: 'You have been assigned to: "Optimize PostgreSQL RLS context injection with connection pooling"',
        isRead: false,
        createdAt: now,
      },
      {
        userId: user.id,
        organizationId: org.id,
        type: 'COMMENT_ADDED',
        title: 'New Comment from Sarah Chen',
        message: 'Sarah Chen commented on "PostgreSQL 16 RLS session variable engine": Validated with multi-tenant SQL execution queries...',
        isRead: false,
        createdAt: new Date(Date.now() - 4 * 60 * 60 * 1000),
      },
      {
        userId: user.id,
        organizationId: org.id,
        type: 'GENERAL',
        title: 'Autocannon Benchmark Success',
        message: 'Autocannon stress test passed with 4,910 req/s sustained throughput (0 errors, 49,088 requests)',
        isRead: true,
        readAt: now,
        createdAt: yesterday,
      }
    ]
  });
  console.log('Created notifications for notification tray');
}

async function main() {
  // Seed for Suresh (the active user)
  await seedUserOrg('suresh@gmail.com', 'Suresh', 'CloudScale Technologies');

  // Also ensure Krishna has the data
  await seedUserOrg('krishna20420@gmail.com', 'Krishna Vishwakarma', 'CloudScale Enterprise');

  console.log('\n🎉 ALL ACCOUNTS SUCCESSFULLY SEEDED WITH ENTERPRISE DATA!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
