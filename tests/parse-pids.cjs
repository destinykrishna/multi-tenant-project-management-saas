const fs = require('fs');
const content = fs.readFileSync('C:/Users/Krishna/.gemini/antigravity-ide/brain/c03c5a3f-d945-48d4-92fc-85e20b1e580d/.system_generated/tasks/task-6098.log', 'utf8');
const pids = new Set();
for (const match of content.matchAll(/"pid":(\d+)/g)) {
  pids.add(match[1]);
}
console.log('Worker PIDs:', Array.from(pids));
