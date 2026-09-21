import request from 'supertest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { app } from '../../src/app.js';
import { prisma, disconnectDatabase } from '../../src/config/database.js';
import { generateAccessToken } from '../../src/utils/jwt.js';
import { UPLOAD_DIR, getSafeFilePath } from '../../src/modules/attachments/attachment.storage.js';

describe('Attachments Module Integration Tests', () => {
  let ownerUser: { id: string; email: string; token: string };
  let adminUser: { id: string; email: string; token: string };
  let member1User: { id: string; email: string; token: string };
  let member2User: { id: string; email: string; token: string };
  let viewerUser: { id: string; email: string; token: string };
  let outsideUser: { id: string; email: string; token: string };

  let org1Id: string;
  let org2Id: string;
  let project1Id: string;
  let project2Id: string;
  let task1Id: string;
  let task2Id: string;

  const createdUserIds: string[] = [];
  const createdFilesOnDisk: string[] = [];

  beforeAll(async () => {
    // Ensure uploads directory exists
    if (!fs.existsSync(UPLOAD_DIR)) {
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    }

    // 1. Create test users
    const users = await Promise.all([
      prisma.user.create({
        data: {
          name: 'Attach Owner',
          email: `att.owner.${Date.now()}@example.com`,
          passwordHash: 'dummy-hash',
        },
      }),
      prisma.user.create({
        data: {
          name: 'Attach Admin',
          email: `att.admin.${Date.now()}@example.com`,
          passwordHash: 'dummy-hash',
        },
      }),
      prisma.user.create({
        data: {
          name: 'Attach Member 1',
          email: `att.mem1.${Date.now()}@example.com`,
          passwordHash: 'dummy-hash',
        },
      }),
      prisma.user.create({
        data: {
          name: 'Attach Member 2',
          email: `att.mem2.${Date.now()}@example.com`,
          passwordHash: 'dummy-hash',
        },
      }),
      prisma.user.create({
        data: {
          name: 'Attach Viewer',
          email: `att.viewer.${Date.now()}@example.com`,
          passwordHash: 'dummy-hash',
        },
      }),
      prisma.user.create({
        data: {
          name: 'Attach Outside',
          email: `att.outside.${Date.now()}@example.com`,
          passwordHash: 'dummy-hash',
        },
      }),
    ]);

    users.forEach((u) => createdUserIds.push(u.id));

    ownerUser = {
      id: users[0].id,
      email: users[0].email,
      token: generateAccessToken({ userId: users[0].id, email: users[0].email }),
    };

    adminUser = {
      id: users[1].id,
      email: users[1].email,
      token: generateAccessToken({ userId: users[1].id, email: users[1].email }),
    };

    member1User = {
      id: users[2].id,
      email: users[2].email,
      token: generateAccessToken({ userId: users[2].id, email: users[2].email }),
    };

    member2User = {
      id: users[3].id,
      email: users[3].email,
      token: generateAccessToken({ userId: users[3].id, email: users[3].email }),
    };

    viewerUser = {
      id: users[4].id,
      email: users[4].email,
      token: generateAccessToken({ userId: users[4].id, email: users[4].email }),
    };

    outsideUser = {
      id: users[5].id,
      email: users[5].email,
      token: generateAccessToken({ userId: users[5].id, email: users[5].email }),
    };

    // 2. Organizations
    const org1 = await prisma.organization.create({
      data: {
        name: 'Attach Org 1',
        slug: `att-org-1-${randomUUID()}`,
        ownerId: ownerUser.id,
      },
    });
    org1Id = org1.id;

    const org2 = await prisma.organization.create({
      data: {
        name: 'Attach Org 2',
        slug: `att-org-2-${randomUUID()}`,
        ownerId: outsideUser.id,
      },
    });
    org2Id = org2.id;

    // 3. Memberships
    await prisma.organizationMember.createMany({
      data: [
        { organizationId: org1Id, userId: ownerUser.id, role: 'OWNER' },
        { organizationId: org1Id, userId: adminUser.id, role: 'ADMIN' },
        { organizationId: org1Id, userId: member1User.id, role: 'MEMBER' },
        { organizationId: org1Id, userId: member2User.id, role: 'MEMBER' },
        { organizationId: org1Id, userId: viewerUser.id, role: 'VIEWER' },
        { organizationId: org2Id, userId: outsideUser.id, role: 'OWNER' },
      ],
    });

    // 4. Projects
    const prj1 = await prisma.project.create({
      data: {
        organizationId: org1Id,
        name: 'Attach Project 1',
        key: 'APRJ1',
        createdById: ownerUser.id,
      },
    });
    project1Id = prj1.id;

    const prj2 = await prisma.project.create({
      data: {
        organizationId: org2Id,
        name: 'Attach Project 2',
        key: 'APRJ2',
        createdById: outsideUser.id,
      },
    });
    project2Id = prj2.id;

    // 5. Tasks
    const tsk1 = await prisma.task.create({
      data: {
        projectId: project1Id,
        title: 'Task for Attachments',
        createdById: ownerUser.id,
      },
    });
    task1Id = tsk1.id;

    const tsk2 = await prisma.task.create({
      data: {
        projectId: project2Id,
        title: 'Task in Org 2',
        createdById: outsideUser.id,
      },
    });
    task2Id = tsk2.id;
  });

  afterAll(async () => {
    // Clean up created files on disk
    for (const filePath of createdFilesOnDisk) {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch {
        // ignore
      }
    }

    if (org1Id || org2Id) {
      await prisma.attachment.deleteMany({
        where: { taskId: { in: [task1Id, task2Id].filter(Boolean) } },
      });
      await prisma.task.deleteMany({
        where: { projectId: { in: [project1Id, project2Id].filter(Boolean) } },
      });
      await prisma.project.deleteMany({
        where: { organizationId: { in: [org1Id, org2Id].filter(Boolean) } },
      });
      await prisma.organizationMember.deleteMany({
        where: { organizationId: { in: [org1Id, org2Id].filter(Boolean) } },
      });
      await prisma.organization.deleteMany({
        where: { id: { in: [org1Id, org2Id].filter(Boolean) } },
      });
    }

    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }

    await disconnectDatabase();
  });

  describe('POST .../tasks/:taskId/attachments (Upload)', () => {
    it('should allow MEMBER to upload a valid text file (201)', async () => {
      const fileContent = 'Hello attachment contents from integration test!';
      const res = await request(app)
        .post(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}/attachments`)
        .set('Authorization', `Bearer ${member1User.token}`)
        .attach('file', Buffer.from(fileContent), 'sample-note.txt')
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.originalName).toBe('sample-note.txt');
      expect(res.body.data.mimeType).toBe('text/plain');
      expect(res.body.data.size).toBe(Buffer.byteLength(fileContent));
      expect(res.body.data.uploadedBy.id).toBe(member1User.id);
      expect(res.body.data.uploadedBy.email).toBe(member1User.email);
      expect(res.body.data.storageKey).toBeUndefined(); // Storage key is never exposed

      // Verify physical file was written to disk under uploads/
      const dbRecord = await prisma.attachment.findUnique({ where: { id: res.body.data.id } });
      expect(dbRecord).not.toBeNull();
      const expectedPath = path.resolve(UPLOAD_DIR, dbRecord!.storageKey);
      expect(fs.existsSync(expectedPath)).toBe(true);
      expect(fs.readFileSync(expectedPath, 'utf8')).toBe(fileContent);
      createdFilesOnDisk.push(expectedPath);
    });

    it('should allow OWNER to upload a PDF or image file (201)', async () => {
      const pdfBuffer = Buffer.from('%PDF-1.4 test dummy content');
      const res = await request(app)
        .post(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}/attachments`)
        .set('Authorization', `Bearer ${ownerUser.token}`)
        .attach('file', pdfBuffer, 'document.pdf')
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.originalName).toBe('document.pdf');
      expect(res.body.data.mimeType).toBe('application/pdf');

      const dbRecord = await prisma.attachment.findUnique({ where: { id: res.body.data.id } });
      expect(dbRecord).not.toBeNull();
      const expectedPath = path.resolve(UPLOAD_DIR, dbRecord!.storageKey);
      expect(fs.existsSync(expectedPath)).toBe(true);
      createdFilesOnDisk.push(expectedPath);
    });

    it('should reject upload when no file is attached (400)', async () => {
      const res = await request(app)
        .post(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}/attachments`)
        .set('Authorization', `Bearer ${member1User.token}`)
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FILE_REQUIRED');
    });

    it('should reject disallowed executable file extensions (400)', async () => {
      const res = await request(app)
        .post(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}/attachments`)
        .set('Authorization', `Bearer ${member1User.token}`)
        .attach('file', Buffer.from('echo dangerous'), 'evil_script.sh')
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('DISALLOWED_FILE_TYPE');
    });

    it('should reject dangerous windows executable file extensions like .exe (400)', async () => {
      const res = await request(app)
        .post(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}/attachments`)
        .set('Authorization', `Bearer ${member1User.token}`)
        .attach('file', Buffer.from('MZ...binary'), 'malware.exe')
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('DISALLOWED_FILE_TYPE');
    });

    it('should reject .html file upload to prevent stored XSS (400)', async () => {
      const htmlPayload = '<!DOCTYPE html><html><body><script>alert("xss")</script></body></html>';
      const res = await request(app)
        .post(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}/attachments`)
        .set('Authorization', `Bearer ${member1User.token}`)
        .attach('file', Buffer.from(htmlPayload), 'malicious.html')
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('DISALLOWED_FILE_TYPE');
    });

    it('should reject .svg file upload to prevent stored XSS (400)', async () => {
      const svgPayload = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><circle r="10"/></svg>';
      const res = await request(app)
        .post(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}/attachments`)
        .set('Authorization', `Bearer ${member1User.token}`)
        .attach('file', Buffer.from(svgPayload), 'vector.svg')
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('DISALLOWED_FILE_TYPE');
    });

    it('should reject other dangerous web-active extensions (.htm, .xml, .xhtml, .shtml, .jsp, .asp, .aspx) (400)', async () => {
      const dangerousExtensions = [
        'page.htm',
        'feed.xml',
        'doc.xhtml',
        'exec.shtml',
        'webshell.jsp',
        'webshell.asp',
        'handler.aspx',
      ];

      for (const filename of dangerousExtensions) {
        const res = await request(app)
          .post(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}/attachments`)
          .set('Authorization', `Bearer ${member1User.token}`)
          .attach('file', Buffer.from('payload content'), filename)
          .expect(400);

        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('DISALLOWED_FILE_TYPE');
      }
    });

    it('should reject MIME spoofing where dangerous extension is masked with safe MIME type (400)', async () => {
      // Attacker names file .html or .svg but sets Content-Type to image/png or text/plain
      const res = await request(app)
        .post(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}/attachments`)
        .set('Authorization', `Bearer ${member1User.token}`)
        .attach('file', Buffer.from('<script>alert("xss")</script>'), {
          filename: 'exploit.html',
          contentType: 'image/png',
        })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('DISALLOWED_FILE_TYPE');
    });

    it('should reject MIME spoofing where dangerous MIME type is provided with safe extension (400)', async () => {
      // Attacker names file harmless.txt but declares text/html MIME type
      const res = await request(app)
        .post(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}/attachments`)
        .set('Authorization', `Bearer ${member1User.token}`)
        .attach('file', Buffer.from('harmless content'), {
          filename: 'harmless.txt',
          contentType: 'text/html',
        })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('DISALLOWED_FILE_TYPE');
    });

    it('should reject active web markup disguised inside image buffer (400)', async () => {
      // Attacker uploads exploit markup disguised with .png extension and image/png MIME
      const res = await request(app)
        .post(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}/attachments`)
        .set('Authorization', `Bearer ${member1User.token}`)
        .attach('file', Buffer.from('<svg onload="alert(1)">fake png</svg>'), {
          filename: 'fake-photo.png',
          contentType: 'image/png',
        })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('DISALLOWED_FILE_TYPE');
    });

    it('should reject file exceeding 10MB size limit (400)', async () => {
      const oversizedBuffer = Buffer.alloc(10 * 1024 * 1024 + 1024, 0);
      const res = await request(app)
        .post(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}/attachments`)
        .set('Authorization', `Bearer ${member1User.token}`)
        .attach('file', oversizedBuffer, 'huge_file.zip')
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FILE_TOO_LARGE');
    });

    it('should reject VIEWER from uploading attachments (403)', async () => {
      const res = await request(app)
        .post(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}/attachments`)
        .set('Authorization', `Bearer ${viewerUser.token}`)
        .attach('file', Buffer.from('viewer data'), 'viewer.txt')
        .expect(403);

      expect(res.body.success).toBe(false);
    });

    it('should reject user from another organization from uploading (403)', async () => {
      const res = await request(app)
        .post(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}/attachments`)
        .set('Authorization', `Bearer ${outsideUser.token}`)
        .attach('file', Buffer.from('outside data'), 'outside.txt')
        .expect(403);

      expect(res.body.success).toBe(false);
    });

    it('should reject unauthenticated upload (401)', async () => {
      const res = await request(app)
        .post(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}/attachments`)
        .attach('file', Buffer.from('data'), 'test.txt')
        .expect(401);

      expect(res.body.success).toBe(false);
    });
  });

  describe('GET .../tasks/:taskId/attachments (List)', () => {
    it('should allow VIEWER to list task attachments (200)', async () => {
      const res = await request(app)
        .get(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}/attachments`)
        .set('Authorization', `Bearer ${viewerUser.token}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
      expect(Array.isArray(res.body.data.items)).toBe(true);
      expect(res.body.data.items.length).toBeGreaterThanOrEqual(1);

      const item = res.body.data.items[0];
      expect(item.id).toBeDefined();
      expect(item.originalName).toBeDefined();
      expect(item.uploadedBy).toBeDefined();
      expect(item.storageKey).toBeUndefined(); // Storage key is never exposed in list responses
    });

    it('should reject cross-tenant user listing attachments (403)', async () => {
      const res = await request(app)
        .get(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}/attachments`)
        .set('Authorization', `Bearer ${outsideUser.token}`)
        .expect(403);

      expect(res.body.success).toBe(false);
    });

    it('should return 404 if task belongs to a different project/org', async () => {
      const res = await request(app)
        .get(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task2Id}/attachments`)
        .set('Authorization', `Bearer ${member1User.token}`)
        .expect(404);

      expect(res.body.success).toBe(false);
    });
  });

  describe('GET .../tasks/:taskId/attachments/:attachmentId/download (Download)', () => {
    let testAttachmentId: string;
    let originalFilename: string;
    let expectedContent: string;

    beforeAll(async () => {
      expectedContent = 'Downloadable test stream content 12345';
      originalFilename = 'download-me.txt';

      const uploadRes = await request(app)
        .post(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}/attachments`)
        .set('Authorization', `Bearer ${member1User.token}`)
        .attach('file', Buffer.from(expectedContent), originalFilename);

      testAttachmentId = uploadRes.body.data.id;
      const dbRecord = await prisma.attachment.findUnique({ where: { id: testAttachmentId } });
      if (dbRecord) {
        createdFilesOnDisk.push(path.resolve(UPLOAD_DIR, dbRecord.storageKey));
      }
    });

    it('should allow MEMBER to download attachment with correct headers and stream (200)', async () => {
      const res = await request(app)
        .get(
          `/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}/attachments/${testAttachmentId}/download`,
        )
        .set('Authorization', `Bearer ${member1User.token}`)
        .expect(200);

      expect(res.headers['content-disposition']).toContain(`attachment; filename="${originalFilename}"`);
      expect(res.headers['content-type']).toContain('text/plain');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-security-policy']).toContain("default-src 'none'");
      expect(res.headers['content-security-policy']).toContain('sandbox');
      expect(res.text).toBe(expectedContent);
    });

    it('should serve untrusted / unrecognized file types as application/octet-stream (200)', async () => {
      const weirdUpload = await request(app)
        .post(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}/attachments`)
        .set('Authorization', `Bearer ${member1User.token}`)
        .attach('file', Buffer.from('binary-or-custom-data'), 'custom.data');

      expect(weirdUpload.status).toBe(201);
      const weirdId = weirdUpload.body.data.id;
      const dbRecord = await prisma.attachment.findUnique({ where: { id: weirdId } });
      if (dbRecord) {
        createdFilesOnDisk.push(path.resolve(UPLOAD_DIR, dbRecord.storageKey));
      }

      const res = await request(app)
        .get(
          `/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}/attachments/${weirdId}/download`,
        )
        .set('Authorization', `Bearer ${member1User.token}`)
        .expect(200);

      expect(res.headers['content-disposition']).toContain('attachment; filename="custom.data"');
      expect(res.headers['content-type']).toContain('application/octet-stream');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-security-policy']).toContain("default-src 'none'");
      expect(res.headers['content-security-policy']).toContain('sandbox');
    });

    it('should reject path traversal in getSafeFilePath directly and prevent directory escape', () => {
      expect(() => getSafeFilePath('../../../etc/passwd')).toThrow('path traversal detected');
      expect(() => getSafeFilePath('..\\..\\windows\\win.ini')).toThrow('path traversal detected');
      expect(() => getSafeFilePath('/absolute/path/file.txt')).toThrow('path traversal detected');
      expect(() => getSafeFilePath('sub/directory/file.txt')).toThrow('path traversal detected');
      expect(() => getSafeFilePath('')).toThrow('path traversal detected');
    });

    it('should allow VIEWER to download attachment (200)', async () => {
      const res = await request(app)
        .get(
          `/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}/attachments/${testAttachmentId}/download`,
        )
        .set('Authorization', `Bearer ${viewerUser.token}`)
        .expect(200);

      expect(res.text).toBe(expectedContent);
    });

    it('should reject outside user from downloading attachment (403)', async () => {
      const res = await request(app)
        .get(
          `/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}/attachments/${testAttachmentId}/download`,
        )
        .set('Authorization', `Bearer ${outsideUser.token}`)
        .expect(403);

      expect(res.body.success).toBe(false);
    });

    it('should return 404 if attachment does not exist (404)', async () => {
      const nonExistentId = randomUUID();
      const res = await request(app)
        .get(
          `/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}/attachments/${nonExistentId}/download`,
        )
        .set('Authorization', `Bearer ${member1User.token}`)
        .expect(404);

      expect(res.body.success).toBe(false);
    });

    it('should return 404 if physical file is missing from disk', async () => {
      const ghostAttachment = await prisma.attachment.create({
        data: {
          taskId: task1Id,
          uploadedById: member1User.id,
          originalName: 'ghost.txt',
          storageKey: 'ghost-file-does-not-exist.txt',
          mimeType: 'text/plain',
          size: 100,
        },
      });

      const res = await request(app)
        .get(
          `/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}/attachments/${ghostAttachment.id}/download`,
        )
        .set('Authorization', `Bearer ${member1User.token}`)
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FILE_NOT_FOUND_ON_DISK');

      await prisma.attachment.delete({ where: { id: ghostAttachment.id } });
    });
  });

  describe('DELETE .../tasks/:taskId/attachments/:attachmentId (Delete)', () => {
    it('should allow author (MEMBER 1) to delete their own attachment (200)', async () => {
      const uploadRes = await request(app)
        .post(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}/attachments`)
        .set('Authorization', `Bearer ${member1User.token}`)
        .attach('file', Buffer.from('delete-me-author'), 'author-file.txt');

      const attachmentId = uploadRes.body.data.id;
      const dbRecord = await prisma.attachment.findUnique({ where: { id: attachmentId } });
      expect(dbRecord).not.toBeNull();
      const diskPath = path.resolve(UPLOAD_DIR, dbRecord!.storageKey);

      expect(fs.existsSync(diskPath)).toBe(true);

      const deleteRes = await request(app)
        .delete(
          `/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}/attachments/${attachmentId}`,
        )
        .set('Authorization', `Bearer ${member1User.token}`)
        .expect(200);

      expect(deleteRes.body.success).toBe(true);

      const inDb = await prisma.attachment.findUnique({ where: { id: attachmentId } });
      expect(inDb).toBeNull();
      expect(fs.existsSync(diskPath)).toBe(false);
    });

    it('should NOT allow another regular MEMBER (MEMBER 2) to delete MEMBER 1 attachment (403)', async () => {
      const uploadRes = await request(app)
        .post(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}/attachments`)
        .set('Authorization', `Bearer ${member1User.token}`)
        .attach('file', Buffer.from('cannot-delete-me'), 'protected.txt');

      const attachmentId = uploadRes.body.data.id;
      const dbRecord = await prisma.attachment.findUnique({ where: { id: attachmentId } });
      const diskPath = path.resolve(UPLOAD_DIR, dbRecord!.storageKey);
      createdFilesOnDisk.push(diskPath);

      const res = await request(app)
        .delete(
          `/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}/attachments/${attachmentId}`,
        )
        .set('Authorization', `Bearer ${member2User.token}`)
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');

      const inDb = await prisma.attachment.findUnique({ where: { id: attachmentId } });
      expect(inDb).not.toBeNull();
      expect(fs.existsSync(diskPath)).toBe(true);
    });

    it('should allow ADMIN to moderate and delete another user attachment (200)', async () => {
      const uploadRes = await request(app)
        .post(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}/attachments`)
        .set('Authorization', `Bearer ${member1User.token}`)
        .attach('file', Buffer.from('moderated-by-admin'), 'admin-mod.txt');

      const attachmentId = uploadRes.body.data.id;
      const dbRecord = await prisma.attachment.findUnique({ where: { id: attachmentId } });
      const diskPath = path.resolve(UPLOAD_DIR, dbRecord!.storageKey);

      const deleteRes = await request(app)
        .delete(
          `/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}/attachments/${attachmentId}`,
        )
        .set('Authorization', `Bearer ${adminUser.token}`)
        .expect(200);

      expect(deleteRes.body.success).toBe(true);
      expect(fs.existsSync(diskPath)).toBe(false);
    });

    it('should allow OWNER to moderate and delete any attachment (200)', async () => {
      const uploadRes = await request(app)
        .post(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}/attachments`)
        .set('Authorization', `Bearer ${member1User.token}`)
        .attach('file', Buffer.from('moderated-by-owner'), 'owner-mod.txt');

      const attachmentId = uploadRes.body.data.id;
      const dbRecord = await prisma.attachment.findUnique({ where: { id: attachmentId } });
      const diskPath = path.resolve(UPLOAD_DIR, dbRecord!.storageKey);

      const deleteRes = await request(app)
        .delete(
          `/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}/attachments/${attachmentId}`,
        )
        .set('Authorization', `Bearer ${ownerUser.token}`)
        .expect(200);

      expect(deleteRes.body.success).toBe(true);
      expect(fs.existsSync(diskPath)).toBe(false);
    });

    it('should reject VIEWER from deleting attachment (403)', async () => {
      const uploadRes = await request(app)
        .post(`/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}/attachments`)
        .set('Authorization', `Bearer ${member1User.token}`)
        .attach('file', Buffer.from('viewer-cannot-delete'), 'viewer-delete.txt');

      const attachmentId = uploadRes.body.data.id;
      const dbRecord = await prisma.attachment.findUnique({ where: { id: attachmentId } });
      createdFilesOnDisk.push(path.resolve(UPLOAD_DIR, dbRecord!.storageKey));

      const res = await request(app)
        .delete(
          `/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}/attachments/${attachmentId}`,
        )
        .set('Authorization', `Bearer ${viewerUser.token}`)
        .expect(403);

      expect(res.body.success).toBe(false);
    });

    it('should handle deletion gracefully when physical file is already missing (200)', async () => {
      const ghostAttachment = await prisma.attachment.create({
        data: {
          taskId: task1Id,
          uploadedById: member1User.id,
          originalName: 'already-missing.txt',
          storageKey: 'missing-on-disk-delete-test.txt',
          mimeType: 'text/plain',
          size: 50,
        },
      });

      const res = await request(app)
        .delete(
          `/api/v1/organizations/${org1Id}/projects/${project1Id}/tasks/${task1Id}/attachments/${ghostAttachment.id}`,
        )
        .set('Authorization', `Bearer ${member1User.token}`)
        .expect(200);

      expect(res.body.success).toBe(true);

      const inDb = await prisma.attachment.findUnique({ where: { id: ghostAttachment.id } });
      expect(inDb).toBeNull();
    });
  });
});
