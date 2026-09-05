// test-phreshos-3.js
import _ from 'lodash';
import dayjs from 'dayjs';
import { v4 as uuidv4 } from 'uuid';
import { nanoid } from 'nanoid';
import chalk from 'chalk';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log(chalk.blue.bold('\n=== Test 3: External Libraries ===\n'));

// 1. lodash
const users = [
  { name: 'Ali', age: 25, active: true },
  { name: 'Sara', age: 30, active: false },
  { name: 'Omar', age: 22, active: true },
  { name: 'Lina', age: 28, active: true },
];

const activeUsers = _.filter(users, 'active');
const sorted = _.orderBy(activeUsers, ['age'], ['desc']);
const names = _.map(sorted, 'name');

console.log(chalk.green('lodash → Active users sorted by age:'), names);

// 2. dayjs
const now = dayjs();
const tomorrow = now.add(1, 'day');
const formatted = now.format('YYYY-MM-DD HH:mm:ss');

console.log(chalk.yellow('dayjs → Now:'), formatted);
console.log(chalk.yellow('dayjs → Tomorrow:'), tomorrow.format('YYYY-MM-DD'));

// 3. uuid + nanoid
const id1 = uuidv4();
const id2 = nanoid();
const id3 = nanoid(10);

console.log(chalk.magenta('uuid   →'), id1);
console.log(chalk.magenta('nanoid →'), id2);
console.log(chalk.magenta('nanoid (10 chars) →'), id3);

// 4. كتابة النتائج في ملف باستخدام fs/promises
const report = {
  timestamp: formatted,
  activeUsers: names,
  ids: { uuid: id1, nanoid: id2, short: id3 },
  lodashVersion: _.VERSION,
};

const reportPath = path.join(__dirname, 'library-test-report.json');
await fs.writeFile(reportPath, JSON.stringify(report, null, 2));

console.log(chalk.cyan('\nReport written to:'), reportPath);

// 5. قراءة الملف مرة أخرى للتأكيد
const readBack = JSON.parse(await fs.readFile(reportPath, 'utf8'));
console.log(chalk.cyan('Read back successfully. Active users count:'), readBack.activeUsers.length);

// Cleanup
await fs.unlink(reportPath);
console.log(chalk.gray('\nCleanup done. Test 3 finished.'));