import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

test('Applications management UI uses the existing V5 admin API lifecycle', () => {
  for (const route of [
    '/api/admin/integrations/applications',
    '/permissions',
    '/forms',
    '/question-packs',
    '/credentials',
    '/revoke',
  ]) assert.match(html, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  for (const capability of ['read_form_schema', 'submit_response', 'read_question_pack', 'submit_game_result', 'read_responses']) assert.match(html, new RegExp(capability));
  for (const state of ['กำลังโหลด Applications', 'ยังไม่มี Application', 'Application Disabled', 'Application Revoked', 'Coming later']) assert.match(html, new RegExp(state));
  assert.match(html, /Create Application/);
  assert.match(html, /Save Permissions/);
  assert.match(html, /Disable Application/);
  assert.match(html, /Enable Application/);
  assert.match(html, /Revoke Permanently/);
  assert.match(html, /data-delete-application/);
  assert.match(html, /Delete this Application/);
  assert.match(html, /Allowed Forms/);
  assert.match(html, /Save Forms/);
  assert.match(html, /Allowed Question Packs/);
  assert.match(html, /Save Packs/);
  assert.match(html, /\/api\/integrations\/question-packs\/\{packId\}/);
  assert.match(html, /Grade Answers/);
  assert.ok(html.indexOf('const integrationPermissionInfo=') < html.indexOf('if(publicFormId)'), 'integration constants must initialize before the login/public early return');
});

test('credential UI keeps full secrets one-time and supports copy, rotation and revoke', () => {
  assert.match(html, /function showOneTimeSecret/);
  assert.match(html, /You will not be able to view it again/);
  assert.match(html, /navigator\.clipboard\.writeText/);
  assert.match(html, /input\.value='';sensitiveSecret=''/);
  assert.match(html, /สร้าง Key ใหม่ → เปลี่ยนในเกม → Revoke Key เก่า/);
  assert.match(html, /Revoke this integration key/);
  assert.match(html, /Delete this revoked key/);
  assert.match(html, />Delete Key<\/button>/);
  assert.match(html, /method:'DELETE'/);
  assert.doesNotMatch(html, /localStorage\.(?:setItem|getItem)\([^)]*(?:secret|credential|goi_int)/i);
  assert.doesNotMatch(html, /console\.(?:log|debug|info)\([^)]*(?:secret|credential)/i);
});

test('published form integration information and response source filtering are present', () => {
  assert.match(html, /function formIntegrationInfoHtml/);
  assert.match(html, /\/api\/integrations\/forms\/\$\{encodeURIComponent\(pub\.publicId\)\}\/schema/);
  assert.match(html, /Current Version|CURRENT VERSION/);
  assert.match(html, /id="responseSourceFilter"/);
  assert.match(html, /function responseMatchesSource/);
  assert.match(html, /response_source|source_app_name|source_version|source_platform|source_session|source_metadata/);
  assert.match(html, /ข้อมูล Source/);
});

test('Applications UI has phone-safe responsive layouts and modal bounds', () => {
  assert.match(html, /\.applications-grid\{display:grid/);
  assert.match(html, /\.application-detail-grid\{display:grid/);
  assert.match(html, /@media\(max-width:699px\)[\s\S]*\.application-detail-grid/);
  assert.match(html, /\.modal\{[^}]*max-height:88vh/);
  assert.match(html, /\.credential-row\{display:grid/);
});
