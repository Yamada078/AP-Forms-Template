import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, js, css, bankJs, activityJs] = await Promise.all([
  readFile(new URL('../public/question-packs.html', import.meta.url), 'utf8'),
  readFile(new URL('../public/question-packs.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/question-packs.css', import.meta.url), 'utf8'),
  readFile(new URL('../public/question-banks.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/question-activity-runtime.js', import.meta.url), 'utf8'),
]);

test('Question Studio navigation exposes Banks and Packs with Thai-first labels', () => {
  assert.match(bankJs, /data-nav="question-packs">ชุดคำถาม/);
  assert.match(js, /data-nav="banks">คลังคำถาม/);
  assert.match(js, /data-nav="packs">ชุดคำถาม/);
  assert.match(js, /data-nav="forms">ฟอร์ม/);
  assert.match(js, /data-nav="applications">แอปพลิเคชัน/);
  assert.doesNotMatch(js, /<h1>Question Packs<\/h1>/);
});

test('Pack Editor covers manual selection, pool rules, preview, publishing, and version inspection', () => {
  assert.match(html, /question-packs\.js\?v=5\.4\.0/);
  for (const route of ['/api/admin/question-packs', '/items', '/items/order', '/preview', '/publish', '/versions/']) assert.match(js, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  for (const label of ['คำถามที่เลือก', 'Pool คำถาม', 'มี Tag ใด Tag หนึ่ง (OR)', 'ต้องมีครบทุก Tag (AND)', 'ตัดออกเมื่อมี Tag', 'ตรวจการจัดชุด', 'เผยแพร่ Version ใหม่', 'กำลังบันทึก…', 'บันทึกแล้ว']) assert.match(js, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(js, /status:'READY'/);
  assert.match(js, /difficultyMin/);
  assert.match(js, /difficultyMax/);
  assert.match(js, /includeTagIds/);
  assert.match(js, /excludeTagIds/);
  assert.match(js, /questionIds/);
  assert.match(js, /pickerSelectAll/);
  assert.match(js, /คำถามพร้อมใช้ในคลัง/);
  assert.match(js, /คำถามจากคลังนี้ที่อยู่ในชุด/);
  assert.match(js, /pickCount/);
  assert.match(js, /data-up=/);
  assert.match(js, /data-down=/);
});

test('Question Pack walkthrough reuses the Question Bank activity runtime and never blocks Next', () => {
  const start = js.slice(js.indexOf('async function startAssessment'), js.indexOf('function closeAssessment'));
  assert.match(start, /\/versions\//);
  assert.match(start, /renderQuestionActivity/);
  assert.match(start, /bindQuestionActivity/);
  assert.match(start, /ถัดไป/);
  assert.match(start, /จบการทดลอง/);
  assert.match(start, /ตรวจคำตอบ/);
  assert.doesNotMatch(start, /\/api\/admin\/assessments/);
  assert.doesNotMatch(start, /กรุณาตอบ.*ให้ครบ/);
  assert.doesNotMatch(start, /ประวัติผล/);
  for (const control of ['data-activity-match-left', 'data-activity-match-right', 'data-activity-drag-token', 'data-activity-drop-target']) assert.match(activityJs, new RegExp(control));
  assert.match(activityJs, /pointerdown/);
  assert.match(activityJs, /gradeQuestionResponse/);
  assert.match(bankJs, /renderQuestionActivity/);
  assert.match(css, /\.assessment-progress/);
  assert.match(css, /\.assessment-question\.qb-question-paper/);
  assert.match(css, /@media\(max-width:720px\)[\s\S]*\.assessment-page/);
});

test('Pack Editor is responsive and does not expose answers in preview/version rendering', () => {
  assert.match(css, /\.pack-editor-body\{display:grid;grid-template-columns:minmax\(0,1fr\) 330px/);
  assert.match(css, /@media\(max-width:900px\)[\s\S]*\.pack-side\{position:fixed/);
  assert.match(css, /@media\(max-width:720px\)[\s\S]*\.pack-side\{top:58px;width:100vw/);
  assert.match(js, /หน้าจอนี้ไม่แสดงเฉลย/);
  assert.doesNotMatch(js, /snapshot\.questions[^\n]{0,300}(?:correctIds|correctAnswer|acceptedAnswers)/);
});
